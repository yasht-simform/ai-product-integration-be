import { ApiProperty } from '@nestjs/swagger';

export class UsageDto {
  @ApiProperty({ description: 'Tokens in the request' })
  inputTokens: number;

  @ApiProperty({ description: 'Tokens in the response' })
  outputTokens: number;

  @ApiProperty({ description: 'Total tokens consumed' })
  totalTokens: number;
}
