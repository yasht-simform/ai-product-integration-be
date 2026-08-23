import type OpenAI from 'openai';

import type { OpenAIModel } from '../constants/openai-model.enum';

export interface ChatCompletionParams {
  prompt: string;
  systemPrompt?: string;
  model?: OpenAIModel;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
  requestId?: string;
}

export interface MessagesCompletionParams {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
  requestId?: string;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCost: number;
  latencyMs: number;
  toolCalls?: OpenAI.Chat.ChatCompletionMessageToolCall[];
}

export interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
}
