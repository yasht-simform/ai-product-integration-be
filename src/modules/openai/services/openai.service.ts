import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { AiAuditStatus } from '../constants/ai-audit-status.enum';
import { MODERATION_CLIENT, OPENAI_CLIENT } from '../constants/injection-tokens';
import { OpenAIEndpoint } from '../constants/openai-endpoint.enum';
import { OpenAIModel } from '../constants/openai-model.enum';
import { CircuitOpenException } from '../exceptions/circuit-open.exception';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
  MessagesCompletionParams,
  ModerationResult,
} from '../types/openai.types';
import { buildStaticModerationResponse } from '../utils/static-moderation-fixture.util';
import { AiAuditService } from './ai-audit.service';
import { RetryService } from './retry.service';
import { TokenService } from './token.service';

const DEFAULT_MODERATION_MODEL = 'omni-moderation-latest';
const MAX_AUDIT_TEXT_LENGTH = 1000;

@Injectable()
export class OpenaiService implements OnModuleInit {
  private isConfigured = false;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly openaiClient: OpenAI,
    @Inject(MODERATION_CLIENT) private readonly moderationClient: OpenAI,
    private readonly retryService: RetryService,
    private readonly tokenService: TokenService,
    private readonly auditService: AiAuditService,
    private readonly config: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('openai.apiKey');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY is not configured — all API calls will fail');
      this.isConfigured = false;
    } else {
      this.isConfigured = true;
    }
  }

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    this.ensureConfigured();

    const {
      prompt,
      systemPrompt,
      model = this.config.get<string>('openai.defaultModel') ?? OpenAIModel.GPT_4O,
      temperature,
      maxTokens,
      userId,
      requestId = crypto.randomUUID(),
    } = params;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    return this.executeCompletion({
      model,
      messages,
      temperature,
      maxTokens,
      userId,
      requestId,
      auditSystemPrompt: systemPrompt,
      auditUserMessage: prompt,
    });
  }

  async chatCompletionWithMessages(
    params: MessagesCompletionParams,
  ): Promise<ChatCompletionResult> {
    this.ensureConfigured();

    const {
      messages,
      tools,
      model = this.config.get<string>('openai.defaultModel') ?? OpenAIModel.GPT_4O,
      temperature,
      maxTokens,
      userId,
      requestId = crypto.randomUUID(),
    } = params;

    const auditSystemPrompt = this.extractTextContent(
      messages.find((message) => message.role === 'system')?.content,
    );
    const auditUserMessage =
      this.extractTextContent(
        [...messages].reverse().find((message) => message.role === 'user')?.content,
      ) ?? '';

    return this.executeCompletion({
      model,
      messages,
      tools,
      temperature,
      maxTokens,
      userId,
      requestId,
      auditSystemPrompt,
      auditUserMessage,
    });
  }

  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    this.ensureConfigured();
    const resolvedModel = this.resolveEmbeddingModel(model);

    const response = await this.executeEmbedding({
      model: resolvedModel,
      input: text,
      requestId: crypto.randomUUID(),
      auditUserMessage: text,
    });

    return response.data[0]?.embedding ?? [];
  }

  async generateEmbeddingsBatch(texts: string[], model?: string): Promise<number[][]> {
    this.ensureConfigured();
    const resolvedModel = this.resolveEmbeddingModel(model);

    const response = await this.executeEmbedding({
      model: resolvedModel,
      input: texts,
      requestId: crypto.randomUUID(),
      auditUserMessage: texts[0] ?? '',
    });

    return response.data.map((embedding) => embedding.embedding);
  }

  async moderateText(input: string): Promise<ModerationResult> {
    this.ensureConfigured();

    const response = await this.executeModeration({
      input,
      requestId: crypto.randomUUID(),
      auditUserMessage: input,
    });

    return this.toModerationResult(response.results[0]);
  }

  async moderateBatch(inputs: string[]): Promise<ModerationResult[]> {
    this.ensureConfigured();

    const response = await this.executeModeration({
      input: inputs,
      requestId: crypto.randomUUID(),
      auditUserMessage: inputs[0] ?? '',
    });

    return response.results.map((result) => this.toModerationResult(result));
  }

  getModelPricing(): Record<string, { input: number; output: number }> {
    return this.tokenService.getModelPricing();
  }

  private resolveEmbeddingModel(model?: string): string {
    return model ?? this.config.get<string>('rag.embeddingModel') ?? 'text-embedding-3-small';
  }

  private ensureConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('OpenAI API key is not configured');
    }
  }

  private extractTextContent(content: unknown): string | undefined {
    return typeof content === 'string' ? content : undefined;
  }

  private toModerationResult(result: OpenAI.Moderations.Moderation | undefined): ModerationResult {
    return {
      flagged: result?.flagged ?? false,
      categories: (result?.categories as unknown as Record<string, boolean>) ?? {},
      categoryScores: (result?.category_scores as unknown as Record<string, number>) ?? {},
    };
  }

  private truncateForAudit(text: string): string {
    return text.length > MAX_AUDIT_TEXT_LENGTH ? text.slice(0, MAX_AUDIT_TEXT_LENGTH) : text;
  }

  private async executeCompletion(params: {
    model: string;
    messages: OpenAI.Chat.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.ChatCompletionTool[];
    temperature?: number;
    maxTokens?: number;
    userId?: string;
    requestId: string;
    auditSystemPrompt?: string;
    auditUserMessage: string;
  }): Promise<ChatCompletionResult> {
    const {
      model,
      messages,
      tools,
      temperature,
      maxTokens,
      userId,
      requestId,
      auditSystemPrompt,
      auditUserMessage,
    } = params;

    const retryTracker = { retryCount: 0 };
    const startTime = Date.now();

    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.openaiClient.chat.completions.create({
            model,
            messages,
            ...(tools !== undefined ? { tools } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
          }),
        retryTracker,
      );

      const content = response.choices[0]?.message.content ?? '';
      const toolCalls = response.choices[0]?.message.tool_calls;
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const totalTokens = response.usage?.total_tokens ?? 0;
      const latencyMs = Date.now() - startTime;
      const estimatedCost = await this.tokenService.calculateCost(model, inputTokens, outputTokens);

      void this.auditService.log({
        requestId,
        userId,
        model,
        endpoint: OpenAIEndpoint.CHAT_COMPLETIONS,
        systemPrompt: auditSystemPrompt,
        userMessage: auditUserMessage,
        assistantResponse: content,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost,
        latencyMs,
        temperature,
        maxTokens,
        status: AiAuditStatus.SUCCESS,
        retryCount: retryTracker.retryCount,
      });

      return {
        content,
        model: response.model,
        usage: { inputTokens, outputTokens, totalTokens },
        estimatedCost,
        latencyMs,
        ...(toolCalls !== undefined ? { toolCalls } : {}),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorCode = String((error as { status?: number }).status ?? '');
      const errorMessage = error instanceof Error ? error.message : String(error);

      void this.auditService.log({
        requestId,
        userId,
        model,
        endpoint: OpenAIEndpoint.CHAT_COMPLETIONS,
        systemPrompt: auditSystemPrompt,
        userMessage: auditUserMessage,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        latencyMs,
        temperature,
        maxTokens,
        status: AiAuditStatus.FAILED,
        errorCode,
        errorMessage,
        retryCount: retryTracker.retryCount,
      });

      throw this.mapError(error);
    }
  }

  private async executeEmbedding(params: {
    model: string;
    input: string | string[];
    userId?: string;
    requestId: string;
    auditUserMessage: string;
  }): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    const { model, input, userId, requestId, auditUserMessage } = params;

    const retryTracker = { retryCount: 0 };
    const startTime = Date.now();

    try {
      const response = await this.retryService.executeWithRetry(
        () => this.openaiClient.embeddings.create({ model, input }),
        retryTracker,
      );

      const inputTokens = response.usage.prompt_tokens;
      const latencyMs = Date.now() - startTime;
      const estimatedCost = await this.tokenService.calculateCost(model, inputTokens, 0);

      void this.auditService.log({
        requestId,
        userId,
        model,
        endpoint: OpenAIEndpoint.EMBEDDINGS,
        userMessage: auditUserMessage,
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
        estimatedCost,
        latencyMs,
        status: AiAuditStatus.SUCCESS,
        retryCount: retryTracker.retryCount,
      });

      return response;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorCode = String((error as { status?: number }).status ?? '');
      const errorMessage = error instanceof Error ? error.message : String(error);

      void this.auditService.log({
        requestId,
        userId,
        model,
        endpoint: OpenAIEndpoint.EMBEDDINGS,
        userMessage: auditUserMessage,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        latencyMs,
        status: AiAuditStatus.FAILED,
        errorCode,
        errorMessage,
        retryCount: retryTracker.retryCount,
      });

      throw this.mapError(error);
    }
  }

  private async executeModeration(params: {
    input: string | string[];
    userId?: string;
    requestId: string;
    auditUserMessage: string;
  }): Promise<OpenAI.Moderations.ModerationCreateResponse> {
    const { input, userId, requestId, auditUserMessage } = params;

    const retryTracker = { retryCount: 0 };
    const startTime = Date.now();
    const staticMode = this.config.get<boolean>('openai.moderationStaticMode') ?? false;

    if (staticMode) {
      this.logger.warn(
        'OpenaiService: MODERATION_STATIC_MODE is enabled — returning a canned fixture response instead of a live moderation call',
      );
    }

    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          staticMode
            ? Promise.resolve(buildStaticModerationResponse(input))
            : this.moderationClient.moderations.create({ input }),
        retryTracker,
      );

      const latencyMs = Date.now() - startTime;

      void this.auditService.log({
        requestId,
        userId,
        model: response.model,
        endpoint: OpenAIEndpoint.MODERATIONS,
        userMessage: this.truncateForAudit(auditUserMessage),
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        latencyMs,
        status: AiAuditStatus.SUCCESS,
        retryCount: retryTracker.retryCount,
      });

      return response;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorCode = String((error as { status?: number }).status ?? '');
      const errorMessage = error instanceof Error ? error.message : String(error);

      void this.auditService.log({
        requestId,
        userId,
        model: DEFAULT_MODERATION_MODEL,
        endpoint: OpenAIEndpoint.MODERATIONS,
        userMessage: this.truncateForAudit(auditUserMessage),
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        latencyMs,
        status: AiAuditStatus.FAILED,
        errorCode,
        errorMessage,
        retryCount: retryTracker.retryCount,
      });

      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): HttpException {
    if (error instanceof CircuitOpenException) return error;
    if (error instanceof HttpException) return error;
    const status = (error as { status?: number }).status;
    if (status === 429) {
      return new HttpException('OpenAI rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    return new HttpException(
      error instanceof Error ? error.message : 'OpenAI request failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
