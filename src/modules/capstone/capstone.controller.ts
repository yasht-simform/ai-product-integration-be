import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { EvaluateDto, EvaluateResDto } from '../rag/dto';
import { CapstoneResetResDto, CapstoneSeedResDto, CapstoneStatusResDto } from './dto';
import { CapstoneService } from './services/capstone.service';

@ApiTags('capstone')
@Controller('capstone')
export class CapstoneController {
  constructor(private readonly capstoneService: CapstoneService) {}

  @ApiEndpoint({
    summary:
      'Seed the full capstone demo dataset: 50 documents, 250 Q&A pairs, sample conversations and budgets, then run an evaluation',
    type: CapstoneSeedResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('seed')
  async seed(): Promise<CapstoneSeedResDto> {
    return this.capstoneService.seed();
  }

  @ApiEndpoint({
    summary: 'Delete all capstone demo data (documents, conversations, budgets) to start fresh',
    type: CapstoneResetResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('reset')
  async reset(): Promise<CapstoneResetResDto> {
    return this.capstoneService.reset();
  }

  @ApiEndpoint({
    summary: 'Demo readiness check: document/chunk/vector/Q&A counts and the last evaluation score',
    type: CapstoneStatusResDto,
    isPublic: true,
  })
  @Get('status')
  async status(): Promise<CapstoneStatusResDto> {
    return this.capstoneService.getStatus();
  }

  @ApiEndpoint({
    summary: 'Run the full Q&A evaluation and return the accuracy report',
    type: EvaluateResDto,
    successStatus: 201,
    isPublic: true,
  })
  @Post('run-evaluation')
  async runEvaluation(@Body() dto: EvaluateDto): Promise<EvaluateResDto> {
    return this.capstoneService.runEvaluation(dto.sampleSize);
  }
}
