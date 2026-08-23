import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { QaComplexity } from '../constants/qa-complexity.constant';

// Lets a caller evaluate an explicit list of Q&A pairs (e.g. a static realistic dataset that was
// never persisted to the qaPair table) instead of only ever reading MockDataService.evaluate()'s
// default DB-backed sample — see seedRealisticDataset()'s own notes for why faker-based content
// alone isn't representative for evaluation.
export class EvaluateQaPairDto {
  @ApiProperty({ description: 'The question to ask' })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiProperty({ description: 'The expected/reference answer, used for scoring' })
  @IsString()
  @IsNotEmpty()
  expectedAnswer: string;

  @ApiProperty({ enum: Object.values(QaComplexity), description: 'Complexity tier' })
  @IsIn(Object.values(QaComplexity))
  complexity: string;
}

// Bounded at the DTO level too (max 200) as belt-and-suspenders alongside
// MockDataService.evaluate()'s own internal clamp — every evaluated question is a live
// embedding + Pinecone + generation call, never "evaluate everything" (spec's own requirement).
export class EvaluateDto {
  @ApiPropertyOptional({
    description: 'Number of Q&A pairs to evaluate (ignored when qaPairs is provided)',
    default: 50,
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  sampleSize?: number;

  @ApiPropertyOptional({
    type: [EvaluateQaPairDto],
    description:
      'Explicit Q&A pairs to evaluate instead of reading persisted QaPair rows from the database',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluateQaPairDto)
  qaPairs?: EvaluateQaPairDto[];
}
