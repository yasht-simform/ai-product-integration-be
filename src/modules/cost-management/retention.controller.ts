import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import {
  RetentionConfigResDto,
  RetentionReportResDto,
  RetentionStatsResDto,
  UpdateRetentionConfigDto,
} from './dto';
import { RetentionService } from './services/retention.service';

// A second controller class (not a route on CostManagementController) so retention's /retention/...
// paths (spec §6.4) sit at a distinct prefix from /cost/... while staying under the same
// 'cost-management' Swagger tag for grouping — the split the issue's own text prefers over an
// @Controller() path-prefix override on a shared class.
@ApiTags('cost-management')
@Controller('retention')
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  @ApiEndpoint({
    summary: 'Current retention settings (env config + any in-memory runtime overrides)',
    type: RetentionConfigResDto,
    isPublic: true,
  })
  @Get('config')
  getRetentionConfig(): RetentionConfigResDto {
    return this.retentionService.getRetentionConfig();
  }

  @ApiEndpoint({
    summary: 'Update retention periods (in-memory only — resets on restart; cron is not updatable)',
    description:
      'Accepts positive-integer overrides for the four retention-day fields. Overrides are held ' +
      'in memory only and are reset on app restart; they take effect on the next cleanup run. The ' +
      'cron schedule cannot be changed at runtime — a cron/cleanupCron field in the request body ' +
      'is rejected with a 400 by the global validation pipe.',
    type: RetentionConfigResDto,
    isPublic: true,
  })
  @Patch('config')
  updateRetentionConfig(@Body() dto: UpdateRetentionConfigDto): RetentionConfigResDto {
    this.retentionService.updateRetentionConfig(dto);
    return this.retentionService.getRetentionConfig();
  }

  @ApiEndpoint({
    summary: 'Trigger a manual cleanup run now, returning per-category deleted counts',
    type: RetentionReportResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('cleanup')
  async runFullCleanup(): Promise<RetentionReportResDto> {
    return this.retentionService.runFullCleanup();
  }

  @ApiEndpoint({
    summary: 'Last cleanup report and counts of rows currently due for cleanup',
    type: RetentionStatsResDto,
    isPublic: true,
  })
  @Get('stats')
  async getRetentionStats(): Promise<RetentionStatsResDto> {
    return this.retentionService.getRetentionStats();
  }
}
