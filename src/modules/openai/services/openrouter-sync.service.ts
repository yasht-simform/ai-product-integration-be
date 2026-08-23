import { HttpService } from '@nestjs/axios';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { ModelSource } from '../constants/model-source.enum';
import { ModelTier } from '../constants/model-tier.enum';
import type { SyncResult } from '../types/model-registry.types';
import type { OpenRouterModel, OpenRouterModelsResponse } from '../types/openrouter.types';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

@Injectable()
export class OpenRouterSyncService implements OnModuleInit {
  private lastSyncedAt: Date | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('OpenRouter sync disabled (OPENROUTER_SYNC_ENABLED=false)');
      return;
    }
    try {
      const result = await this.syncAll();
      this.logger.log(
        `Synced ${result.modelsCreated + result.modelsUpdated} models from ${result.providersCreated} new providers`,
      );
    } catch (error) {
      this.logger.error('OpenRouter startup sync failed', String(error));
    }
  }

  // Runs daily at 3 AM.
  @Cron('0 3 * * *')
  async scheduledSync(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.syncAll();
    } catch (error) {
      this.logger.error('OpenRouter scheduled sync failed', String(error));
    }
  }

  async syncAll(): Promise<SyncResult> {
    return this.sync(() => true);
  }

  async syncFreeModelsOnly(): Promise<SyncResult> {
    return this.sync((model) => this.isFree(model));
  }

  getLastSyncedAt(): Date | null {
    return this.lastSyncedAt;
  }

  private isEnabled(): boolean {
    return this.config.get<boolean>('openai.openRouterSyncEnabled') ?? true;
  }

  private async sync(filter: (model: OpenRouterModel) => boolean): Promise<SyncResult> {
    const response = await firstValueFrom(
      this.http.get<OpenRouterModelsResponse>(OPENROUTER_MODELS_URL),
    );
    const models = response.data.data.filter(filter);

    const slugs = [...new Set(models.map((m) => this.extractProviderSlug(m.id)))];
    const existingProviders = await this.db.aiProvider.findMany({ where: { slug: { in: slugs } } });
    const providerIdBySlug = new Map(existingProviders.map((p) => [p.slug, p.id]));

    let providersCreated = 0;
    for (const slug of slugs) {
      if (providerIdBySlug.has(slug)) continue;
      const created = await this.db.aiProvider.create({
        data: { name: this.titleCase(slug), slug },
      });
      providerIdBySlug.set(slug, created.id);
      providersCreated++;
    }

    const modelIds = models.map((m) => m.id);
    const existingModels = await this.db.aiModel.findMany({
      where: { modelId: { in: modelIds } },
    });
    const existingByModelId = new Map(existingModels.map((m) => [m.modelId, m]));

    let modelsCreated = 0;
    let modelsUpdated = 0;
    const now = new Date();

    await Promise.all(
      models.map(async (model) => {
        const existing = existingByModelId.get(model.id);
        // Manually added/edited models are never overwritten by the sync.
        if (existing && (existing.source as ModelSource) === ModelSource.MANUAL) return;

        const providerId = providerIdBySlug.get(this.extractProviderSlug(model.id));
        if (providerId === undefined) return;

        const data = {
          providerId,
          name: model.name,
          tier: this.isFree(model) ? ModelTier.FREE : ModelTier.PAID,
          inputPricePer1M: parseFloat(model.pricing.prompt) * 1_000_000,
          outputPricePer1M: parseFloat(model.pricing.completion) * 1_000_000,
          contextWindow: model.context_length,
          source: ModelSource.OPENROUTER_SYNC,
          lastSyncedAt: now,
        };

        if (existing) {
          await this.db.aiModel.update({ where: { modelId: model.id }, data });
          modelsUpdated++;
        } else {
          await this.db.aiModel.create({ data: { ...data, modelId: model.id } });
          modelsCreated++;
        }
      }),
    );

    this.lastSyncedAt = now;
    this.logger.log(
      `Synced ${modelsCreated + modelsUpdated} models from ${slugs.length} providers (${providersCreated} new)`,
    );

    return { providersCreated, modelsCreated, modelsUpdated };
  }

  private isFree(model: OpenRouterModel): boolean {
    return model.pricing.prompt === '0' && model.pricing.completion === '0';
  }

  private extractProviderSlug(modelId: string): string {
    return modelId.split('/')[0] ?? 'unknown';
  }

  private titleCase(slug: string): string {
    return slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
