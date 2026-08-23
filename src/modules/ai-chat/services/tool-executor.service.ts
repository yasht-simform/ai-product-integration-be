import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { timeout } from 'rxjs/operators';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ToolHandlerType } from '../constants/tool-handler-type.enum';
import { executeCalculator, executeDatetime, WeatherTool } from '../tools';
import type { ToolEntity, ToolExecutionResult } from '../types/ai-chat.types';
import { ToolRegistryService } from './tool-registry.service';

const TIMEOUT_ERROR_MESSAGE = 'Tool execution timed out';
const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
const DEFAULT_HTTP_TOOL_TIMEOUT_MS = 5_000;

interface HttpHandlerConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}

// Internal sentinel — distinguishes "the tool itself took too long" from any other rejection a
// builtin handler might throw, so execute() can map only the former to the spec's exact wording.
class ToolTimeoutError extends Error {}

@Injectable()
export class ToolExecutorService {
  private readonly builtinHandlers: Record<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  >;

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly weatherTool: WeatherTool,
    private readonly http: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.builtinHandlers = {
      calculator: (args) =>
        Promise.resolve(executeCalculator(args as unknown as { expression: string })),
      datetime: (args) => Promise.resolve(executeDatetime(args as unknown as { timezone: string })),
      weather: (args) => this.weatherTool.execute(args as unknown as { city: string }),
    };
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    let tool: ToolEntity;
    try {
      tool = await this.toolRegistry.findActiveTool(toolName);
    } catch {
      return this.failure(`Tool '${toolName}' is not available`, startTime);
    }

    if ((tool.handlerType as ToolHandlerType) === ToolHandlerType.HTTP) {
      return this.executeHttp(tool, args, startTime);
    }
    return this.executeBuiltin(tool.name, args, startTime);
  }

  private async executeBuiltin(
    name: string,
    args: Record<string, unknown>,
    startTime: number,
  ): Promise<ToolExecutionResult> {
    const handler = this.builtinHandlers[name];
    if (!handler) {
      return this.failure(`Tool '${name}' is not available`, startTime);
    }

    const timeoutMs =
      this.configService.get<number>('chat.toolTimeoutMs') ?? DEFAULT_TOOL_TIMEOUT_MS;

    try {
      const result = await this.withTimeout(handler(args), timeoutMs);
      return this.success(result, startTime);
    } catch (error) {
      if (error instanceof ToolTimeoutError) {
        return this.failure(TIMEOUT_ERROR_MESSAGE, startTime);
      }
      return this.failure(this.errorMessage(error), startTime);
    }
  }

  private async executeHttp(
    tool: ToolEntity,
    args: Record<string, unknown>,
    startTime: number,
  ): Promise<ToolExecutionResult> {
    const config = (tool.handlerConfig ?? {}) as HttpHandlerConfig;
    if (!config.url) {
      return this.failure('HTTP tool is missing a url in handlerConfig', startTime);
    }

    let hostname: string;
    try {
      hostname = new URL(config.url).hostname;
    } catch {
      return this.failure(`Invalid tool URL: ${config.url}`, startTime);
    }

    // Fail closed: an empty (default) whitelist blocks every HTTP tool, not "allow everything".
    const allowedDomains = this.configService.get<string[]>('chat.httpToolAllowedDomains') ?? [];
    if (!allowedDomains.includes(hostname)) {
      return this.failure(`Domain not allowed: ${hostname}`, startTime);
    }

    const timeoutMs =
      this.configService.get<number>('chat.httpToolTimeoutMs') ?? DEFAULT_HTTP_TOOL_TIMEOUT_MS;

    try {
      const response = await firstValueFrom(
        this.http
          .request({
            url: config.url,
            method: config.method ?? 'POST',
            data: args,
            headers: config.headers,
          })
          .pipe(timeout(timeoutMs)),
      );
      return this.success(response.data, startTime);
    } catch (error) {
      if (error instanceof TimeoutError) {
        return this.failure(TIMEOUT_ERROR_MESSAGE, startTime);
      }
      return this.failure(this.errorMessage(error), startTime);
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer!: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolTimeoutError()), ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  private success(result: unknown, startTime: number): ToolExecutionResult {
    return { success: true, result, executionMs: Date.now() - startTime };
  }

  private failure(error: string, startTime: number): ToolExecutionResult {
    return { success: false, result: null, error, executionMs: Date.now() - startTime };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
