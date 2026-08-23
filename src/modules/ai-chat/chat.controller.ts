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
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { CostBudgetGuard } from '../cost-management/guards/cost-budget.guard';
import { ModerateField } from '../moderation/decorators/moderate-field.decorator';
import { ModerateOutputField } from '../moderation/decorators/moderate-output-field.decorator';
import { ModerationGuard } from '../moderation/guards/moderation.guard';
import { OutputModerationInterceptor } from '../moderation/interceptors/output-moderation.interceptor';
import { StreamEventType } from './constants/stream-event-type.enum';
import { ToolHandlerType } from './constants/tool-handler-type.enum';
import {
  AssistantMessageResDto,
  ConversationResDto,
  ConversationWithMessagesResDto,
  CreateConversationDto,
  CreateToolDto,
  MessageResDto,
  PaginatedConversationsResDto,
  QueryConversationsDto,
  SendMessageDto,
  ToolResDto,
  UpdateConversationDto,
  UpdateToolDto,
} from './dto';
import { ChatService } from './services/chat.service';
import { ToolRegistryService } from './services/tool-registry.service';
import type {
  ChatMessageEntity,
  ConversationEntity,
  ConversationWithMessages,
  ToolEntity,
} from './types/ai-chat.types';
import { formatSseFrame } from './utils/sse-frame.util';

@ApiTags('ai-chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly toolRegistryService: ToolRegistryService,
  ) {}

  @ApiEndpoint({
    summary: 'Create a new conversation',
    type: ConversationResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('conversations')
  async createConversation(@Body() dto: CreateConversationDto): Promise<ConversationResDto> {
    const conversation = await this.chatService.createConversation(dto);
    return this.toConversationRes(conversation);
  }

  @ApiEndpoint({
    summary: 'List conversations with filters and pagination',
    type: PaginatedConversationsResDto,
    isPublic: true,
  })
  @Get('conversations')
  async findAllConversations(
    @Query() query: QueryConversationsDto,
  ): Promise<PaginatedConversationsResDto> {
    const result = await this.chatService.findAllConversations(query);
    return { ...result, data: result.data.map((c) => this.toConversationRes(c)) };
  }

  @ApiEndpoint({
    summary: 'Get a conversation with all its messages',
    type: ConversationWithMessagesResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  @Get('conversations/:publicId')
  async findConversation(
    @Param('publicId') publicId: string,
  ): Promise<ConversationWithMessagesResDto> {
    const conversation = await this.chatService.findConversation(publicId);
    return this.toConversationWithMessagesRes(conversation);
  }

  @ApiEndpoint({
    summary: 'Update a conversation title, system prompt, or model',
    type: ConversationResDto,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  @Patch('conversations/:publicId')
  async updateConversation(
    @Param('publicId') publicId: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationResDto> {
    const conversation = await this.chatService.updateConversation(publicId, dto);
    return this.toConversationRes(conversation);
  }

  @ApiEndpoint({ summary: 'Delete a conversation and all its messages', isPublic: true })
  @ApiNoContentResponse({ description: 'Conversation deleted' })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  @Delete('conversations/:publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(@Param('publicId') publicId: string): Promise<void> {
    return this.chatService.deleteConversation(publicId);
  }

  @ApiEndpoint({ summary: 'Archive a conversation', isPublic: true })
  @ApiNoContentResponse({ description: 'Conversation archived' })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  @Post('conversations/:publicId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveConversation(@Param('publicId') publicId: string): Promise<void> {
    return this.chatService.archiveConversation(publicId);
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Send a message (non-streaming) — handles tool-calling internally when enabled',
    type: AssistantMessageResDto,
    successStatus: 201,
    isPublic: true,
  })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  @UseGuards(ModerationGuard, CostBudgetGuard)
  @ModerateField('content', 'chat')
  @UseInterceptors(OutputModerationInterceptor)
  @ModerateOutputField('content', 'chat')
  @Post('conversations/:publicId/messages')
  async sendMessage(
    @Param('publicId') publicId: string,
    @Body() dto: SendMessageDto,
  ): Promise<AssistantMessageResDto> {
    return this.chatService.sendMessage(publicId, dto);
  }

  // Raw @Res() (not { passthrough: true }) hands the whole response to us — Nest never applies
  // the global ResponseInterceptor's { success, data, timestamp } envelope to whatever we return,
  // since isResponseHandled short-circuits that step entirely. @Sse() was considered instead, but
  // it always maps to a GET route by default (spec §6.2 requires POST + a JSON body) and would
  // need an AsyncGenerator→Observable adapter for no real benefit over this simpler approach.
  @ApiEndpoint({
    summary: 'Send a message and stream the assistant response via Server-Sent Events',
    isPublic: true,
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'text/event-stream — NOT a JSON body. Emits one SSE frame per StreamEvent ' +
      '(event: token | tool_call | tool_result | done | error, data: JSON-encoded payload).',
  })
  @ApiNotFoundResponse({ description: 'Conversation not found' })
  @UseGuards(ModerationGuard, CostBudgetGuard)
  @ModerateField('content', 'chat')
  @Post('conversations/:publicId/messages/stream')
  async sendMessageStream(
    @Param('publicId') publicId: string,
    @Body() dto: SendMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    // `response`, not the request: the incoming request's body (small JSON) is already fully
    // consumed by the time this handler runs, so its readable stream — and its 'close' event —
    // may already have fired before a listener could be attached here. `response` stays open for
    // the entire SSE stream, so its 'close' event reliably fires exactly once, exactly when the
    // underlying connection is terminated (client disconnect or normal end).
    response.on('close', () => abortController.abort());

    const stream = this.chatService.sendMessageStream(publicId, dto, abortController.signal);

    // Priming call: runs conversation lookup + validation + context build and blocks until the
    // first StreamEvent is ready. Nothing has touched `response` yet, so if this throws
    // (NotFoundException / BadRequestException) it propagates uncaught to the global
    // HttpExceptionFilter, which still produces the normal JSON error response for this route.
    const first = await stream.next();
    if (first.done) return;

    response.writeHead(HttpStatus.OK, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      response.write(formatSseFrame(first.value));
      for await (const event of stream) {
        response.write(formatSseFrame(event));
      }
    } catch (error) {
      // Headers are already committed at this point, so a late failure (e.g. a DB write error
      // persisting the assistant message) can't become an HTTP error status — surface it as one
      // last SSE error frame instead of crashing the connection.
      const message = error instanceof Error ? error.message : String(error);
      response.write(formatSseFrame({ type: StreamEventType.ERROR, data: { error: message } }));
    } finally {
      response.end();
    }
  }

  // ── Tools ─────────────────────────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'List all registered tools',
    type: [ToolResDto],
    isPublic: true,
  })
  @Get('tools')
  async findAllTools(): Promise<ToolResDto[]> {
    const tools = await this.toolRegistryService.findAllTools();
    return tools.map((t) => this.toToolRes(t));
  }

  @ApiEndpoint({
    summary: 'Register a new tool',
    type: ToolResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('tools')
  async createTool(@Body() dto: CreateToolDto): Promise<ToolResDto> {
    const tool = await this.toolRegistryService.createTool(dto);
    return this.toToolRes(tool);
  }

  @ApiEndpoint({ summary: 'Update a tool', type: ToolResDto, isPublic: true })
  @ApiNotFoundResponse({ description: 'Tool not found' })
  @Patch('tools/:publicId')
  async updateTool(
    @Param('publicId') publicId: string,
    @Body() dto: UpdateToolDto,
  ): Promise<ToolResDto> {
    const tool = await this.toolRegistryService.updateTool(publicId, dto);
    return this.toToolRes(tool);
  }

  @ApiEndpoint({ summary: 'Deactivate a tool', isPublic: true })
  @ApiNoContentResponse({ description: 'Tool deactivated' })
  @ApiNotFoundResponse({ description: 'Tool not found' })
  @Delete('tools/:publicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTool(@Param('publicId') publicId: string): Promise<void> {
    return this.toolRegistryService.deleteTool(publicId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private toConversationRes(conversation: ConversationEntity): ConversationResDto {
    return {
      publicId: conversation.publicId,
      title: conversation.title ?? undefined,
      systemPrompt: conversation.systemPrompt ?? undefined,
      model: conversation.model,
      toolsEnabled: conversation.toolsEnabled,
      isArchived: conversation.isArchived,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private toMessageRes(message: ChatMessageEntity): MessageResDto {
    return {
      publicId: message.publicId,
      role: message.role,
      content: message.content ?? undefined,
      toolCalls: message.toolCalls ?? undefined,
      toolCallId: message.toolCallId ?? undefined,
      toolName: message.toolName ?? undefined,
      tokenCount: message.tokenCount ?? undefined,
      cost: message.cost ?? undefined,
      latencyMs: message.latencyMs ?? undefined,
      model: message.model ?? undefined,
      createdAt: message.createdAt,
    };
  }

  private toConversationWithMessagesRes(
    conversation: ConversationWithMessages,
  ): ConversationWithMessagesResDto {
    return {
      ...this.toConversationRes(conversation),
      messages: conversation.messages.map((m) => this.toMessageRes(m)),
    };
  }

  private toToolRes(tool: ToolEntity): ToolResDto {
    return {
      publicId: tool.publicId,
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      parameters: tool.parameters,
      handlerType: tool.handlerType as ToolHandlerType,
      isActive: tool.isActive,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
    };
  }
}
