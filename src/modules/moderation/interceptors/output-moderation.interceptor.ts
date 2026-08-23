import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { requestContext } from '../../../common/logger/request-context';
import { ModerationAction } from '../constants/moderation-action.constant';
import { ModerationDirection } from '../constants/moderation-direction.constant';
import { SAFE_REPLACEMENT_MESSAGE } from '../constants/moderation-messages.constant';
import {
  MODERATE_OUTPUT_FIELD_KEY,
  type ModerateOutputFieldMetadata,
} from '../decorators/moderate-output-field.decorator';
import { ModerationService } from '../services/moderation.service';

const DEFAULT_FIELD = 'content';
const DEFAULT_SOURCE = 'standalone';

@Injectable()
export class OutputModerationInterceptor implements NestInterceptor {
  constructor(
    private readonly moderationService: ModerationService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.isOutputModerationEnabled()) {
      return next.handle();
    }

    const metadata = this.reflector.getAllAndOverride<ModerateOutputFieldMetadata | undefined>(
      MODERATE_OUTPUT_FIELD_KEY,
      [context.getHandler(), context.getClass()],
    );
    const field = metadata?.field ?? DEFAULT_FIELD;
    const source = metadata?.source ?? DEFAULT_SOURCE;
    const request = context.switchToHttp().getRequest<Request>();

    return next
      .handle()
      .pipe(switchMap((payload: unknown) => this.moderatePayload(payload, field, source, request)));
  }

  private async moderatePayload(
    payload: unknown,
    field: string,
    source: string,
    request: Request,
  ): Promise<unknown> {
    if (typeof payload !== 'object' || payload === null || !(field in payload)) {
      return payload;
    }

    const record = payload as Record<string, unknown>;
    const text = record[field];
    if (typeof text !== 'string') {
      return payload;
    }

    const result = await this.moderationService.moderateText(text, {
      direction: ModerationDirection.OUTPUT,
      source,
      userId: this.resolveUserId(request),
      requestId: requestContext.getStore()?.requestId,
      action: ModerationAction.REPLACED,
    });

    if (!result.isFlagged) {
      return payload;
    }

    return { ...record, [field]: SAFE_REPLACEMENT_MESSAGE };
  }

  private isOutputModerationEnabled(): boolean {
    const enabled = this.configService.get<boolean>('moderation.enabled') ?? true;
    const outputEnabled = this.configService.get<boolean>('moderation.outputEnabled') ?? false;
    return enabled && outputEnabled;
  }

  private resolveUserId(request: Request): string | undefined {
    const header = request.headers['x-user-id'];
    if (typeof header === 'string') return header;
    if (Array.isArray(header)) return header[0];
    return undefined;
  }
}
