// Shared mock factories for the capstone integration test suite (spec §4, Tests 1-5). Every test
// in this directory follows the same "mock only the real external boundaries" convention already
// established by chat-function-calling.integration.spec.ts (AI-034) and
// rag-controller-delete-cascade.integration.spec.ts (AI-054): DatabaseService (Prisma) and the
// OPENAI_CLIENT/MODERATION_CLIENT SDK clients are mocked; every NestJS service/guard/interceptor in
// between is real.
import type {
  AiAuditLog,
  ChatConversation,
  ChatMessage,
  ChatTool,
} from '../../../../generated/prisma/client';

export const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

export const mockModelRegistry = {
  findModelByModelId: jest.fn().mockResolvedValue(null),
  getAllActivePricing: jest.fn().mockResolvedValue(new Map()),
};

export function makeOpenaiClientMock() {
  return {
    chat: { completions: { create: jest.fn() } },
    embeddings: { create: jest.fn() },
    moderations: { create: jest.fn() },
  };
}

export function makeConversationRow(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: BigInt(1),
    publicId: 'conv-cap-1',
    title: null,
    systemPrompt: null,
    model: 'test-org/integration-test-model',
    userId: null,
    toolsEnabled: false,
    metadata: null,
    isArchived: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function makeCalculatorToolRow(): ChatTool {
  return {
    id: BigInt(1),
    publicId: 'tool-calculator-1',
    name: 'calculator',
    displayName: 'Calculator',
    description: 'Evaluate a mathematical expression',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
    handlerType: 'builtin',
    handlerConfig: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

export function makeAuditLogRow(overrides: Partial<AiAuditLog> = {}): AiAuditLog {
  return {
    id: BigInt(1),
    publicId: 'audit-pub-1',
    requestId: 'req-1',
    userId: null,
    model: 'test-org/integration-test-model',
    endpoint: 'chat.completions',
    systemPrompt: null,
    userMessage: 'test',
    assistantResponse: null,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    estimatedCost: 0,
    latencyMs: 50,
    temperature: null,
    maxTokens: null,
    status: 'SUCCESS',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    metadata: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// Builds a fake OpenAI embeddings.create() response — deterministic, fixed-length vectors so
// PineconeService.upsert()'s mocked call receives a realistic-shaped `values` array.
export function makeEmbeddingsResponse(count: number) {
  return {
    model: 'text-embedding-3-small',
    data: Array.from({ length: count }, (_, index) => ({
      index,
      embedding: new Array<number>(8).fill(0.01 * (index + 1)),
    })),
    usage: { prompt_tokens: 10 * count, total_tokens: 10 * count },
  };
}

export function makeChatCompletionResponse(content: string) {
  return {
    id: 'chatcmpl-cap-1',
    model: 'test-org/integration-test-model',
    choices: [{ message: { content, tool_calls: undefined }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };
}

export function makeModerationResponse(flagged: boolean) {
  return {
    id: flagged ? 'modr-flagged' : 'modr-clean',
    model: 'omni-moderation-latest',
    results: [
      {
        flagged,
        categories: { violence: flagged, hate: false },
        category_scores: { violence: flagged ? 0.95 : 0.01, hate: 0.02 },
      },
    ],
  };
}

// A live-editable ChatMessage list backing a stateful dbMock.chatMessage.create mock — pushes
// every created row so a later dbMock.chatConversation.findUnique({ where: { id } }) mock can
// return the up-to-date message history for ChatService.buildContext().
export function makeChatMessageFactory() {
  let counter = 0;
  const messages: ChatMessage[] = [];

  const create = jest.fn((args: { data: Record<string, unknown> }) => {
    const data = args.data;
    const row: ChatMessage = {
      id: BigInt(++counter),
      publicId: `msg-pub-${counter}`,
      conversationId: data.conversationId as bigint,
      role: data.role as string,
      content: (data.content as string | null) ?? null,
      toolCalls: (data.toolCalls as ChatMessage['toolCalls']) ?? null,
      toolCallId: (data.toolCallId as string | null) ?? null,
      toolName: (data.toolName as string | null) ?? null,
      tokenCount: (data.tokenCount as number | null) ?? null,
      cost: (data.cost as number | null) ?? null,
      latencyMs: (data.latencyMs as number | null) ?? null,
      model: (data.model as string | null) ?? null,
      metadata: (data.metadata as ChatMessage['metadata']) ?? null,
      createdAt: new Date('2026-01-01'),
    };
    messages.push(row);
    return Promise.resolve(row);
  });

  return { create, messages };
}
