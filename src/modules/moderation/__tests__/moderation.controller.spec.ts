import { Test, type TestingModule } from '@nestjs/testing';
import type { Request } from 'express';

import { ModerationDirection } from '../constants/moderation-direction.constant';
import { ModerationController } from '../moderation.controller';
import { ModerationService } from '../services/moderation.service';
import type {
  ModerationLogEntity,
  ModerationResult,
  ModerationStatsResult,
  PaginatedModerationLogsResult,
} from '../types/moderation.types';

// ModerationController imports ModerationService, which imports DatabaseService → the
// Prisma-generated ESM client (import.meta.url) — must be hoisted before any transitive import.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

function makeRequest(
  overrides: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return {
    headers: overrides.headers ?? {},
    body: overrides.body ?? {},
  } as unknown as Request;
}

function makeCleanResult(): ModerationResult {
  return {
    isFlagged: false,
    categories: { hate: false },
    categoryScores: { hate: 0.001 },
    flaggedCategories: [],
    highestScore: { category: 'hate', score: 0.001 },
  };
}

function makeLogEntity(overrides: Partial<ModerationLogEntity> = {}): ModerationLogEntity {
  return {
    publicId: 'mod-pub-1',
    requestId: 'req-1',
    userId: 'user-1',
    direction: ModerationDirection.INPUT,
    content: 'hello',
    isFlagged: false,
    categories: { hate: false },
    categoryScores: { hate: 0.001 },
    action: 'allowed',
    source: 'chat',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ModerationController (AI-071)', () => {
  let controller: ModerationController;
  let serviceMock: {
    moderateText: jest.Mock;
    moderateBatch: jest.Mock;
    getModerationLogs: jest.Mock;
    getModerationStats: jest.Mock;
  };

  beforeEach(async () => {
    serviceMock = {
      moderateText: jest.fn(),
      moderateBatch: jest.fn(),
      getModerationLogs: jest.fn(),
      getModerationStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModerationController],
      providers: [{ provide: ModerationService, useValue: serviceMock }],
    }).compile();

    controller = module.get<ModerationController>(ModerationController);
  });

  describe('check()', () => {
    it('delegates to moderateText() with direction input and source defaulting to standalone', async () => {
      const result = makeCleanResult();
      serviceMock.moderateText.mockResolvedValue(result);

      const response = await controller.check({ text: 'hello' }, makeRequest());

      expect(serviceMock.moderateText).toHaveBeenCalledWith('hello', {
        source: 'standalone',
        direction: ModerationDirection.INPUT,
        userId: undefined,
      });
      expect(response).toBe(result);
    });

    it('passes a caller-supplied source through instead of the default', async () => {
      serviceMock.moderateText.mockResolvedValue(makeCleanResult());

      await controller.check({ text: 'hello', source: 'rag' }, makeRequest());

      expect(serviceMock.moderateText).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ source: 'rag' }),
      );
    });

    it('resolves userId from the x-user-id header', async () => {
      serviceMock.moderateText.mockResolvedValue(makeCleanResult());

      await controller.check(
        { text: 'hello' },
        makeRequest({ headers: { 'x-user-id': 'user-9' } }),
      );

      expect(serviceMock.moderateText).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ userId: 'user-9' }),
      );
    });
  });

  describe('checkBatch()', () => {
    it('delegates dto.texts to moderateBatch() and returns the array as-is', async () => {
      const results = [makeCleanResult(), makeCleanResult()];
      serviceMock.moderateBatch.mockResolvedValue(results);

      const response = await controller.checkBatch({ texts: ['a', 'b'] });

      expect(serviceMock.moderateBatch).toHaveBeenCalledWith(['a', 'b']);
      expect(response).toBe(results);
    });
  });

  describe('getModerationLogs()', () => {
    it('delegates the query and maps null fields to undefined', async () => {
      const result: PaginatedModerationLogsResult = {
        data: [makeLogEntity({ requestId: null, userId: null })],
        total: 1,
        page: 1,
        limit: 20,
      };
      serviceMock.getModerationLogs.mockResolvedValue(result);

      const response = await controller.getModerationLogs({ userId: 'user-1' });

      expect(serviceMock.getModerationLogs).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(response.data[0]?.requestId).toBeUndefined();
      expect(response.data[0]?.userId).toBeUndefined();
      expect(response.total).toBe(1);
    });

    it('passes non-null fields through unchanged', async () => {
      const result: PaginatedModerationLogsResult = {
        data: [makeLogEntity()],
        total: 1,
        page: 1,
        limit: 20,
      };
      serviceMock.getModerationLogs.mockResolvedValue(result);

      const response = await controller.getModerationLogs({});

      expect(response.data[0]).toEqual(
        expect.objectContaining({ publicId: 'mod-pub-1', requestId: 'req-1', userId: 'user-1' }),
      );
    });
  });

  describe('getModerationStats()', () => {
    it('delegates to getModerationStats() and returns the result as-is', async () => {
      const stats: ModerationStatsResult = {
        totalChecks: 10,
        flaggedCount: 2,
        violationRate: 0.2,
        byDirection: { input: 8, output: 2 },
        topCategories: [{ category: 'sexual', count: 2 }],
      };
      serviceMock.getModerationStats.mockResolvedValue(stats);

      const response = await controller.getModerationStats({});

      expect(serviceMock.getModerationStats).toHaveBeenCalledWith({});
      expect(response).toBe(stats);
    });
  });
});
