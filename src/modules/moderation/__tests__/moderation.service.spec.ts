import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { OpenaiService } from '../../openai/services/openai.service';
import type { ModerationResult as OpenAiModerationResult } from '../../openai/types/openai.types';
import { ModerationAction } from '../constants/moderation-action.constant';
import { ModerationDirection } from '../constants/moderation-direction.constant';
import { ModerationService } from '../services/moderation.service';

// ModerationService imports DatabaseService, which imports the Prisma-generated ESM client.
// Mocking DatabaseService prevents Jest (CommonJS) from loading import.meta.url at runtime.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const cleanModeration = (): OpenAiModerationResult => ({
  flagged: false,
  categories: { hate: false, sexual: false, violence: false },
  categoryScores: { hate: 0.001, sexual: 0.002, violence: 0.02 },
});

const flaggedModeration = (): OpenAiModerationResult => ({
  flagged: true,
  categories: { hate: false, sexual: true, violence: false },
  categoryScores: { hate: 0.001, sexual: 0.85, violence: 0.02 },
});

describe('ModerationService', () => {
  let service: ModerationService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let configMock: { get: jest.Mock };
  let openaiServiceMock: { moderateText: jest.Mock; moderateBatch: jest.Mock };

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();
    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return true;
        if (key === 'moderation.blockThreshold') return 0.7;
        return undefined;
      }),
    };
    openaiServiceMock = {
      moderateText: jest.fn().mockResolvedValue(cleanModeration()),
      moderateBatch: jest.fn().mockResolvedValue([cleanModeration()]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: OpenaiService, useValue: openaiServiceMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ModerationService>(ModerationService);
    dbMock.moderationLog.create.mockResolvedValue({} as never);
  });

  describe('moderateText() — clean input', () => {
    it('returns isFlagged: false with categories/scores passed through', async () => {
      const result = await service.moderateText('hello world');

      expect(result).toEqual({
        isFlagged: false,
        categories: { hate: false, sexual: false, violence: false },
        categoryScores: { hate: 0.001, sexual: 0.002, violence: 0.02 },
        flaggedCategories: [],
        highestScore: { category: 'violence', score: 0.02 },
      });
    });

    it('logs exactly one moderation_logs row with action ALLOWED', async () => {
      await service.moderateText('hello world', { userId: 'user-1', source: 'chat' });

      expect(dbMock.moderationLog.create).toHaveBeenCalledTimes(1);
      expect(dbMock.moderationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          direction: ModerationDirection.INPUT,
          content: 'hello world',
          isFlagged: false,
          action: ModerationAction.ALLOWED,
          source: 'chat',
        }),
      });
    });
  });

  describe('moderateText() — flagged input', () => {
    it('returns isFlagged: true with flaggedCategories and highestScore computed', async () => {
      openaiServiceMock.moderateText.mockResolvedValue(flaggedModeration());

      const result = await service.moderateText('bad input');

      expect(result.isFlagged).toBe(true);
      expect(result.flaggedCategories).toEqual(['sexual']);
      expect(result.highestScore).toEqual({ category: 'sexual', score: 0.85 });
    });

    it('logs action BLOCKED by default when flagged', async () => {
      openaiServiceMock.moderateText.mockResolvedValue(flaggedModeration());

      await service.moderateText('bad input');

      expect(dbMock.moderationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isFlagged: true, action: ModerationAction.BLOCKED }),
      });
    });

    it('logs the caller-supplied action (e.g. REPLACED) when flagged', async () => {
      openaiServiceMock.moderateText.mockResolvedValue(flaggedModeration());

      await service.moderateText('bad input', { action: ModerationAction.REPLACED });

      expect(dbMock.moderationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: ModerationAction.REPLACED }),
      });
    });

    it('flags a category via score threshold even when the API boolean was false', async () => {
      openaiServiceMock.moderateText.mockResolvedValue({
        flagged: false,
        categories: { hate: false, sexual: false, violence: false },
        categoryScores: { hate: 0.001, sexual: 0.75, violence: 0.02 },
      });

      const result = await service.moderateText('borderline input');

      expect(result.isFlagged).toBe(true);
      expect(result.flaggedCategories).toEqual(['sexual']);
    });

    it('uses a custom moderation.blockThreshold from config', async () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return true;
        if (key === 'moderation.blockThreshold') return 0.9;
        return undefined;
      });
      openaiServiceMock.moderateText.mockResolvedValue({
        flagged: false,
        categories: { hate: false, sexual: false, violence: false },
        categoryScores: { hate: 0.001, sexual: 0.85, violence: 0.02 },
      });

      const result = await service.moderateText('borderline input');

      expect(result.isFlagged).toBe(false);
    });
  });

  describe('moderateText() — content truncation', () => {
    it('truncates content to 1000 characters in the logged row', async () => {
      const longText = 'a'.repeat(1500);

      await service.moderateText(longText);

      expect(dbMock.moderationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ content: 'a'.repeat(1000) }),
      });
    });
  });

  describe('moderateText() — API failure (fail open)', () => {
    it('returns a clean result and logs a failedOpen metadata row when the API throws', async () => {
      openaiServiceMock.moderateText.mockRejectedValue(new Error('moderation API down'));

      const result = await service.moderateText('hello world');

      expect(result).toEqual({
        isFlagged: false,
        categories: {},
        categoryScores: {},
        flaggedCategories: [],
        highestScore: { category: '', score: 0 },
      });
      expect(mockLogger.error).toHaveBeenCalled();
      expect(dbMock.moderationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isFlagged: false,
          action: ModerationAction.ALLOWED,
          metadata: { failedOpen: true },
        }),
      });
    });

    it('still resolves the check even when the fire-and-forget DB write rejects', async () => {
      dbMock.moderationLog.create.mockRejectedValue(new Error('db down'));

      await expect(service.moderateText('hello world')).resolves.toEqual(
        expect.objectContaining({ isFlagged: false }),
      );
    });
  });

  describe('moderateText() — MODERATION_ENABLED kill switch', () => {
    it('returns a clean result with zero OpenaiService calls and zero DB writes when disabled', async () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return false;
        return undefined;
      });

      const result = await service.moderateText('anything');

      expect(result.isFlagged).toBe(false);
      expect(openaiServiceMock.moderateText).not.toHaveBeenCalled();
      expect(dbMock.moderationLog.create).not.toHaveBeenCalled();
    });
  });

  describe('moderateBatch()', () => {
    it('returns one result per input in order', async () => {
      openaiServiceMock.moderateBatch.mockResolvedValue([
        cleanModeration(),
        flaggedModeration(),
        cleanModeration(),
      ]);

      const results = await service.moderateBatch(['a', 'b', 'c']);

      expect(results).toHaveLength(3);
      expect(results[0]?.isFlagged).toBe(false);
      expect(results[1]?.isFlagged).toBe(true);
      expect(results[2]?.isFlagged).toBe(false);
      expect(openaiServiceMock.moderateBatch).toHaveBeenCalledWith(['a', 'b', 'c']);
    });

    it('logs one moderation_logs row per input', async () => {
      openaiServiceMock.moderateBatch.mockResolvedValue([cleanModeration(), flaggedModeration()]);

      await service.moderateBatch(['a', 'b']);

      expect(dbMock.moderationLog.create).toHaveBeenCalledTimes(2);
      expect(dbMock.moderationLog.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({ content: 'a', action: ModerationAction.ALLOWED }),
      });
      expect(dbMock.moderationLog.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({ content: 'b', action: ModerationAction.BLOCKED }),
      });
    });

    it('fails open with one clean result + failedOpen log row per input when the API throws', async () => {
      openaiServiceMock.moderateBatch.mockRejectedValue(new Error('batch moderation down'));

      const results = await service.moderateBatch(['a', 'b']);

      expect(results).toEqual([
        expect.objectContaining({ isFlagged: false }),
        expect.objectContaining({ isFlagged: false }),
      ]);
      expect(dbMock.moderationLog.create).toHaveBeenCalledTimes(2);
      expect(dbMock.moderationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadata: { failedOpen: true } }),
      });
    });

    it('returns clean results with zero API calls and zero DB writes when disabled', async () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return false;
        return undefined;
      });

      const results = await service.moderateBatch(['a', 'b']);

      expect(results).toEqual([
        expect.objectContaining({ isFlagged: false }),
        expect.objectContaining({ isFlagged: false }),
      ]);
      expect(openaiServiceMock.moderateBatch).not.toHaveBeenCalled();
      expect(dbMock.moderationLog.create).not.toHaveBeenCalled();
    });
  });

  describe('getModerationLogs()', () => {
    function makeRow(overrides: Record<string, unknown> = {}) {
      return {
        publicId: 'mod-pub-1',
        requestId: 'req-1',
        userId: 'user-1',
        direction: ModerationDirection.INPUT,
        content: 'hello',
        isFlagged: false,
        categories: { hate: false },
        categoryScores: { hate: 0.001 },
        action: ModerationAction.ALLOWED,
        source: 'chat',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        ...overrides,
      };
    }

    it('applies every filter and pagination to the Prisma call args', async () => {
      dbMock.moderationLog.findMany.mockResolvedValue([] as never);
      dbMock.moderationLog.count.mockResolvedValue(0);

      await service.getModerationLogs({
        userId: 'user-1',
        isFlagged: true,
        direction: ModerationDirection.OUTPUT,
        source: 'rag',
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-02T00:00:00.000Z',
        page: 2,
        limit: 10,
      });

      const expectedWhere = {
        userId: 'user-1',
        isFlagged: true,
        direction: ModerationDirection.OUTPUT,
        source: 'rag',
        createdAt: {
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lte: new Date('2026-07-02T00:00:00.000Z'),
        },
      };
      expect(dbMock.moderationLog.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        skip: 10,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(dbMock.moderationLog.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('defaults to page 1 / limit 20 and an empty where clause with no filters', async () => {
      dbMock.moderationLog.findMany.mockResolvedValue([] as never);
      dbMock.moderationLog.count.mockResolvedValue(0);

      const result = await service.getModerationLogs({});

      expect(dbMock.moderationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 0, take: 20 }),
      );
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });

    it('caps limit at 100', async () => {
      dbMock.moderationLog.findMany.mockResolvedValue([] as never);
      dbMock.moderationLog.count.mockResolvedValue(0);

      await service.getModerationLogs({ limit: 500 });

      expect(dbMock.moderationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('maps each row to a ModerationLogEntity (publicId, never internal id)', async () => {
      dbMock.moderationLog.findMany.mockResolvedValue([makeRow()] as never);
      dbMock.moderationLog.count.mockResolvedValue(1);

      const result = await service.getModerationLogs({});

      expect(result.data).toEqual([
        {
          publicId: 'mod-pub-1',
          requestId: 'req-1',
          userId: 'user-1',
          direction: ModerationDirection.INPUT,
          content: 'hello',
          isFlagged: false,
          categories: { hate: false },
          categoryScores: { hate: 0.001 },
          action: ModerationAction.ALLOWED,
          source: 'chat',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);
      expect(result.data[0]).not.toHaveProperty('id');
    });
  });

  describe('getModerationStats()', () => {
    it('returns zeroed totals with no NaN when there is no data', async () => {
      dbMock.moderationLog.count.mockResolvedValue(0);
      dbMock.moderationLog.findMany.mockResolvedValue([] as never);

      const result = await service.getModerationStats({});

      expect(result).toEqual({
        totalChecks: 0,
        flaggedCount: 0,
        violationRate: 0,
        byDirection: { input: 0, output: 0 },
        topCategories: [],
      });
    });

    it('computes totals, violation rate, per-direction split, and top flagged categories', async () => {
      dbMock.moderationLog.count
        .mockResolvedValueOnce(10) // totalChecks
        .mockResolvedValueOnce(4) // flaggedCount
        .mockResolvedValueOnce(7) // input count
        .mockResolvedValueOnce(3); // output count
      dbMock.moderationLog.findMany.mockResolvedValue([
        { categories: { sexual: true, hate: false } },
        { categories: { sexual: true, violence: true } },
        { categories: { sexual: true } },
        { categories: { violence: true } },
      ] as never);

      const result = await service.getModerationStats({
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-31T23:59:59.000Z',
      });

      expect(result.totalChecks).toBe(10);
      expect(result.flaggedCount).toBe(4);
      expect(result.violationRate).toBe(0.4);
      expect(result.byDirection).toEqual({ input: 7, output: 3 });
      expect(result.topCategories).toEqual([
        { category: 'sexual', count: 3 },
        { category: 'violence', count: 2 },
      ]);
    });

    it('applies the date range to every underlying query', async () => {
      dbMock.moderationLog.count.mockResolvedValue(0);
      dbMock.moderationLog.findMany.mockResolvedValue([] as never);

      await service.getModerationStats({
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-02T00:00:00.000Z',
      });

      const expectedRange = {
        createdAt: {
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lte: new Date('2026-07-02T00:00:00.000Z'),
        },
      };
      expect(dbMock.moderationLog.count).toHaveBeenNthCalledWith(1, { where: expectedRange });
      expect(dbMock.moderationLog.count).toHaveBeenNthCalledWith(2, {
        where: { ...expectedRange, isFlagged: true },
      });
      expect(dbMock.moderationLog.findMany).toHaveBeenCalledWith({
        where: { ...expectedRange, isFlagged: true },
        select: { categories: true },
      });
    });

    it('caps the top-categories tally at 5 entries', async () => {
      dbMock.moderationLog.count.mockResolvedValue(0);
      dbMock.moderationLog.findMany.mockResolvedValue([
        { categories: { a: true } },
        { categories: { a: true, b: true } },
        { categories: { a: true, b: true, c: true } },
        { categories: { d: true } },
        { categories: { e: true } },
        { categories: { f: true } },
      ] as never);

      const result = await service.getModerationStats({});

      expect(result.topCategories).toHaveLength(5);
      expect(result.topCategories[0]).toEqual({ category: 'a', count: 3 });
    });
  });
});
