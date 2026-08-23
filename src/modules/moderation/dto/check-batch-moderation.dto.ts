import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

const MAX_BATCH_SIZE = 50;

export class CheckBatchModerationDto {
  @ApiProperty({
    description: 'Texts to moderate in one call',
    type: [String],
    maxItems: MAX_BATCH_SIZE,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @IsString({ each: true })
  texts: string[];
}
