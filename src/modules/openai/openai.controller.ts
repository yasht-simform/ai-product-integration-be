import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiNoContentResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { requestContext } from '../../common/logger/request-context';
import { ModelTier } from './constants/model-tier.enum';
import { OpenAIModel } from './constants/openai-model.enum';
import { ChatCompletionResDto } from './dto/chat-completion-res.dto';
import { ChatCompletionDto } from './dto/chat-completion.dto';
import { CostSummaryQueryDto } from './dto/cost-summary-query.dto';
import { CostSummaryResDto } from './dto/cost-summary-res.dto';
import { CreateModelDto } from './dto/create-model.dto';
import { CreatePromptTemplateDto } from './dto/create-prompt-template.dto';
import { CreateProviderDto } from './dto/create-provider.dto';
import { ModelCompareResDto } from './dto/model-compare-res.dto';
import { ModelCompareDto } from './dto/model-compare.dto';
import { ModelPricingResDto } from './dto/model-pricing-res.dto';
import { ModelResDto } from './dto/model-res.dto';
import { PaginatedAiAuditResDto } from './dto/paginated-ai-audit-res.dto';
import { PaginatedModelResDto } from './dto/paginated-model-res.dto';
import { PaginatedPromptTemplateResDto } from './dto/paginated-prompt-template-res.dto';
import { PricingCalculateResDto } from './dto/pricing-calculate-res.dto';
import { PricingCalculateDto } from './dto/pricing-calculate.dto';
import { PricingTableResDto } from './dto/pricing-table-res.dto';
import { PromptTemplateResDto } from './dto/prompt-template-res.dto';
import { PromptTestDto } from './dto/prompt-test.dto';
import { ProviderResDto } from './dto/provider-res.dto';
import { QueryAiAuditDto } from './dto/query-ai-audit.dto';
import { QueryModelsDto } from './dto/query-models.dto';
import { QueryPromptTemplateDto } from './dto/query-prompt-template.dto';
import { SyncResultResDto } from './dto/sync-result-res.dto';
import { SyncStatusResDto } from './dto/sync-status-res.dto';
import { TokenCountResDto } from './dto/token-count-res.dto';
import { TokenCountDto } from './dto/token-count.dto';
import { UpdateModelDto } from './dto/update-model.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { AiAuditService } from './services/ai-audit.service';
import { ModelRegistryService } from './services/model-registry.service';
import { OpenaiService } from './services/openai.service';
import { OpenRouterSyncService } from './services/openrouter-sync.service';
import { PromptTemplateService } from './services/prompt-template.service';
import { RetryService } from './services/retry.service';
import { TokenService } from './services/token.service';
import type { AiModelEntity, AiProviderWithCount } from './types/model-registry.types';
import type { PromptTemplateEntity } from './types/prompt-template.types';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface HealthResponse {
  circuitState: CircuitState;
  status: 'ok' | 'degraded';
}

interface PromptTestResBody {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCost: number;
  latencyMs: number;
  tokenBreakdown: { systemPromptTokens: number; userMessageTokens: number };
}

@ApiTags('openai')
@Controller('openai')
export class OpenaiController {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly tokenService: TokenService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly retryService: RetryService,
    private readonly aiAuditService: AiAuditService,
    private readonly modelRegistryService: ModelRegistryService,
    private readonly openRouterSyncService: OpenRouterSyncService,
    private readonly config: ConfigService,
  ) {}

  private get defaultModel(): OpenAIModel {
    return (this.config.get<string>('openai.defaultModel') ?? OpenAIModel.GPT_4O) as OpenAIModel;
  }

  // ── Chat / completion ─────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Send a chat completion request',
    type: ChatCompletionResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('chat')
  async chatCompletion(@Body() dto: ChatCompletionDto): Promise<ChatCompletionResDto> {
    const requestId = requestContext.getStore()?.requestId;
    return this.openaiService.chatCompletion({ ...dto, requestId });
  }

  @ApiEndpoint({
    summary: 'Compare responses across multiple models',
    type: ModelCompareResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('compare')
  async compareModels(@Body() dto: ModelCompareDto): Promise<ModelCompareResDto> {
    const requestId = requestContext.getStore()?.requestId;
    const models = dto.models ?? [this.defaultModel];

    const results = await Promise.all(
      models.map((model) =>
        this.openaiService.chatCompletion({
          prompt: dto.prompt,
          systemPrompt: dto.systemPrompt,
          model,
          temperature: dto.temperature,
          requestId,
        }),
      ),
    );

    return {
      results: results.map((r) => ({
        model: r.model,
        content: r.content,
        usage: r.usage,
        estimatedCost: r.estimatedCost,
        latencyMs: r.latencyMs,
      })),
    };
  }

  @ApiEndpoint({
    summary: 'Test a prompt with an optional saved template',
    type: ChatCompletionResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('prompt-test')
  async promptTest(@Body() dto: PromptTestDto): Promise<PromptTestResBody> {
    const requestId = requestContext.getStore()?.requestId;

    let systemPrompt = dto.systemPrompt;
    if (dto.templateName) {
      const template = await this.promptTemplateService.findByName(dto.templateName);
      systemPrompt = template.systemPrompt;
    }

    const model = dto.model ?? this.defaultModel;
    const result = await this.openaiService.chatCompletion({
      ...dto,
      systemPrompt,
      requestId,
    });

    const systemPromptTokens = systemPrompt
      ? this.tokenService.countTokens(systemPrompt, model)
      : 0;
    const userMessageTokens = this.tokenService.countTokens(dto.prompt, model);

    return {
      ...result,
      tokenBreakdown: { systemPromptTokens, userMessageTokens },
    };
  }

  @ApiEndpoint({
    summary: 'Count tokens in a text string (no API call)',
    type: TokenCountResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('token-count')
  countTokens(@Body() dto: TokenCountDto): TokenCountResDto {
    const model = dto.model ?? this.defaultModel;
    const tokenCount = this.tokenService.countTokens(dto.text, model);

    return {
      text: dto.text,
      model,
      tokenCount,
      characterCount: dto.text.length,
    };
  }

  // ── Prompt templates ──────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Create a prompt template',
    type: PromptTemplateResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('templates')
  async createTemplate(@Body() dto: CreatePromptTemplateDto): Promise<PromptTemplateResDto> {
    const template = await this.promptTemplateService.create(dto);
    return this.toTemplateRes(template);
  }

  @ApiEndpoint({
    summary: 'List prompt templates with filters and pagination',
    type: PaginatedPromptTemplateResDto,
    isPublic: true,
  })
  @Get('templates')
  async listTemplates(
    @Query() query: QueryPromptTemplateDto,
  ): Promise<PaginatedPromptTemplateResDto> {
    const result = await this.promptTemplateService.findAll(query);
    return {
      data: result.data.map((t) => this.toTemplateRes(t)),
      total: result.total,
    };
  }

  @ApiEndpoint({
    summary: 'Get a prompt template by publicId',
    type: PromptTemplateResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Template not found' })
  @Get('templates/:publicId')
  async getTemplate(@Param('publicId') publicId: string): Promise<PromptTemplateResDto> {
    const template = await this.promptTemplateService.findByPublicId(publicId);
    return this.toTemplateRes(template);
  }

  @ApiEndpoint({
    summary: 'Update a prompt template',
    type: PromptTemplateResDto,
    isPublic: true,
  })
  @ApiBody({ type: UpdatePromptTemplateDto })
  @ApiNotFoundResponse({ description: 'Template not found' })
  @Patch('templates/:publicId')
  async updateTemplate(
    @Param('publicId') publicId: string,
    @Body() dto: UpdatePromptTemplateDto,
  ): Promise<PromptTemplateResDto> {
    const template = await this.promptTemplateService.update(publicId, dto);
    return this.toTemplateRes(template);
  }

  @ApiEndpoint({ summary: 'Delete a prompt template', isPublic: true })
  @ApiNoContentResponse({ description: 'Template deleted' })
  @ApiNotFoundResponse({ description: 'Template not found' })
  @Delete('templates/:publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTemplate(@Param('publicId') publicId: string): Promise<void> {
    return this.promptTemplateService.remove(publicId);
  }

  // ── Audit logs ────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Get aggregated cost summary',
    type: CostSummaryResDto,
    isPublic: true,
  })
  @Get('audit-logs/cost-summary')
  async getCostSummary(@Query() query: CostSummaryQueryDto): Promise<CostSummaryResDto> {
    return this.aiAuditService.getCostSummary(query);
  }

  @ApiEndpoint({
    summary: 'Query AI audit logs with filters and pagination',
    type: PaginatedAiAuditResDto,
    isPublic: true,
  })
  @Get('audit-logs')
  async getAuditLogs(@Query() query: QueryAiAuditDto): Promise<PaginatedAiAuditResDto> {
    const result = await this.aiAuditService.findAll(query);
    return {
      total: result.total,
      page: result.page,
      limit: result.limit,
      data: result.data.map((log) => ({
        publicId: log.publicId,
        requestId: log.requestId,
        userId: log.userId ?? undefined,
        model: log.model,
        endpoint: log.endpoint,
        systemPrompt: log.systemPrompt ?? undefined,
        userMessage: log.userMessage,
        assistantResponse: log.assistantResponse ?? undefined,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
        totalTokens: log.totalTokens,
        estimatedCost: log.estimatedCost,
        latencyMs: log.latencyMs,
        temperature: log.temperature ?? undefined,
        maxTokens: log.maxTokens ?? undefined,
        status: log.status,
        errorCode: log.errorCode ?? undefined,
        errorMessage: log.errorMessage ?? undefined,
        retryCount: log.retryCount,
        createdAt: log.createdAt,
      })),
    };
  }

  // ── Pricing / health ──────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Get per-model token pricing',
    type: ModelPricingResDto,
    isPublic: true,
  })
  @Get('models/pricing')
  getModelPricing(): ModelPricingResDto {
    return { pricing: this.openaiService.getModelPricing() };
  }

  @ApiEndpoint({
    summary: 'Health check — reports circuit breaker state',
    isPublic: true,
  })
  @Get('health')
  @SkipThrottle()
  getHealth(): HealthResponse {
    const circuitState = this.retryService.getCircuitState();
    return {
      circuitState,
      status: circuitState === 'CLOSED' ? 'ok' : 'degraded',
    };
  }

  // ── Providers ──────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'List all AI providers with model counts',
    type: [ProviderResDto],
    isPublic: true,
  })
  @Get('providers')
  async listProviders(): Promise<ProviderResDto[]> {
    const providers = await this.modelRegistryService.findAllProviders();
    return providers.map((p) => this.toProviderRes(p));
  }

  @ApiEndpoint({
    summary: 'Manually add a new AI provider',
    type: ProviderResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('providers')
  async createProvider(@Body() dto: CreateProviderDto): Promise<ProviderResDto> {
    const provider = await this.modelRegistryService.createProvider(dto);
    return this.toProviderRes(provider);
  }

  @ApiEndpoint({ summary: 'Update an AI provider', type: ProviderResDto, isPublic: true })
  @ApiBody({ type: UpdateProviderDto })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  @Patch('providers/:publicId')
  async updateProvider(
    @Param('publicId') publicId: string,
    @Body() dto: UpdateProviderDto,
  ): Promise<ProviderResDto> {
    const provider = await this.modelRegistryService.updateProvider(publicId, dto);
    return this.toProviderRes(provider);
  }

  @ApiEndpoint({ summary: 'Deactivate an AI provider', isPublic: true })
  @ApiNoContentResponse({ description: 'Provider deactivated' })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  @Delete('providers/:publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeProvider(@Param('publicId') publicId: string): Promise<void> {
    return this.modelRegistryService.deleteProvider(publicId);
  }

  // ── Model registry ─────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'List AI models with filters and pagination',
    type: PaginatedModelResDto,
    isPublic: true,
  })
  @Get('models')
  async listModels(@Query() query: QueryModelsDto): Promise<PaginatedModelResDto> {
    const result = await this.modelRegistryService.findAllModels(query);
    return { ...result, data: result.data.map((m) => this.toModelRes(m)) };
  }

  @ApiEndpoint({
    summary: 'List only free-tier AI models',
    type: PaginatedModelResDto,
    isPublic: true,
  })
  @Get('models/free')
  async listFreeModels(@Query() query: QueryModelsDto): Promise<PaginatedModelResDto> {
    const result = await this.modelRegistryService.findAllModels({
      ...query,
      tier: ModelTier.FREE,
    });
    return { ...result, data: result.data.map((m) => this.toModelRes(m)) };
  }

  @ApiEndpoint({
    summary: 'List only paid-tier AI models',
    type: PaginatedModelResDto,
    isPublic: true,
  })
  @Get('models/paid')
  async listPaidModels(@Query() query: QueryModelsDto): Promise<PaginatedModelResDto> {
    const result = await this.modelRegistryService.findAllModels({
      ...query,
      tier: ModelTier.PAID,
    });
    return { ...result, data: result.data.map((m) => this.toModelRes(m)) };
  }

  @ApiEndpoint({
    summary: 'Manually add a new AI model',
    type: ModelResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('models')
  async createModel(@Body() dto: CreateModelDto): Promise<ModelResDto> {
    const model = await this.modelRegistryService.createModel(dto);
    return this.toModelRes(model);
  }

  @ApiEndpoint({ summary: 'Update an AI model', type: ModelResDto, isPublic: true })
  @ApiBody({ type: UpdateModelDto })
  @ApiNotFoundResponse({ description: 'Model not found' })
  @Patch('models/:publicId')
  async updateModel(
    @Param('publicId') publicId: string,
    @Body() dto: UpdateModelDto,
  ): Promise<ModelResDto> {
    const model = await this.modelRegistryService.updateModel(publicId, dto);
    return this.toModelRes(model);
  }

  @ApiEndpoint({ summary: 'Deactivate an AI model', isPublic: true })
  @ApiNoContentResponse({ description: 'Model deactivated' })
  @ApiNotFoundResponse({ description: 'Model not found' })
  @Delete('models/:publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeModel(@Param('publicId') publicId: string): Promise<void> {
    return this.modelRegistryService.deleteModel(publicId);
  }

  // ── Pricing table ──────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Get the full pricing table grouped by provider',
    type: PricingTableResDto,
    isPublic: true,
  })
  @Get('pricing')
  async getPricingTable(): Promise<PricingTableResDto> {
    return this.modelRegistryService.getPricingTable();
  }

  @ApiEndpoint({
    summary: 'Calculate the cost of a request for a given model and token counts',
    type: PricingCalculateResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('pricing/calculate')
  async calculatePricing(@Body() dto: PricingCalculateDto): Promise<PricingCalculateResDto> {
    const [model, pricing] = await Promise.all([
      this.modelRegistryService.findModelByModelId(dto.modelId),
      this.modelRegistryService.getModelPricing(dto.modelId),
    ]);

    const inputCost = (dto.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (dto.outputTokens / 1_000_000) * pricing.output;
    const isFree = pricing.input === 0 && pricing.output === 0;

    return {
      model: dto.modelId,
      provider: model?.providerName ?? 'unknown',
      tier: model?.tier ?? (isFree ? ModelTier.FREE : ModelTier.PAID),
      inputCost: parseFloat(inputCost.toFixed(8)),
      outputCost: parseFloat(outputCost.toFixed(8)),
      totalCost: parseFloat((inputCost + outputCost).toFixed(8)),
      note: isFree ? 'free' : 'estimated cost',
    };
  }

  // ── OpenRouter sync ────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Trigger a manual sync of models from OpenRouter',
    type: SyncResultResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('sync/openrouter')
  async syncOpenRouter(): Promise<SyncResultResDto> {
    return this.openRouterSyncService.syncAll();
  }

  @ApiEndpoint({
    summary: 'Get OpenRouter sync status — last sync time, model and provider counts',
    type: SyncStatusResDto,
    isPublic: true,
  })
  @Get('sync/status')
  async getSyncStatus(): Promise<SyncStatusResDto> {
    const [modelsCount, providersCount] = await Promise.all([
      this.modelRegistryService.countModels(),
      this.modelRegistryService.countProviders(),
    ]);

    return {
      lastSyncedAt: this.openRouterSyncService.getLastSyncedAt() ?? undefined,
      modelsCount,
      providersCount,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toTemplateRes(template: PromptTemplateEntity): PromptTemplateResDto {
    return {
      publicId: template.publicId,
      name: template.name,
      description: template.description ?? undefined,
      systemPrompt: template.systemPrompt,
      fewShotExamples: (template.fewShotExamples ??
        undefined) as PromptTemplateResDto['fewShotExamples'],
      technique: template.technique,
      recommendedModel: template.recommendedModel,
      recommendedTemperature: template.recommendedTemperature,
      tags: template.tags,
      isActive: template.isActive,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  private toProviderRes(provider: AiProviderWithCount): ProviderResDto {
    return {
      publicId: provider.publicId,
      name: provider.name,
      slug: provider.slug,
      baseUrl: provider.baseUrl ?? undefined,
      description: provider.description ?? undefined,
      isActive: provider.isActive,
      modelCount: provider.modelCount,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }

  private toModelRes(model: AiModelEntity): ModelResDto {
    return {
      publicId: model.publicId,
      providerPublicId: model.providerPublicId,
      providerName: model.providerName,
      name: model.name,
      modelId: model.modelId,
      tier: model.tier,
      inputPricePer1M: model.inputPricePer1M,
      outputPricePer1M: model.outputPricePer1M,
      contextWindow: model.contextWindow ?? undefined,
      description: model.description ?? undefined,
      source: model.source,
      isActive: model.isActive,
      lastSyncedAt: model.lastSyncedAt ?? undefined,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }
}
