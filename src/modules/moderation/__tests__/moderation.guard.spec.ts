import { UnprocessableEntityException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { ModerationAction } from '../constants/moderation-action.constant';
import { ModerationDirection } from '../constants/moderation-direction.constant';
import { ModerateField } from '../decorators/moderate-field.decorator';
import { ModerationGuard } from '../guards/moderation.guard';
import { ModerationService } from '../services/moderation.service';
import type { ModerationResult } from '../types/moderation.types';

// ModerationGuard imports ModerationService, which imports DatabaseService, which imports
// the Prisma-generated ESM client. Mocking DatabaseService prevents Jest (CommonJS) from
// loading import.meta.url at runtime.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

class FakeController {
  @ModerateField('question', 'rag')
  withMetadata(): void {}

  withoutMetadata(): void {}
}

function makeContext(options: {
  body?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
  handler?: () => void;
}): ExecutionContext {
  const handler = options.handler ?? FakeController.prototype.withoutMetadata;
  const request = { body: options.body ?? {}, headers: options.headers ?? {} };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
}

const cleanResult = (): ModerationResult => ({
  isFlagged: false,
  categories: { sexual: false },
  categoryScores: { sexual: 0.002 },
  flaggedCategories: [],
  highestScore: { category: 'sexual', score: 0.002 },
});

const flaggedResult = (): ModerationResult => ({
  isFlagged: true,
  categories: { sexual: true },
  categoryScores: { sexual: 0.9 },
  flaggedCategories: ['sexual'],
  highestScore: { category: 'sexual', score: 0.9 },
});

describe('ModerationGuard', () => {
  let guard: ModerationGuard;
  let moderationServiceMock: { moderateText: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(() => {
    moderationServiceMock = { moderateText: jest.fn().mockResolvedValue(cleanResult()) };
    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return true;
        if (key === 'moderation.inputEnabled') return true;
        return undefined;
      }),
    };

    guard = new ModerationGuard(
      moderationServiceMock as unknown as ModerationService,
      new Reflector(),
      configMock as unknown as ConfigService,
    );
  });

  describe('clean input', () => {
    it('returns true and calls ModerationService.moderateText() with direction/source/action', async () => {
      const context = makeContext({ body: { content: 'hello world' } });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith('hello world', {
        direction: ModerationDirection.INPUT,
        source: 'standalone',
        userId: undefined,
        requestId: undefined,
        action: ModerationAction.BLOCKED,
      });
    });
  });

  describe('flagged input', () => {
    it('throws UnprocessableEntityException with categories/scores in the response body', async () => {
      moderationServiceMock.moderateText.mockResolvedValue(flaggedResult());
      const context = makeContext({ body: { content: 'bad input' } });

      let caught: unknown;
      try {
        await guard.canActivate(context);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      const response = (caught as UnprocessableEntityException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response['flaggedCategories']).toEqual(['sexual']);
      expect(response['categoryScores']).toEqual({ sexual: 0.9 });
      expect(response['highestScore']).toEqual({ category: 'sexual', score: 0.9 });
    });

    it('passes action: BLOCKED to ModerationService so the log records the block', async () => {
      moderationServiceMock.moderateText.mockResolvedValue(flaggedResult());
      const context = makeContext({ body: { content: 'bad input' } });

      await expect(guard.canActivate(context)).rejects.toThrow();

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'bad input',
        expect.objectContaining({ action: ModerationAction.BLOCKED }),
      );
    });
  });

  describe('field resolution', () => {
    it('defaults to the "content" body field and "standalone" source with no route metadata', async () => {
      const context = makeContext({
        body: { content: 'hello world' },
        handler: FakeController.prototype.withoutMetadata,
      });

      await guard.canActivate(context);

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'hello world',
        expect.objectContaining({ source: 'standalone' }),
      );
    });

    it('resolves the field/source from @ModerateField() route metadata when present', async () => {
      const context = makeContext({
        body: { question: 'what is the return policy?' },
        handler: FakeController.prototype.withMetadata,
      });

      await guard.canActivate(context);

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'what is the return policy?',
        expect.objectContaining({ source: 'rag' }),
      );
    });

    it('passes through with no ModerationService call when the resolved field is missing', async () => {
      const context = makeContext({ body: {} });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });

    it('passes through with no ModerationService call when the resolved field is not a string', async () => {
      const context = makeContext({ body: { content: 12345 } });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });
  });

  describe('identity threading', () => {
    it('resolves userId from the x-user-id header', async () => {
      const context = makeContext({
        body: { content: 'hello world' },
        headers: { 'x-user-id': 'user-42' },
      });

      await guard.canActivate(context);

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'hello world',
        expect.objectContaining({ userId: 'user-42' }),
      );
    });

    it('falls back to body.userId when the header is absent', async () => {
      const context = makeContext({ body: { content: 'hello world', userId: 'user-7' } });

      await guard.canActivate(context);

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'hello world',
        expect.objectContaining({ userId: 'user-7' }),
      );
    });
  });

  describe('toggles', () => {
    it('bypasses with zero ModerationService calls when MODERATION_ENABLED is false', async () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return false;
        return undefined;
      });
      const context = makeContext({ body: { content: 'hello world' } });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });

    it('bypasses with zero ModerationService calls when MODERATION_INPUT_ENABLED is false', async () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return true;
        if (key === 'moderation.inputEnabled') return false;
        return undefined;
      });
      const context = makeContext({ body: { content: 'hello world' } });

      const allowed = await guard.canActivate(context);

      expect(allowed).toBe(true);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });
  });
});
