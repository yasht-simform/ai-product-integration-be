import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';

import type { ChatConversation, ChatMessage, Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { AiAuditStatus } from '../../openai/constants/ai-audit-status.enum';
import { OpenAIEndpoint } from '../../openai/constants/openai-endpoint.enum';
import { OpenAIModel } from '../../openai/constants/openai-model.enum';
import { AiAuditService } from '../../openai/services/ai-audit.service';
import { ModelRegistryService } from '../../openai/services/model-registry.service';
import { OpenaiService } from '../../openai/services/openai.service';
import { TokenService } from '../../openai/services/token.service';
import type { ChatCompletionResult } from '../../openai/types/openai.types';
import { ChatMessageRole } from '../constants/chat-message-role.enum';
import { CONTEXT_CONFIG } from '../constants/context-config.constant';
import { StreamEventType } from '../constants/stream-event-type.enum';
import type {
  AssistantMessageResDto,
  QueryConversationsDto,
  SendMessageDto,
  UpdateConversationDto,
} from '../dto';
import type {
  AddAssistantMessageParams,
  ChatMessageEntity,
  ConversationEntity,
  ConversationWithMessages,
  CreateConversationParams,
  PaginatedConversationsResult,
  StreamEvent,
  ToolCallData,
} from '../types/ai-chat.types';
import { StreamingService } from './streaming.service';
import { ToolExecutorService } from './tool-executor.service';
import { ToolRegistryService } from './tool-registry.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: AppLoggerService,
    private readonly configService: ConfigService,
    private readonly openaiService: OpenaiService,
    private readonly tokenService: TokenService,
    private readonly modelRegistryService: ModelRegistryService,
    private readonly toolRegistryService: ToolRegistryService,
    private readonly toolExecutorService: ToolExecutorService,
    private readonly streamingService: StreamingService,
    private readonly aiAuditService: AiAuditService,
  ) {}

  async createConversation(params: CreateConversationParams): Promise<ConversationEntity> {
    const conversation = await this.db.chatConversation.create({
      data: {
        title: params.title,
        systemPrompt: params.systemPrompt,
        model:
          params.model ??
          this.configService.get<string>('openai.defaultModel') ??
          OpenAIModel.GPT_4O,
        userId: params.userId,
        toolsEnabled: params.toolsEnabled ?? false,
        metadata: params.metadata as Prisma.InputJsonValue,
      },
    });
    return this.toConversationEntity(conversation);
  }

  async findAllConversations(query: QueryConversationsDto): Promise<PaginatedConversationsResult> {
    const { page = 1, limit = 20, userId, isArchived } = query;
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where: Prisma.ChatConversationWhereInput = {};
    if (userId) where.userId = userId;
    if (isArchived !== undefined) where.isArchived = isArchived;

    const [conversations, total] = await Promise.all([
      this.db.chatConversation.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
      }),
      this.db.chatConversation.count({ where }),
    ]);

    return {
      data: conversations.map((c) => this.toConversationEntity(c)),
      total,
      page,
      limit: take,
    };
  }

  async findConversation(publicId: string): Promise<ConversationWithMessages> {
    const conversation = await this.db.chatConversation.findUnique({
      where: { publicId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation "${publicId}" not found`);
    }

    return {
      ...this.toConversationEntity(conversation),
      messages: conversation.messages.map((m) => this.toMessageEntity(m)),
    };
  }

  async updateConversation(
    publicId: string,
    params: UpdateConversationDto,
  ): Promise<ConversationEntity> {
    await this.findConversationOrThrow(publicId);

    const conversation = await this.db.chatConversation.update({
      where: { publicId },
      data: {
        title: params.title,
        systemPrompt: params.systemPrompt,
        model: params.model,
      },
    });
    return this.toConversationEntity(conversation);
  }

  async archiveConversation(publicId: string): Promise<void> {
    await this.findConversationOrThrow(publicId);
    await this.db.chatConversation.update({ where: { publicId }, data: { isArchived: true } });
  }

  async deleteConversation(publicId: string): Promise<void> {
    await this.findConversationOrThrow(publicId);
    await this.db.chatConversation.delete({ where: { publicId } });
  }

  // Cross-module callers (e.g. RagService, AI-047) that need to drive buildContext()/
  // addUserMessage()/addAssistantMessage() only ever have a conversation's publicId — those three
  // methods operate on the internal bigint row id, which ConversationEntity deliberately never
  // exposes. This is the minimal seam: resolve id + the conversation's configured model together
  // in one lookup, mirroring sendMessage()'s own `dto.model ?? conversation.model` fallback so a
  // RAG-augmented turn respects the same per-conversation model a normal turn would.
  async getConversationHandle(publicId: string): Promise<{ id: bigint; model: string }> {
    const conversation = await this.findConversationOrThrow(publicId);
    return { id: conversation.id, model: conversation.model };
  }

  async addUserMessage(conversationId: bigint, content: string): Promise<ChatMessageEntity> {
    const message = await this.db.chatMessage.create({
      data: {
        conversationId,
        role: ChatMessageRole.USER,
        content,
      },
    });

    await this.maybeSetAutoTitle(conversationId, content);

    return this.toMessageEntity(message);
  }

  async addAssistantMessage(
    conversationId: bigint,
    params: AddAssistantMessageParams,
  ): Promise<ChatMessageEntity> {
    const message = await this.db.chatMessage.create({
      data: {
        conversationId,
        role: ChatMessageRole.ASSISTANT,
        content: params.content,
        toolCalls: params.toolCalls as Prisma.InputJsonValue,
        tokenCount: params.tokenCount,
        cost: params.cost,
        latencyMs: params.latencyMs,
        model: params.model,
        metadata: params.incomplete ? { incomplete: true } : undefined,
      },
    });
    return this.toMessageEntity(message);
  }

  async addToolResult(
    conversationId: bigint,
    toolCallId: string,
    toolName: string,
    result: unknown,
  ): Promise<ChatMessageEntity> {
    const message = await this.db.chatMessage.create({
      data: {
        conversationId,
        role: ChatMessageRole.TOOL,
        content: JSON.stringify(result),
        toolCallId,
        toolName,
      },
    });
    return this.toMessageEntity(message);
  }

  async sendMessage(
    conversationPublicId: string,
    dto: SendMessageDto,
  ): Promise<AssistantMessageResDto> {
    const conversation = await this.findConversationOrThrow(conversationPublicId);

    if (!dto.content.trim()) {
      throw new BadRequestException('content must not be empty or whitespace-only');
    }

    await this.addUserMessage(conversation.id, dto.content);

    const model = dto.model ?? conversation.model;
    const result = await this.callModel(conversation, dto, model, conversation.toolsEnabled);

    if (conversation.toolsEnabled && result.toolCalls?.length) {
      return this.handleToolCalls(conversation, dto, model, result);
    }

    return this.persistAssistantResponse(conversation.id, result);
  }

  // Mirrors sendMessage() (AI-022/AI-027) but streams: re-yields every StreamingService event
  // (AI-028) as it arrives, then persists the accumulated result exactly once the generator ends
  // — normally, on client disconnect (abortSignal fires), or on a mid-stream SDK error (spec
  // §7.3/§7.4). This call bypasses OpenaiService.chatCompletionWithMessages() entirely (AI-028
  // talks to OPENAI_CLIENT directly), so audit logging isn't inherited for free — it's this
  // method's own responsibility.
  async *sendMessageStream(
    conversationPublicId: string,
    dto: SendMessageDto,
    abortSignal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const conversation = await this.findConversationOrThrow(conversationPublicId);

    if (!dto.content.trim()) {
      throw new BadRequestException('content must not be empty or whitespace-only');
    }

    await this.addUserMessage(conversation.id, dto.content);

    const model = dto.model ?? conversation.model;
    const messages = await this.buildContext(conversation.id);
    const definitions = conversation.toolsEnabled
      ? await this.toolRegistryService.getToolDefinitions()
      : [];

    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let accumulatedContent = '';
    const toolCalls: ToolCallData[] = [];
    let streamErrorMessage: string | undefined;

    for await (const event of this.streamingService.streamCompletion(messages, {
      model,
      temperature: dto.temperature,
      tools: definitions.length > 0 ? definitions : undefined,
      signal: abortSignal,
    })) {
      if (event.type === StreamEventType.TOKEN) {
        accumulatedContent += event.data as string;
      } else if (event.type === StreamEventType.TOOL_CALL) {
        toolCalls.push(event.data as ToolCallData);
      } else if (event.type === StreamEventType.ERROR) {
        streamErrorMessage = (event.data as { error: string }).error;
      }
      yield event;
    }

    const latencyMs = Date.now() - startTime;
    const incomplete = abortSignal.aborted || streamErrorMessage !== undefined;

    const inputTokens = this.countMessagesTokens(messages, model);
    const outputTokens = this.tokenService.countTokens(accumulatedContent, model);
    const totalTokens = inputTokens + outputTokens;
    const estimatedCost = await this.tokenService.calculateCost(model, inputTokens, outputTokens);

    const assistantMessage = await this.addAssistantMessage(conversation.id, {
      content: accumulatedContent || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokenCount: totalTokens,
      cost: estimatedCost,
      latencyMs,
      model,
      incomplete,
    });

    void this.aiAuditService.log({
      requestId,
      userId: conversation.userId ?? undefined,
      model,
      endpoint: OpenAIEndpoint.CHAT_COMPLETIONS,
      systemPrompt: conversation.systemPrompt ?? undefined,
      userMessage: dto.content,
      assistantResponse: accumulatedContent || undefined,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost,
      latencyMs,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      status: incomplete ? AiAuditStatus.FAILED : AiAuditStatus.SUCCESS,
      errorMessage: streamErrorMessage,
      retryCount: 0,
    });

    if (!incomplete) {
      yield {
        type: StreamEventType.DONE,
        data: {
          messageId: assistantMessage.publicId,
          usage: { inputTokens, outputTokens, totalTokens },
          estimatedCost,
          latencyMs,
        },
      };
    }
  }

  private countMessagesTokens(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    model: string,
  ): number {
    return messages.reduce((sum, message) => {
      const text = typeof message.content === 'string' ? message.content : '';
      return sum + (text ? this.tokenService.countTokens(text, model) : 0);
    }, 0);
  }

  private async callModel(
    conversation: ChatConversation,
    dto: SendMessageDto,
    model: string,
    withTools: boolean,
  ): Promise<ChatCompletionResult> {
    const messages = await this.buildContext(conversation.id);
    const definitions = withTools ? await this.toolRegistryService.getToolDefinitions() : [];

    return this.openaiService.chatCompletionWithMessages({
      messages,
      tools: definitions.length > 0 ? definitions : undefined,
      model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      userId: conversation.userId ?? undefined,
    });
  }

  // Two-call protocol (spec §2.4/§8.1): the model first decides which tools to call, this
  // executes them concurrently and persists each result, then a second, tools-less call lets the
  // model synthesize a final answer from the tool results now in context.
  private async handleToolCalls(
    conversation: ChatConversation,
    dto: SendMessageDto,
    model: string,
    firstResult: ChatCompletionResult,
  ): Promise<AssistantMessageResDto> {
    const toolCalls = (firstResult.toolCalls ?? []).filter(
      (toolCall): toolCall is OpenAI.Chat.ChatCompletionMessageFunctionToolCall =>
        toolCall.type === 'function',
    );

    await this.addAssistantMessage(conversation.id, {
      content: firstResult.content || null,
      toolCalls,
      tokenCount: firstResult.usage.totalTokens,
      cost: firstResult.estimatedCost,
      latencyMs: firstResult.latencyMs,
      model: firstResult.model,
    });

    await Promise.all(
      toolCalls.map(async (toolCall) => {
        const args = this.parseToolArguments(toolCall.function.arguments);
        const executionResult = await this.toolExecutorService.execute(
          toolCall.function.name,
          args,
        );
        await this.addToolResult(
          conversation.id,
          toolCall.id,
          toolCall.function.name,
          executionResult,
        );
      }),
    );

    const synthesisResult = await this.callModel(conversation, dto, model, false);
    return this.persistAssistantResponse(conversation.id, synthesisResult);
  }

  private parseToolArguments(rawArguments: string): Record<string, unknown> {
    try {
      return JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async persistAssistantResponse(
    conversationId: bigint,
    result: ChatCompletionResult,
  ): Promise<AssistantMessageResDto> {
    const assistantMessage = await this.addAssistantMessage(conversationId, {
      content: result.content || null,
      toolCalls: result.toolCalls,
      tokenCount: result.usage.totalTokens,
      cost: result.estimatedCost,
      latencyMs: result.latencyMs,
      model: result.model,
    });

    return {
      messageId: assistantMessage.publicId,
      role: ChatMessageRole.ASSISTANT,
      content: assistantMessage.content ?? undefined,
      model: result.model,
      toolCalls: result.toolCalls,
      usage: result.usage,
      estimatedCost: result.estimatedCost,
      latencyMs: result.latencyMs,
    };
  }

  async buildContext(conversationId: bigint): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const maxMessages =
      this.configService.get<number>('chat.maxContextMessages') ?? CONTEXT_CONFIG.maxMessages;
    const contextWindowPercentage =
      this.configService.get<number>('chat.contextWindowPercentage') ??
      CONTEXT_CONFIG.contextWindowPercentage;
    const defaultContextWindow =
      this.configService.get<number>('chat.defaultContextWindow') ??
      CONTEXT_CONFIG.defaultContextWindow;

    const conversation = await this.db.chatConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: maxMessages },
      },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation with id "${conversationId}" not found`);
    }

    const messages = conversation.messages.slice().reverse();

    const modelInfo = await this.modelRegistryService.findModelByModelId(conversation.model);
    const contextWindow = modelInfo?.contextWindow ?? defaultContextWindow;
    const budget = contextWindow * contextWindowPercentage;

    const systemTokens = conversation.systemPrompt
      ? this.tokenService.countTokens(conversation.systemPrompt, conversation.model)
      : 0;

    const trimmed = this.trimToBudget(messages, systemTokens, budget, conversation.model);
    const mapped = trimmed.map((m) => this.toChatCompletionMessageParam(m));

    if (!conversation.systemPrompt) return mapped;

    const systemEntry: OpenAI.Chat.ChatCompletionSystemMessageParam = {
      role: 'system',
      content: conversation.systemPrompt,
    };
    return [systemEntry, ...mapped];
  }

  private trimToBudget(
    messages: ChatMessage[],
    systemTokens: number,
    budget: number,
    model: string,
  ): ChatMessage[] {
    const trimmed = [...messages];
    let total =
      systemTokens + trimmed.reduce((sum, m) => sum + this.countMessageTokens(m, model), 0);

    while (trimmed.length > 1 && total > budget) {
      const removed = trimmed.shift()!;
      total -= this.countMessageTokens(removed, model);
    }

    if (trimmed.length === 1) {
      const only = trimmed[0];
      const remainingBudget = budget - systemTokens;
      if (this.countMessageTokens(only, model) > remainingBudget) {
        only.content = this.truncateContentToBudget(only.content, remainingBudget, model);
      }
    }

    return trimmed;
  }

  private countMessageTokens(message: ChatMessage, model: string): number {
    return message.content ? this.tokenService.countTokens(message.content, model) : 0;
  }

  private truncateContentToBudget(
    content: string | null,
    tokenBudget: number,
    model: string,
  ): string | null {
    if (!content) return content;

    let truncated = content;
    let tokens = this.tokenService.countTokens(truncated, model);
    while (tokens > tokenBudget && truncated.length > 1) {
      const ratio = Math.max(tokenBudget / tokens, 0.1);
      truncated = truncated.slice(0, Math.max(1, Math.floor(truncated.length * ratio)));
      tokens = this.tokenService.countTokens(truncated, model);
    }
    return truncated;
  }

  private toChatCompletionMessageParam(
    message: ChatMessage,
  ): OpenAI.Chat.ChatCompletionMessageParam {
    if ((message.role as ChatMessageRole) === ChatMessageRole.TOOL) {
      return {
        role: 'tool',
        content: message.content ?? '',
        tool_call_id: message.toolCallId ?? '',
      };
    }

    if ((message.role as ChatMessageRole) === ChatMessageRole.ASSISTANT) {
      const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: message.content,
      };
      if (message.toolCalls) {
        assistantMessage.tool_calls =
          message.toolCalls as unknown as OpenAI.Chat.ChatCompletionMessageToolCall[];
      }
      return assistantMessage;
    }

    return { role: 'user', content: message.content ?? '' };
  }

  private async maybeSetAutoTitle(conversationId: bigint, content: string): Promise<void> {
    if (!this.configService.get<boolean>('chat.autoTitle')) return;

    const conversation = await this.db.chatConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.title !== null) return;

    await this.db.chatConversation.update({
      where: { id: conversationId },
      data: { title: this.buildAutoTitle(content) },
    });
  }

  private buildAutoTitle(content: string): string {
    return `${content.slice(0, 50)}...`;
  }

  private async findConversationOrThrow(publicId: string): Promise<ChatConversation> {
    const conversation = await this.db.chatConversation.findUnique({ where: { publicId } });
    if (!conversation) {
      throw new NotFoundException(`Conversation "${publicId}" not found`);
    }
    return conversation;
  }

  private toConversationEntity(conversation: ChatConversation): ConversationEntity {
    return {
      publicId: conversation.publicId,
      title: conversation.title,
      systemPrompt: conversation.systemPrompt,
      model: conversation.model,
      userId: conversation.userId,
      toolsEnabled: conversation.toolsEnabled,
      metadata: conversation.metadata as Record<string, unknown> | null,
      isArchived: conversation.isArchived,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private toMessageEntity(message: ChatMessage): ChatMessageEntity {
    return {
      publicId: message.publicId,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      tokenCount: message.tokenCount,
      cost: message.cost,
      latencyMs: message.latencyMs,
      model: message.model,
      metadata: message.metadata,
      createdAt: message.createdAt,
    };
  }
}
