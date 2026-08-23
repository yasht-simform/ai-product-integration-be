import type { AiAuditLog } from '../../../../generated/prisma/client';
import type { AiAuditStatus } from '../constants/ai-audit-status.enum';
import type { OpenAIEndpoint } from '../constants/openai-endpoint.enum';

export interface AiAuditLogEvent {
  requestId: string;
  userId?: string;
  model: string;
  endpoint: OpenAIEndpoint;
  systemPrompt?: string;
  userMessage: string;
  assistantResponse?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  latencyMs: number;
  temperature?: number;
  maxTokens?: number;
  status: AiAuditStatus;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  metadata?: Record<string, unknown>;
}

export interface QueryAiAuditDto {
  page?: number;
  limit?: number;
  model?: string;
  status?: AiAuditStatus;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export interface PaginatedAiAuditResult {
  data: AiAuditLog[];
  total: number;
  page: number;
  limit: number;
}

export interface CostSummaryQueryDto {
  userId?: string;
  model?: string;
  startDate?: string;
  endDate?: string;
}

export interface ModelCostBreakdown {
  model: string;
  cost: number;
  callCount: number;
}

export interface CostSummaryResult {
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  averageLatencyMs: number;
  perModelBreakdown: ModelCostBreakdown[];
}
