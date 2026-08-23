import {
  Injectable,
  UnprocessableEntityException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { requestContext } from '../../../common/logger/request-context';
import { resolveUserId } from '../../../common/utils/resolve-user-id.util';
import { ModerationAction } from '../constants/moderation-action.constant';
import { ModerationDirection } from '../constants/moderation-direction.constant';
import {
  MODERATE_FIELD_KEY,
  type ModerateFieldMetadata,
} from '../decorators/moderate-field.decorator';
import { ModerationService } from '../services/moderation.service';

const DEFAULT_FIELD = 'content';
const DEFAULT_SOURCE = 'standalone';

@Injectable()
export class ModerationGuard implements CanActivate {
  constructor(
    private readonly moderationService: ModerationService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.isInputModerationEnabled()) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const metadata = this.reflector.getAllAndOverride<ModerateFieldMetadata | undefined>(
      MODERATE_FIELD_KEY,
      [context.getHandler(), context.getClass()],
    );
    const field = metadata?.field ?? DEFAULT_FIELD;
    const source = metadata?.source ?? DEFAULT_SOURCE;

    const body = request.body as Record<string, unknown> | undefined;
    const text = body?.[field];

    if (typeof text !== 'string') {
      return true;
    }

    const result = await this.moderationService.moderateText(text, {
      direction: ModerationDirection.INPUT,
      source,
      userId: resolveUserId(request),
      requestId: requestContext.getStore()?.requestId,
      action: ModerationAction.BLOCKED,
    });

    if (result.isFlagged) {
      throw new UnprocessableEntityException({
        message: 'Content flagged by moderation policy',
        error: 'Unprocessable Entity',
        flaggedCategories: result.flaggedCategories,
        categoryScores: result.categoryScores,
        highestScore: result.highestScore,
      });
    }

    return true;
  }

  private isInputModerationEnabled(): boolean {
    const enabled = this.configService.get<boolean>('moderation.enabled') ?? true;
    const inputEnabled = this.configService.get<boolean>('moderation.inputEnabled') ?? true;
    return enabled && inputEnabled;
  }
}
