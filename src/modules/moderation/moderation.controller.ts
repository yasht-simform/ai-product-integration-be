import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { resolveUserId } from '../../common/utils/resolve-user-id.util';
import { ModerationDirection } from './constants/moderation-direction.constant';
import {
  CheckBatchModerationDto,
  CheckModerationDto,
  ModerationLogResDto,
  ModerationResultResDto,
  ModerationStatsQueryDto,
  ModerationStatsResDto,
  PaginatedModerationLogsResDto,
  QueryModerationLogsDto,
} from './dto';
import { ModerationService } from './services/moderation.service';
import type { ModerationLogEntity } from './types/moderation.types';

const STANDALONE_SOURCE = 'standalone';

@ApiTags('moderation')
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @ApiEndpoint({
    summary: 'Moderate a single piece of text, returning categories + scores',
    type: ModerationResultResDto,
    isPublic: true,
  })
  @Post('check')
  async check(
    @Body() dto: CheckModerationDto,
    @Req() request: Request,
  ): Promise<ModerationResultResDto> {
    return this.moderationService.moderateText(dto.text, {
      source: dto.source ?? STANDALONE_SOURCE,
      direction: ModerationDirection.INPUT,
      userId: resolveUserId(request),
    });
  }

  @ApiEndpoint({
    summary: 'Moderate multiple texts in one call',
    type: [ModerationResultResDto],
    isPublic: true,
  })
  @Post('check-batch')
  async checkBatch(@Body() dto: CheckBatchModerationDto): Promise<ModerationResultResDto[]> {
    return this.moderationService.moderateBatch(dto.texts);
  }

  @ApiEndpoint({
    summary: 'Query moderation logs (paginated, filterable)',
    type: PaginatedModerationLogsResDto,
    isPublic: true,
  })
  @Get('logs')
  async getModerationLogs(
    @Query() query: QueryModerationLogsDto,
  ): Promise<PaginatedModerationLogsResDto> {
    const result = await this.moderationService.getModerationLogs(query);
    return { ...result, data: result.data.map((log) => this.toLogRes(log)) };
  }

  @ApiEndpoint({
    summary: 'Moderation stats: total checks, violation rate, per-direction split, top categories',
    type: ModerationStatsResDto,
    isPublic: true,
  })
  @Get('stats')
  async getModerationStats(
    @Query() query: ModerationStatsQueryDto,
  ): Promise<ModerationStatsResDto> {
    return this.moderationService.getModerationStats(query);
  }

  private toLogRes(log: ModerationLogEntity): ModerationLogResDto {
    return {
      publicId: log.publicId,
      requestId: log.requestId ?? undefined,
      userId: log.userId ?? undefined,
      direction: log.direction,
      content: log.content,
      isFlagged: log.isFlagged,
      categories: log.categories,
      categoryScores: log.categoryScores,
      action: log.action,
      source: log.source,
      createdAt: log.createdAt,
    };
  }
}
