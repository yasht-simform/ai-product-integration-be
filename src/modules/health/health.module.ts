import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

// DatabaseService, AppLoggerService, and ConfigService are all globally
// provided — no imports needed here.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
