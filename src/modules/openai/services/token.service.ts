import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { encoding_for_model, type Tiktoken, type TiktokenModel } from 'tiktoken';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { MODEL_PRICING } from '../constants/model-pricing.constant';
import { OpenAIModel } from '../constants/openai-model.enum';
import { ModelRegistryService } from './model-registry.service';

const PRICING_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class TokenService implements OnModuleDestroy {
  private pricingCache = new Map<string, { input: number; output: number }>();
  private pricingCacheExpiresAt = 0;
  // encoding_for_model() reloads the full BPE rank table on every call (~100ms+ measured) —
  // caching one Tiktoken instance per model avoids paying that cost on every countTokens() call,
  // which matters for hot paths like ChatService.buildContext() iterating a message list.
  private readonly encoderCache = new Map<string, Tiktoken>();

  constructor(
    private readonly logger: AppLoggerService,
    private readonly modelRegistry: ModelRegistryService,
  ) {}

  onModuleDestroy(): void {
    for (const enc of this.encoderCache.values()) {
      enc.free();
    }
    this.encoderCache.clear();
  }

  countTokens(text: string, model: string = OpenAIModel.GPT_4O): number {
    try {
      return this.getEncoder(model).encode(text).length;
    } catch {
      this.logger.debug(`tiktoken does not support model: ${model}, using heuristic estimate`);
      return this.estimateTokens(text);
    }
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async calculateCost(model: string, inputTokens: number, outputTokens: number): Promise<number> {
    const pricing = await this.getPricing(model);
    if (!pricing) {
      this.logger.debug(`No pricing data for model: ${model}, cost set to 0`);
      return 0;
    }
    const result =
      (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
    return parseFloat(result.toFixed(8));
  }

  getModelPricing(): Record<string, { input: number; output: number }> {
    return MODEL_PRICING;
  }

  private async getPricing(model: string): Promise<{ input: number; output: number } | undefined> {
    if (Date.now() > this.pricingCacheExpiresAt) {
      await this.refreshPricingCache();
    }

    const dbPricing = this.pricingCache.get(model);
    if (dbPricing) return dbPricing;

    return MODEL_PRICING[model];
  }

  private async refreshPricingCache(): Promise<void> {
    try {
      this.pricingCache = await this.modelRegistry.getAllActivePricing();
    } catch (error) {
      this.logger.debug(`Failed to refresh pricing cache from DB: ${String(error)}`);
    }
    this.pricingCacheExpiresAt = Date.now() + PRICING_CACHE_TTL_MS;
  }

  private getEncoder(model: string): Tiktoken {
    let enc = this.encoderCache.get(model);
    if (!enc) {
      enc = encoding_for_model(model as TiktokenModel);
      this.encoderCache.set(model, enc);
    }
    return enc;
  }
}
