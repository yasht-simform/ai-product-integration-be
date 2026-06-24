import { ConsoleLogger, Injectable, type ConsoleLoggerOptions } from '@nestjs/common';

import { requestContext } from './request-context';

@Injectable()
export class AppLoggerService extends ConsoleLogger {
  constructor(context = 'Application', options: ConsoleLoggerOptions = {}) {
    super(context, options);
  }

  private get isProd(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  // ── Public log methods ────────────────────────────────────────────────────

  log(message: unknown, ...optionalParams: unknown[]): void {
    if (this.isProd) {
      this.writeJson('log', message, this.resolveContext(optionalParams));
    } else {
      super.log(message, ...optionalParams);
    }
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    if (this.isProd) {
      const [trace, context] = this.resolveErrorParams(optionalParams);
      this.writeJson('error', message, context, trace);
    } else {
      super.error(message, ...optionalParams);
    }
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    if (this.isProd) {
      this.writeJson('warn', message, this.resolveContext(optionalParams));
    } else {
      super.warn(message, ...optionalParams);
    }
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    if (this.isProd) {
      this.writeJson('debug', message, this.resolveContext(optionalParams));
    } else {
      super.debug(message, ...optionalParams);
    }
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    if (this.isProd) {
      this.writeJson('verbose', message, this.resolveContext(optionalParams));
    } else {
      super.verbose(message, ...optionalParams);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  // NestJS convention: last string param is the context label.
  private resolveContext(params: unknown[]): string {
    const last = params[params.length - 1];
    return typeof last === 'string' ? last : (this.context ?? 'Application');
  }

  // NestJS convention: error(message, trace?, context?)
  // Single string param is the trace. Two strings: first=trace, last=context.
  private resolveErrorParams(params: unknown[]): [string | undefined, string] {
    const fallback = this.context ?? 'Application';
    if (params.length === 0) return [undefined, fallback];
    if (params.length === 1) {
      return [typeof params[0] === 'string' ? params[0] : undefined, fallback];
    }
    const trace = typeof params[0] === 'string' ? params[0] : undefined;
    const last = params[params.length - 1];
    const context = typeof last === 'string' ? last : fallback;
    return [trace, context];
  }

  private writeJson(level: string, message: unknown, context: string, trace?: string): void {
    const requestId = requestContext.getStore()?.requestId;

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
    };
    if (requestId) entry['requestId'] = requestId;
    if (trace) entry['trace'] = trace;

    const line = JSON.stringify(entry) + '\n';
    (level === 'error' ? process.stderr : process.stdout).write(line);
  }
}
