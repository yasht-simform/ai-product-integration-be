import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok', 'degraded'] })
  status: 'ok' | 'degraded';

  @ApiProperty({ example: 13.42, description: 'Process uptime in seconds' })
  uptime: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'development' })
  environment: string;

  @ApiProperty({ example: 'connected', enum: ['connected', 'disconnected'] })
  database: 'connected' | 'disconnected';
}
