import { ApiProperty } from '@nestjs/swagger';

export class TokenCountResDto {
  @ApiProperty({ description: 'The text that was counted' })
  text: string;

  @ApiProperty({ description: 'Model whose tokenizer was used' })
  model: string;

  @ApiProperty({ description: 'Exact token count from tiktoken' })
  tokenCount: number;

  @ApiProperty({ description: 'Character count of the text' })
  characterCount: number;
}
