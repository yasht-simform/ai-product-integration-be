import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { CircuitOpenException } from '../exceptions/circuit-open.exception';
import { RetryService } from '../services/retry.service';

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

async function createService(configOverrides: Record<string, number> = {}): Promise<RetryService> {
  const defaults: Record<string, number> = {
    'openai.maxRetries': 2,
    'openai.retryBaseDelayMs': 100,
    'openai.circuitFailureThreshold': 5,
    'openai.circuitCooldownMs': 60000,
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RetryService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn().mockImplementation((key: string) => configOverrides[key] ?? defaults[key]),
        },
      },
      { provide: AppLoggerService, useValue: mockLogger },
    ],
  }).compile();
  return module.get<RetryService>(RetryService);
}

function makeError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe('RetryService', () => {
  let service: RetryService;

  beforeEach(async () => {
    jest.useFakeTimers();
    service = await createService();
  });

  afterEach(() => {
    service.resetCircuit();
    jest.useRealTimers();
  });

  describe('executeWithRetry — success path', () => {
    it('returns the operation result on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('result');
      const result = await service.executeWithRetry(operation);
      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeWithRetry — retry behavior', () => {
    it('retries a 429 error and returns the result on the second attempt', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(makeError(429))
        .mockResolvedValueOnce('recovered');

      const promise = service.executeWithRetry(operation);
      await jest.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result).toBe('recovered');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on a permanent error (401) without retrying', async () => {
      const operation = jest.fn().mockRejectedValue(makeError(401));
      await expect(service.executeWithRetry(operation)).rejects.toThrow('HTTP 401');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting all retries for persistent 500 errors', async () => {
      // maxRetries = 2 → 3 total attempts (initial + 2 retries)
      const operation = jest.fn().mockRejectedValue(makeError(500));

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const assertion = expect(service.executeWithRetry(operation)).rejects.toThrow('HTTP 500');
      await jest.advanceTimersByTimeAsync(60_000);
      await assertion;

      expect(operation).toHaveBeenCalledTimes(3);
    });
  });

  describe('circuit breaker', () => {
    beforeEach(async () => {
      // maxRetries = 0 → each executeWithRetry call makes exactly one attempt
      service = await createService({
        'openai.maxRetries': 0,
        'openai.circuitFailureThreshold': 5,
        'openai.circuitCooldownMs': 60_000,
        'openai.retryBaseDelayMs': 100,
      });
    });

    it('starts in CLOSED state', () => {
      expect(service.getCircuitState()).toBe('CLOSED');
    });

    it('opens after failureThreshold (5) consecutive failures', async () => {
      const operation = jest.fn().mockRejectedValue(makeError(500));
      for (let i = 0; i < 5; i++) {
        await expect(service.executeWithRetry(operation)).rejects.toThrow();
      }
      expect(service.getCircuitState()).toBe('OPEN');
    });

    it('throws CircuitOpenException without calling operation on the sixth call', async () => {
      const operation = jest.fn().mockRejectedValue(makeError(500));
      for (let i = 0; i < 5; i++) {
        await expect(service.executeWithRetry(operation)).rejects.toThrow();
      }
      operation.mockClear();

      await expect(service.executeWithRetry(operation)).rejects.toThrow(CircuitOpenException);
      expect(operation).not.toHaveBeenCalled();
    });

    it('transitions to HALF_OPEN after cooldown and closes on a successful attempt', async () => {
      const operation = jest.fn().mockRejectedValue(makeError(500));
      for (let i = 0; i < 5; i++) {
        await expect(service.executeWithRetry(operation)).rejects.toThrow();
      }
      expect(service.getCircuitState()).toBe('OPEN');

      await jest.advanceTimersByTimeAsync(60_000);

      operation.mockResolvedValueOnce('back online');
      const result = await service.executeWithRetry(operation);

      expect(result).toBe('back online');
      expect(service.getCircuitState()).toBe('CLOSED');
    });

    it('re-opens circuit when a HALF_OPEN attempt fails', async () => {
      const operation = jest.fn().mockRejectedValue(makeError(500));
      for (let i = 0; i < 5; i++) {
        await expect(service.executeWithRetry(operation)).rejects.toThrow();
      }

      await jest.advanceTimersByTimeAsync(60_000);

      await expect(service.executeWithRetry(operation)).rejects.toThrow('HTTP 500');
      expect(service.getCircuitState()).toBe('OPEN');
    });

    it('resetCircuit restores CLOSED state and zero consecutive failures', async () => {
      const operation = jest.fn().mockRejectedValue(makeError(500));
      for (let i = 0; i < 5; i++) {
        await expect(service.executeWithRetry(operation)).rejects.toThrow();
      }
      expect(service.getCircuitState()).toBe('OPEN');

      service.resetCircuit();

      expect(service.getCircuitState()).toBe('CLOSED');
      // Verify the circuit is fully reset — a new call should work
      operation.mockResolvedValueOnce('reset works');
      const result = await service.executeWithRetry(operation);
      expect(result).toBe('reset works');
    });
  });
});
