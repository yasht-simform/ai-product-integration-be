import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { ModerationAction } from '../constants/moderation-action.constant';
import { ModerationDirection } from '../constants/moderation-direction.constant';
import { SAFE_REPLACEMENT_MESSAGE } from '../constants/moderation-messages.constant';
import { ModerateOutputField } from '../decorators/moderate-output-field.decorator';
import { OutputModerationInterceptor } from '../interceptors/output-moderation.interceptor';
import { ModerationService } from '../services/moderation.service';
import type { ModerationResult } from '../types/moderation.types';

// OutputModerationInterceptor imports ModerationService, which imports DatabaseService, which
// imports the Prisma-generated ESM client. Mocking DatabaseService prevents Jest (CommonJS) from
// loading import.meta.url at runtime.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

class FakeController {
  @ModerateOutputField('answer', 'rag')
  withMetadata(): void {}

  withoutMetadata(): void {}
}

function makeContext(options: {
  headers?: Record<string, string | string[]>;
  handler?: () => void;
}): ExecutionContext {
  const handler = options.handler ?? FakeController.prototype.withoutMetadata;
  const request = { headers: options.headers ?? {} };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
}

function makeHandler(payload: unknown): CallHandler {
  return { handle: () => of(payload) };
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
  categories: { violence: true },
  categoryScores: { violence: 0.95 },
  flaggedCategories: ['violence'],
  highestScore: { category: 'violence', score: 0.95 },
});

describe('OutputModerationInterceptor', () => {
  let interceptor: OutputModerationInterceptor;
  let moderationServiceMock: { moderateText: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(() => {
    moderationServiceMock = { moderateText: jest.fn().mockResolvedValue(cleanResult()) };
    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return true;
        if (key === 'moderation.outputEnabled') return true;
        return undefined;
      }),
    };

    interceptor = new OutputModerationInterceptor(
      moderationServiceMock as unknown as ModerationService,
      new Reflector(),
      configMock as unknown as ConfigService,
    );
  });

  describe('clean output', () => {
    it('passes the payload through unchanged and logs action: allowed', async () => {
      const context = makeContext({});
      const payload = { content: 'hello there', model: 'gpt-4o' };

      const result = await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(result).toEqual(payload);
      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith('hello there', {
        direction: ModerationDirection.OUTPUT,
        source: 'standalone',
        userId: undefined,
        requestId: undefined,
        action: ModerationAction.REPLACED,
      });
    });
  });

  describe('flagged output', () => {
    it('replaces only the resolved field with the safe message, other fields untouched', async () => {
      moderationServiceMock.moderateText.mockResolvedValue(flaggedResult());
      const context = makeContext({});
      const payload = {
        content: 'dangerous instructions',
        model: 'gpt-4o',
        usage: { totalTokens: 10 },
      };

      const result = await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(result).toEqual({
        content: SAFE_REPLACEMENT_MESSAGE,
        model: 'gpt-4o',
        usage: { totalTokens: 10 },
      });
    });

    it('passes action: REPLACED so the log records the original content', async () => {
      moderationServiceMock.moderateText.mockResolvedValue(flaggedResult());
      const context = makeContext({});
      const payload = { content: 'dangerous instructions' };

      await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'dangerous instructions',
        expect.objectContaining({ action: ModerationAction.REPLACED }),
      );
    });

    it('never throws for flagged content', async () => {
      moderationServiceMock.moderateText.mockResolvedValue(flaggedResult());
      const context = makeContext({});
      const payload = { content: 'dangerous instructions' };

      await expect(
        firstValueFrom(interceptor.intercept(context, makeHandler(payload))),
      ).resolves.toBeDefined();
    });
  });

  describe('field resolution', () => {
    it('defaults to the "content" field and "standalone" source with no route metadata', async () => {
      const context = makeContext({ handler: FakeController.prototype.withoutMetadata });
      const payload = { content: 'hello' };

      await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ source: 'standalone' }),
      );
    });

    it('resolves the field/source from @ModerateOutputField() route metadata when present', async () => {
      const context = makeContext({ handler: FakeController.prototype.withMetadata });
      const payload = { answer: 'here is the answer' };

      await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'here is the answer',
        expect.objectContaining({ source: 'rag' }),
      );
    });

    it('passes through with no ModerationService call when the resolved field is missing', async () => {
      const context = makeContext({});
      const payload = { model: 'gpt-4o' };

      const result = await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(result).toEqual(payload);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });

    it('passes through with no ModerationService call when the resolved field is not a string', async () => {
      const context = makeContext({});
      const payload = { content: 12345 };

      const result = await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(result).toEqual(payload);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });
  });

  describe('identity threading', () => {
    it('resolves userId from the x-user-id header', async () => {
      const context = makeContext({ headers: { 'x-user-id': 'user-42' } });
      const payload = { content: 'hello' };

      await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(moderationServiceMock.moderateText).toHaveBeenCalledWith(
        'hello',
        expect.objectContaining({ userId: 'user-42' }),
      );
    });
  });

  describe('toggles', () => {
    it('bypasses with zero ModerationService calls when MODERATION_ENABLED is false', async () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return false;
        return undefined;
      });
      const context = makeContext({});
      const payload = { content: 'hello' };

      const result = await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(result).toEqual(payload);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });

    it('bypasses with zero ModerationService calls when MODERATION_OUTPUT_ENABLED is false (the default posture)', async () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'moderation.enabled') return true;
        if (key === 'moderation.outputEnabled') return false;
        return undefined;
      });
      const context = makeContext({});
      const payload = { content: 'hello' };

      const result = await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(result).toEqual(payload);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });

    it('bypasses when neither config key is set (real default posture — output opt-in)', async () => {
      configMock.get.mockImplementation(() => undefined);
      const context = makeContext({});
      const payload = { content: 'hello' };

      const result = await firstValueFrom(interceptor.intercept(context, makeHandler(payload)));

      expect(result).toEqual(payload);
      expect(moderationServiceMock.moderateText).not.toHaveBeenCalled();
    });
  });
});
