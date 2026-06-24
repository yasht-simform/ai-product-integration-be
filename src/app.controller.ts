import { Controller, Get } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AppService } from './app.service';
import { ApiEndpoint } from './common/decorators/api-response.decorator';

// ── Response DTOs ─────────────────────────────────────────────────────────────
//
// In real modules these live in src/<module>/dto/.
// Shown here inline so the full pattern is visible in one file.

class SensitiveResponseDto {
  @ApiProperty({ example: 'eyes-only payload' })
  message: string;
}

class FeedItemDto {
  @ApiProperty({ example: '01J2...' })
  id: string;

  @ApiProperty({ example: 'Hello from the feed' })
  content: string;
}

// ── Controller ────────────────────────────────────────────────────────────────
//
// @ApiTags links every route in this controller to the 'health' group in Swagger.
// Tag names must match the strings registered in main.ts DocumentBuilder.addTag().

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // ── Public, default rate limit ─────────────────────────────────────────────

  @ApiEndpoint({
    summary: 'Hello World',
    description: 'Greeting endpoint. Subject to the global rate limit (100 req / 60 s).',
    isPublic: true,
  })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // ── Auth-required, stricter rate limit ─────────────────────────────────────
  //
  // isPublic defaults to false, so @ApiEndpoint adds the bearer auth header,
  // 401, and 403 responses automatically.

  @ApiEndpoint({
    summary: 'Sensitive data',
    description: 'Requires JWT. Tighter rate limit: 5 requests per 60 seconds.',
    type: SensitiveResponseDto,
  })
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Get('sensitive')
  sensitive(): SensitiveResponseDto {
    return { message: 'sensitive data' };
  }

  // ── Public list endpoint, relaxed rate limit ───────────────────────────────
  //
  // Wrapping the DTO in a tuple ([FeedItemDto]) tells ApiEndpoint → ApiOkResponse
  // that the response body is an array.

  @ApiEndpoint({
    summary: 'Public feed',
    description: 'No auth required. Relaxed rate limit: 200 requests per 60 seconds.',
    type: [FeedItemDto],
    isPublic: true,
  })
  @Throttle({ default: { ttl: 60_000, limit: 200 } })
  @Get('public-feed')
  publicFeed(): { items: never[] } {
    return { items: [] };
  }
}

// ── Controller-level decoration guide ─────────────────────────────────────────
//
// Apply @ApiTags + @ApiEndpoint options at the class level when all routes
// in a controller share the same concerns.
//
// @ApiTags('auth')
// @Controller('auth')
// export class AuthController { ... }
//
// @ApiBearerAuth('access-token')       // whole controller requires JWT
// @ApiTags('users')
// @Controller('users')
// export class UsersController { ... }
