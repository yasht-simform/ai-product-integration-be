import { ApiProperty } from '@nestjs/swagger';

export class EvaluationComplexityBreakdownResDto {
  @ApiProperty()
  total: number;

  @ApiProperty({
    description:
      '"declined correctly" count for edge-case, "answered correctly" count for simple/multi-step',
  })
  correct: number;

  @ApiProperty()
  accuracy: number;
}

export class EvaluateResDto {
  @ApiProperty()
  totalQuestions: number;

  @ApiProperty()
  correct: number;

  @ApiProperty()
  partiallyCorrect: number;

  @ApiProperty()
  incorrect: number;

  @ApiProperty({ description: 'Edge-case questions the model appropriately declined to answer' })
  appropriateIDK: number;

  @ApiProperty()
  accuracy: number;

  @ApiProperty()
  avgLatencyMs: number;

  @ApiProperty()
  avgTokens: number;

  @ApiProperty({
    type: 'object',
    description: 'Per-complexity-tier breakdown, keyed by "simple" | "multi-step" | "edge-case"',
    additionalProperties: {
      type: 'object',
      properties: {
        total: { type: 'number' },
        correct: { type: 'number' },
        accuracy: { type: 'number' },
      },
    },
  })
  byComplexity: Record<string, EvaluationComplexityBreakdownResDto>;
}
