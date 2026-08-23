import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { Prisma, PromptTemplate } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import type { CreatePromptTemplateDto } from '../dto/create-prompt-template.dto';
import type { QueryPromptTemplateDto } from '../dto/query-prompt-template.dto';
import type { UpdatePromptTemplateDto } from '../dto/update-prompt-template.dto';
import type {
  PaginatedPromptTemplateResult,
  PromptTemplateEntity,
} from '../types/prompt-template.types';

@Injectable()
export class PromptTemplateService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: AppLoggerService,
  ) {}

  async create(dto: CreatePromptTemplateDto): Promise<PromptTemplateEntity> {
    try {
      const template = await this.db.promptTemplate.create({
        data: {
          name: dto.name,
          description: dto.description,
          systemPrompt: dto.systemPrompt,
          ...(dto.fewShotExamples !== undefined && {
            fewShotExamples: dto.fewShotExamples as unknown as Prisma.InputJsonValue,
          }),
          technique: dto.technique,
          recommendedModel: dto.recommendedModel,
          recommendedTemperature: dto.recommendedTemperature,
          tags: dto.tags ?? [],
          isActive: dto.isActive,
        },
      });
      return this.toEntity(template);
    } catch (error) {
      if (this.isP2002(error)) {
        throw new ConflictException(`Template with name "${dto.name}" already exists`);
      }
      throw error;
    }
  }

  async findAll(query: QueryPromptTemplateDto): Promise<PaginatedPromptTemplateResult> {
    const { page = 1, limit = 20, technique, tags, isActive = true } = query;
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where: Prisma.PromptTemplateWhereInput = { isActive };
    if (technique) where.technique = technique;
    if (tags) {
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length > 0) where.tags = { hasSome: tagList };
    }

    const [templates, total] = await Promise.all([
      this.db.promptTemplate.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.promptTemplate.count({ where }),
    ]);

    return { data: templates.map((t) => this.toEntity(t)), total };
  }

  async findByPublicId(publicId: string): Promise<PromptTemplateEntity> {
    const template = await this.db.promptTemplate.findUnique({ where: { publicId } });
    if (!template) {
      throw new NotFoundException(`Prompt template "${publicId}" not found`);
    }
    return this.toEntity(template);
  }

  async findByName(name: string): Promise<PromptTemplateEntity> {
    const template = await this.db.promptTemplate.findUnique({ where: { name } });
    if (!template) {
      throw new NotFoundException(`Prompt template "${name}" not found`);
    }
    return this.toEntity(template);
  }

  async update(publicId: string, dto: UpdatePromptTemplateDto): Promise<PromptTemplateEntity> {
    await this.findByPublicId(publicId);

    const template = await this.db.promptTemplate.update({
      where: { publicId },
      data: {
        name: dto.name,
        description: dto.description,
        systemPrompt: dto.systemPrompt,
        ...(dto.fewShotExamples !== undefined && {
          fewShotExamples: dto.fewShotExamples as unknown as Prisma.InputJsonValue,
        }),
        technique: dto.technique,
        recommendedModel: dto.recommendedModel,
        recommendedTemperature: dto.recommendedTemperature,
        tags: dto.tags,
        isActive: dto.isActive,
      },
    });
    return this.toEntity(template);
  }

  async remove(publicId: string): Promise<void> {
    await this.findByPublicId(publicId);
    await this.db.promptTemplate.delete({ where: { publicId } });
  }

  private toEntity(template: PromptTemplate): PromptTemplateEntity {
    return {
      publicId: template.publicId,
      name: template.name,
      description: template.description,
      systemPrompt: template.systemPrompt,
      fewShotExamples: template.fewShotExamples,
      technique: template.technique,
      recommendedModel: template.recommendedModel,
      recommendedTemperature: template.recommendedTemperature,
      tags: template.tags,
      isActive: template.isActive,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  private isP2002(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
