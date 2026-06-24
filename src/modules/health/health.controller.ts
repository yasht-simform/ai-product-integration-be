import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { DatabaseService } from '../../database/database.service';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  @ApiEndpoint({
    summary: 'Health check',
    description:
      'Liveness and readiness probe. Pings the database and reports uptime. ' +
      'Always exempt from rate limiting.',
    type: HealthResponseDto,
    isPublic: true,
  })
  @Get()
  async check(): Promise<HealthResponseDto> {
    let database: 'connected' | 'disconnected' = 'connected';

    try {
      await this.db.$queryRaw`SELECT 1`;
    } catch (err) {
      database = 'disconnected';
      this.logger.warn(
        `Database ping failed: ${err instanceof Error ? err.message : String(err)}`,
        'HealthController',
      );
    }

    return {
      status: database === 'connected' ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime() * 100) / 100,
      timestamp: new Date().toISOString(),
      environment: this.config.get<string>('app.env') ?? 'unknown',
      database,
    };
  }
}
