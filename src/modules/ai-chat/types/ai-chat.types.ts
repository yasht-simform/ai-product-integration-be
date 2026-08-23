import type OpenAI from 'openai';

import type { StreamEventType } from '../constants/stream-event-type.enum';
import type { CreateConversationDto } from '../dto';

export interface ConversationEntity {
  publicId: string;
  title: string | null;
  systemPrompt: string | null;
  model: string;
  userId: string | null;
  toolsEnabled: boolean;
  metadata: Record<string, unknown> | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageEntity {
  publicId: string;
  conversationId: bigint;
  role: string;
  content: string | null;
  toolCalls: unknown;
  toolCallId: string | null;
  toolName: string | null;
  tokenCount: number | null;
  cost: number | null;
  latencyMs: number | null;
  model: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface ToolEntity {
  publicId: string;
  name: string;
  displayName: string;
  description: string;
  parameters: Record<string, unknown>;
  handlerType: string;
  handlerConfig: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolCallData {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface StreamDoneData {
  messageId: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCost: number;
  latencyMs: number;
}

export interface StreamEvent {
  type: StreamEventType;
  data: string | ToolCallData | StreamDoneData | { error: string };
}

export interface StreamCompletionOptions {
  model?: string;
  temperature?: number;
  tools?: OpenAI.Chat.ChatCompletionTool[];
  signal?: AbortSignal;
}

export interface ToolExecutionResult {
  success: boolean;
  result: unknown;
  error?: string;
  executionMs: number;
}

// CreateConversationDto (AI-030) covers title/systemPrompt/model/toolsEnabled; userId and
// metadata are request-context fields the controller layer supplies, not part of the client
// payload, so they're added on top rather than folded into the DTO itself.
export interface CreateConversationParams extends CreateConversationDto {
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface PaginatedConversationsResult {
  data: ConversationEntity[];
  total: number;
  page: number;
  limit: number;
}

export interface ConversationWithMessages extends ConversationEntity {
  messages: ChatMessageEntity[];
}

// Minimal local param shape for ChatService.addAssistantMessage() (AI-020) — same rationale as
// the conversation-CRUD params above: stands in for a real DTO until one exists.

export interface AddAssistantMessageParams {
  content: string | null;
  toolCalls?: unknown;
  tokenCount?: number;
  cost?: number;
  latencyMs?: number;
  model?: string;
  incomplete?: boolean;
}
