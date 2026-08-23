import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ApiErrorType } from '../constants/api-error-type.enum';
import { RETRY_CONFIG } from '../constants/retry-config.constant';
import { CircuitOpenException } from '../exceptions/circuit-open.exception';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

type ApiError = { status?: number; headers?: Record<string, string> };

@Injectable()
export class RetryService {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterFactor: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  private consecutiveFailures = 0;
  private circuitState: CircuitState = 'CLOSED';
  private openedAt: number | null = null;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly configService: ConfigService,
  ) {
    this.maxRetries =
      this.configService.get<number>('openai.maxRetries') ?? RETRY_CONFIG.maxRetries;
    this.baseDelayMs =
      this.configService.get<number>('openai.retryBaseDelayMs') ?? RETRY_CONFIG.baseDelayMs;
    this.maxDelayMs = RETRY_CONFIG.maxDelayMs;
    this.jitterFactor = RETRY_CONFIG.jitterFactor;
    this.failureThreshold =
      this.configService.get<number>('openai.circuitFailureThreshold') ??
      RETRY_CONFIG.circuitBreaker.failureThreshold;
    this.cooldownMs =
      this.configService.get<number>('openai.circuitCooldownMs') ??
      RETRY_CONFIG.circuitBreaker.cooldownMs;
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryTracker?: { retryCount: number },
  ): Promise<T> {
    if (this.circuitState === 'OPEN') {
      if (Date.now() - this.openedAt! >= this.cooldownMs) {
        this.circuitState = 'HALF_OPEN';
        this.logger.log('Circuit breaker entering HALF_OPEN');
      } else {
        throw new CircuitOpenException();
      }
    }

    const isHalfOpen = this.circuitState === 'HALF_OPEN';
    const maxAttempts = isHalfOpen ? 1 : this.maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await operation();
        this.onSuccess();
        return result;
      } catch (error) {
        lastError = error;
        const errorType = this.classifyError(error);

        if (errorType === ApiErrorType.PERMANENT) {
          throw error;
        }

        if (isHalfOpen) {
          this.circuitState = 'OPEN';
          this.openedAt = Date.now();
          this.logger.warn('Circuit breaker re-opened from HALF_OPEN');
          throw error;
        }

        if (attempt < maxAttempts - 1) {
          if (retryTracker) retryTracker.retryCount++;
          const delayMs = this.computeDelay(error, attempt);
          this.logger.warn(`Retrying attempt ${attempt + 1}/${this.maxRetries} in ${delayMs}ms`);
          await this.sleep(delayMs);
        }
      }
    }

    this.consecutiveFailures++;
    this.logger.warn(
      `RetryService: consecutive failures = ${this.consecutiveFailures}/${this.failureThreshold}`,
    );
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitState = 'OPEN';
      this.openedAt = Date.now();
      this.logger.warn('Circuit breaker OPEN');
    }

    throw lastError;
  }

  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  resetCircuit(): void {
    this.consecutiveFailures = 0;
    this.circuitState = 'CLOSED';
    this.openedAt = null;
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitState !== 'CLOSED') {
      this.logger.log(`Circuit breaker closing from ${this.circuitState}`);
      this.circuitState = 'CLOSED';
      this.openedAt = null;
    }
  }

  private classifyError(error: unknown): ApiErrorType {
    if (error instanceof CircuitOpenException) return ApiErrorType.CIRCUIT_OPEN;
    const { status } = error as ApiError;
    if (status == null) return ApiErrorType.RETRYABLE;
    if (RETRY_CONFIG.permanentStatusCodes.includes(status)) return ApiErrorType.PERMANENT;
    if (RETRY_CONFIG.retryableStatusCodes.includes(status)) return ApiErrorType.RETRYABLE;
    return ApiErrorType.PERMANENT;
  }

  private computeDelay(error: unknown, attempt: number): number {
    const { headers } = error as ApiError;
    if (headers?.['retry-after']) {
      const retryAfterSecs = parseInt(headers['retry-after'], 10);
      if (!isNaN(retryAfterSecs)) return retryAfterSecs * 1000;
    }
    const exponential = Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
    const jitter = Math.random() * this.baseDelayMs * this.jitterFactor;
    return exponential + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
