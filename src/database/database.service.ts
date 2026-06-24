import { INestApplication, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  // Call this from main.ts after app.listen() for graceful shutdown.
  // NestJS shutdown hooks (SIGTERM/SIGINT) trigger onModuleDestroy automatically,
  // but beforeExit handles the case where the event loop drains naturally.
  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
