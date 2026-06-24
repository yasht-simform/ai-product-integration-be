import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppLoggerService } from '../logger/app-logger.service';

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode: number;
    let message: string | string[];
    let error: string;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
        error = exception.message;
      } else {
        const obj = body as Record<string, unknown>;
        message = (obj['message'] as string | string[]) ?? exception.message;
        error = (obj['error'] as string) ?? exception.message;
      }
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'Internal Server Error';
    }

    const stack = exception instanceof Error ? exception.stack : undefined;
    const logMessage = Array.isArray(message) ? message.join(', ') : message;

    if (statusCode >= 500) {
      this.logger.error(logMessage, stack, 'HttpExceptionFilter');
    } else if (statusCode >= 400) {
      this.logger.warn(logMessage, 'HttpExceptionFilter');
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
