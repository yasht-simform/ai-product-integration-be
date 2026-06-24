import { randomUUID } from 'crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { AppLoggerService } from '../logger/app-logger.service';
import { requestContext } from '../logger/request-context';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const startMs = Date.now();

    // Attach to response header so clients/upstreams can correlate.
    res.setHeader('X-Request-Id', requestId);

    // AsyncLocalStorage.run() propagates requestId through the entire
    // async call chain for this request without touching any signatures.
    requestContext.run({ requestId }, () => {
      res.on('finish', () => {
        const duration = Date.now() - startMs;
        const status = res.statusCode;
        const contentLength = res.getHeader('content-length');
        const cl = contentLength != null ? ` ${String(contentLength)}b` : '';

        const message = `${req.method} ${req.originalUrl} ${status} ${duration}ms${cl}`;

        if (status >= 500) {
          this.logger.error(message, undefined, 'HTTP');
        } else if (status >= 400) {
          this.logger.warn(message, 'HTTP');
        } else {
          this.logger.log(message, 'HTTP');
        }
      });

      next();
    });
  }
}
