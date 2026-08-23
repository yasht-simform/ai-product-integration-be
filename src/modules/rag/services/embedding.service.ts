import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OpenaiService } from '../../openai/services/openai.service';

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}
}
