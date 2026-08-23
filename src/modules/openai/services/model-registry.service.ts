import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { AiModel, AiProvider, Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { MODEL_PRICING } from '../constants/model-pricing.constant';
import { ModelSource } from '../constants/model-source.enum';
import type { CreateModelDto } from '../dto/create-model.dto';
import type { CreateProviderDto } from '../dto/create-provider.dto';
import type { UpdateModelDto } from '../dto/update-model.dto';
import type { UpdateProviderDto } from '../dto/update-provider.dto';
import type {
  AiModelEntity,
  AiProviderWithCount,
  ModelPricingResult,
  PaginatedModelsResult,
  PricingTableResult,
  QueryModelsParams,
} from '../types/model-registry.types';

type AiModelWithProvider = AiModel & { provider: AiProvider };

@Injectable()
export class ModelRegistryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: AppLoggerService,
  ) {}

  // ── Models ─────────────────────────────────────────────────────────────────

  async findAllModels(query: QueryModelsParams): Promise<PaginatedModelsResult> {
    const { page = 1, limit = 20, tier, providerId, search, isActive, source } = query;
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where: Prisma.AiModelWhereInput = {};
    if (tier) where.tier = tier;
    if (source) where.source = source;
    if (isActive !== undefined) where.isActive = isActive;
    if (providerId) where.provider = { publicId: providerId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { modelId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [models, total] = await Promise.all([
      this.db.aiModel.findMany({
        where,
        skip,
        take,
        include: { provider: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.aiModel.count({ where }),
    ]);

    return { data: models.map((m) => this.toModelEntity(m)), total, page, limit: take };
  }

  async findModelByModelId(modelId: string): Promise<AiModelEntity | null> {
    const model = await this.db.aiModel.findUnique({
      where: { modelId },
      include: { provider: true },
    });
    return model ? this.toModelEntity(model) : null;
  }

  async findModelByPublicId(publicId: string): Promise<AiModelEntity> {
    const model = await this.db.aiModel.findUnique({
      where: { publicId },
      include: { provider: true },
    });
    if (!model) throw new NotFoundException(`Model "${publicId}" not found`);
    return this.toModelEntity(model);
  }

  async createModel(dto: CreateModelDto): Promise<AiModelEntity> {
    const provider = await this.db.aiProvider.findUnique({ where: { publicId: dto.providerId } });
    if (!provider) throw new NotFoundException(`Provider "${dto.providerId}" not found`);

    try {
      const model = await this.db.aiModel.create({
        data: {
          providerId: provider.id,
          name: dto.name,
          modelId: dto.modelId,
          tier: dto.tier,
          inputPricePer1M: dto.inputPricePer1M ?? 0,
          outputPricePer1M: dto.outputPricePer1M ?? 0,
          contextWindow: dto.contextWindow,
          description: dto.description,
          isActive: dto.isActive ?? true,
          source: ModelSource.MANUAL,
        },
        include: { provider: true },
      });
      return this.toModelEntity(model);
    } catch (error) {
      if (this.isP2002(error)) {
        throw new ConflictException(`Model with modelId "${dto.modelId}" already exists`);
      }
      throw error;
    }
  }

  async updateModel(publicId: string, dto: UpdateModelDto): Promise<AiModelEntity> {
    await this.findModelByPublicId(publicId);

    let providerId: bigint | undefined;
    if (dto.providerId) {
      const provider = await this.db.aiProvider.findUnique({
        where: { publicId: dto.providerId },
      });
      if (!provider) throw new NotFoundException(`Provider "${dto.providerId}" not found`);
      providerId = provider.id;
    }

    const model = await this.db.aiModel.update({
      where: { publicId },
      data: {
        ...(providerId !== undefined && { providerId }),
        name: dto.name,
        modelId: dto.modelId,
        tier: dto.tier,
        inputPricePer1M: dto.inputPricePer1M,
        outputPricePer1M: dto.outputPricePer1M,
        contextWindow: dto.contextWindow,
        description: dto.description,
        isActive: dto.isActive,
        source: ModelSource.MANUAL,
      },
      include: { provider: true },
    });
    return this.toModelEntity(model);
  }

  async deleteModel(publicId: string): Promise<void> {
    await this.findModelByPublicId(publicId);
    await this.db.aiModel.update({ where: { publicId }, data: { isActive: false } });
  }

  // ── Providers ──────────────────────────────────────────────────────────────

  async findAllProviders(): Promise<AiProviderWithCount[]> {
    const providers = await this.db.aiProvider.findMany({
      include: { _count: { select: { models: true } } },
      orderBy: { name: 'asc' },
    });

    return providers.map((p) => ({
      publicId: p.publicId,
      name: p.name,
      slug: p.slug,
      baseUrl: p.baseUrl,
      description: p.description,
      isActive: p.isActive,
      modelCount: p._count.models,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  async createProvider(dto: CreateProviderDto): Promise<AiProviderWithCount> {
    try {
      const provider = await this.db.aiProvider.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          baseUrl: dto.baseUrl,
          description: dto.description,
          isActive: dto.isActive ?? true,
        },
      });
      return { ...provider, modelCount: 0 };
    } catch (error) {
      if (this.isP2002(error)) {
        throw new ConflictException(`Provider with slug "${dto.slug}" already exists`);
      }
      throw error;
    }
  }

  async updateProvider(publicId: string, dto: UpdateProviderDto): Promise<AiProviderWithCount> {
    const existing = await this.db.aiProvider.findUnique({
      where: { publicId },
      include: { _count: { select: { models: true } } },
    });
    if (!existing) throw new NotFoundException(`Provider "${publicId}" not found`);

    const provider = await this.db.aiProvider.update({
      where: { publicId },
      data: {
        name: dto.name,
        slug: dto.slug,
        baseUrl: dto.baseUrl,
        description: dto.description,
        isActive: dto.isActive,
      },
      include: { _count: { select: { models: true } } },
    });
    return { ...provider, modelCount: provider._count.models };
  }

  async deleteProvider(publicId: string): Promise<void> {
    const existing = await this.db.aiProvider.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException(`Provider "${publicId}" not found`);
    await this.db.aiProvider.update({ where: { publicId }, data: { isActive: false } });
  }

  // ── Pricing ────────────────────────────────────────────────────────────────

  async countModels(): Promise<number> {
    return this.db.aiModel.count();
  }

  async countProviders(): Promise<number> {
    return this.db.aiProvider.count();
  }

  async getAllActivePricing(): Promise<Map<string, ModelPricingResult>> {
    const models = await this.db.aiModel.findMany({
      where: { isActive: true },
      select: { modelId: true, inputPricePer1M: true, outputPricePer1M: true },
    });
    return new Map(
      models.map((m) => [m.modelId, { input: m.inputPricePer1M, output: m.outputPricePer1M }]),
    );
  }

  async getModelPricing(modelId: string): Promise<ModelPricingResult> {
    const model = await this.db.aiModel.findUnique({ where: { modelId } });
    if (model) {
      return { input: model.inputPricePer1M, output: model.outputPricePer1M };
    }

    const fallback = MODEL_PRICING[modelId];
    if (fallback) return fallback;

    this.logger.debug(`No pricing data for model: ${modelId}, defaulting to 0`);
    return { input: 0, output: 0 };
  }

  async getPricingTable(): Promise<PricingTableResult> {
    const providers = await this.db.aiProvider.findMany({
      where: { isActive: true },
      include: { models: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    });

    return {
      providers: providers
        .filter((p) => p.models.length > 0)
        .map((p) => ({
          provider: p.name,
          slug: p.slug,
          models: p.models.map((m) => ({
            modelId: m.modelId,
            name: m.name,
            tier: m.tier,
            inputPricePer1M: m.inputPricePer1M,
            outputPricePer1M: m.outputPricePer1M,
          })),
        })),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private toModelEntity(model: AiModelWithProvider): AiModelEntity {
    return {
      publicId: model.publicId,
      providerPublicId: model.provider.publicId,
      providerName: model.provider.name,
      name: model.name,
      modelId: model.modelId,
      tier: model.tier,
      inputPricePer1M: model.inputPricePer1M,
      outputPricePer1M: model.outputPricePer1M,
      contextWindow: model.contextWindow,
      description: model.description,
      source: model.source,
      isActive: model.isActive,
      lastSyncedAt: model.lastSyncedAt,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  private isP2002(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
