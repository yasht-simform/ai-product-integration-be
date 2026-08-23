import { ApiProperty } from '@nestjs/swagger';

export class SyncResultResDto {
  @ApiProperty()
  providersCreated: number;

  @ApiProperty()
  modelsCreated: number;

  @ApiProperty()
  modelsUpdated: number;
}
