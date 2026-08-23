import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { AiAuditLog } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { AiAuditStatus } from '../constants/ai-audit-status.enum';
import { OpenAIEndpoint } from '../constants/openai-endpoint.enum';
import { AiAuditService } from '../services/ai-audit.service';
import type { AiAuditLogEvent, QueryAiAuditDto } from '../types/ai-audit.types';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
// by substituting an empty class for the DI token. The deep mock provides the
// real interface at the call site via jest-mock-extended's type inference.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeEvent(overrides: Partial<AiAuditLogEvent> = {}): AiAuditLogEvent {
  return {
    requestId: 'req-123',
    model: 'gpt-4o',
    endpoint: OpenAIEndpoint.CHAT_COMPLETIONS,
    userMessage: 'Hello',
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    estimatedCost: 0.001,
    latencyMs: 500,
    status: AiAuditStatus.SUCCESS,
    retryCount: 0,
    ...overrides,
  };
}

function makeDbLog(overrides: Partial<AiAuditLog> = {}): AiAuditLog {
  return {
    id: BigInt(1),
    publicId: 'pub-uuid',
    requestId: 'req-123',
    userId: null,
    model: 'gpt-4o',
    endpoint: 'chat.completions',
    systemPrompt: null,
    userMessage: 'Hello',
    assistantResponse: null,
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    estimatedCost: 0.001,
    latencyMs: 500,
    temperature: null,
    maxTokens: null,
    status: 'SUCCESS',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AiAuditService', () => {
  let service: AiAuditService;
  let dbMock: DeepMockProxy<DatabaseService>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAuditService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AiAuditService>(AiAuditService);
    jest.clearAllMocks();
  });

  describe('log()', () => {
    it('calls db.aiAuditLog.create() with all mapped event fields', async () => {
      const event = makeEvent({ userId: 'u1', systemPrompt: 'You are helpful', retryCount: 1 });
      dbMock.aiAuditLog.create.mockResolvedValue(makeDbLog());

      await service.log(event);

      expect(dbMock.aiAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestId: 'req-123',
          userId: 'u1',
          model: 'gpt-4o',
          endpoint: OpenAIEndpoint.CHAT_COMPLETIONS,
          systemPrompt: 'You are helpful',
          userMessage: 'Hello',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          estimatedCost: 0.001,
          latencyMs: 500,
          status: AiAuditStatus.SUCCESS,
          retryCount: 1,
        }),
      });
    });

    it('does NOT throw when db.aiAuditLog.create() rejects', async () => {
      dbMock.aiAuditLog.create.mockRejectedValue(new Error('DB down'));
      const event = makeEvent();

      await expect(service.log(event)).resolves.toBeUndefined();
    });

    it('calls AppLoggerService.error() when DB write fails', async () => {
      dbMock.aiAuditLog.create.mockRejectedValue(new Error('connection refused'));
      const event = makeEvent();

      await service.log(event);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'AiAuditService: failed to write audit log',
        expect.stringContaining('connection refused'),
      );
    });
  });

  describe('findAll()', () => {
    it('passes the correct where clause when all filters are provided', async () => {
      const query: QueryAiAuditDto = {
        page: 1,
        limit: 10,
        model: 'gpt-4o',
        status: AiAuditStatus.SUCCESS,
        userId: 'u1',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      };
      dbMock.aiAuditLog.findMany.mockResolvedValue([makeDbLog()]);
      dbMock.aiAuditLog.count.mockResolvedValue(1);

      await service.findAll(query);

      expect(dbMock.aiAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            model: 'gpt-4o',
            status: AiAuditStatus.SUCCESS,
            userId: 'u1',
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });

    it('returns results ordered by createdAt DESC with pagination metadata', async () => {
      const logs = [makeDbLog(), makeDbLog({ id: BigInt(2) })];
      dbMock.aiAuditLog.findMany.mockResolvedValue(logs);
      dbMock.aiAuditLog.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(dbMock.aiAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
    });

    it('caps limit at 100 regardless of the requested value', async () => {
      dbMock.aiAuditLog.findMany.mockResolvedValue([]);
      dbMock.aiAuditLog.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 500 });

      expect(dbMock.aiAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('getCostSummary()', () => {
    it('aggregates costs and returns the mapped CostSummaryResult shape', async () => {
      dbMock.aiAuditLog.aggregate.mockResolvedValue({
        _count: 5,
        _sum: {
          estimatedCost: 0.05,
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          id: null,
          latencyMs: null,
          temperature: null,
          maxTokens: null,
          retryCount: null,
        },
        _avg: {
          latencyMs: 400,
          id: null,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          estimatedCost: null,
          temperature: null,
          maxTokens: null,
          retryCount: null,
        },
        _min: null,
        _max: null,
      });
      dbMock.aiAuditLog.groupBy.mockResolvedValue([
        {
          model: 'gpt-4o',
          _count: {
            _all: 3,
            id: 3,
            publicId: 3,
            requestId: 3,
            userId: 3,
            model: 3,
            endpoint: 3,
            systemPrompt: 0,
            userMessage: 3,
            assistantResponse: 0,
            inputTokens: 3,
            outputTokens: 3,
            totalTokens: 3,
            estimatedCost: 3,
            latencyMs: 3,
            temperature: 0,
            maxTokens: 0,
            status: 3,
            errorCode: 0,
            errorMessage: 0,
            retryCount: 3,
            metadata: 0,
            createdAt: 3,
          },
          _sum: {
            estimatedCost: 0.03,
            id: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            latencyMs: null,
            temperature: null,
            maxTokens: null,
            retryCount: null,
          },
          id: null,
          publicId: null,
          requestId: null,
          userId: null,
          endpoint: null,
          systemPrompt: null,
          userMessage: null,
          assistantResponse: null,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          latencyMs: null,
          temperature: null,
          maxTokens: null,
          status: null,
          errorCode: null,
          errorMessage: null,
          retryCount: null,
          metadata: null,
          createdAt: null,
          _avg: null,
          _min: null,
          _max: null,
        },
        {
          model: 'gpt-4o-mini',
          _count: {
            _all: 2,
            id: 2,
            publicId: 2,
            requestId: 2,
            userId: 2,
            model: 2,
            endpoint: 2,
            systemPrompt: 0,
            userMessage: 2,
            assistantResponse: 0,
            inputTokens: 2,
            outputTokens: 2,
            totalTokens: 2,
            estimatedCost: 2,
            latencyMs: 2,
            temperature: 0,
            maxTokens: 0,
            status: 2,
            errorCode: 0,
            errorMessage: 0,
            retryCount: 2,
            metadata: 0,
            createdAt: 2,
          },
          _sum: {
            estimatedCost: 0.02,
            id: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            latencyMs: null,
            temperature: null,
            maxTokens: null,
            retryCount: null,
          },
          id: null,
          publicId: null,
          requestId: null,
          userId: null,
          endpoint: null,
          systemPrompt: null,
          userMessage: null,
          assistantResponse: null,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          latencyMs: null,
          temperature: null,
          maxTokens: null,
          status: null,
          errorCode: null,
          errorMessage: null,
          retryCount: null,
          metadata: null,
          createdAt: null,
          _avg: null,
          _min: null,
          _max: null,
        },
      ] as never);

      const result = await service.getCostSummary({});

      expect(result.totalCost).toBe(0.05);
      expect(result.totalTokens).toBe(750);
      expect(result.totalInputTokens).toBe(500);
      expect(result.totalOutputTokens).toBe(250);
      expect(result.callCount).toBe(5);
      expect(result.averageLatencyMs).toBe(400);
      expect(result.perModelBreakdown).toHaveLength(2);
      expect(result.perModelBreakdown[0]).toEqual({ model: 'gpt-4o', cost: 0.03, callCount: 3 });
      expect(result.perModelBreakdown[1]).toEqual({
        model: 'gpt-4o-mini',
        cost: 0.02,
        callCount: 2,
      });
    });

    it('handles empty result set gracefully (all sums default to 0)', async () => {
      dbMock.aiAuditLog.aggregate.mockResolvedValue({
        _count: 0,
        _sum: null,
        _avg: null,
        _min: null,
        _max: null,
      });
      dbMock.aiAuditLog.groupBy.mockResolvedValue([]);

      const result = await service.getCostSummary({});

      expect(result.totalCost).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.callCount).toBe(0);
      expect(result.averageLatencyMs).toBe(0);
      expect(result.perModelBreakdown).toEqual([]);
    });
  });
});
