import { HttpService } from '@nestjs/axios';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { NEVER, of } from 'rxjs';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ToolExecutorService } from '../services/tool-executor.service';
import { ToolRegistryService } from '../services/tool-registry.service';
import { WeatherTool } from '../tools/weather.tool';
import type { ToolEntity } from '../types/ai-chat.types';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url) — pulled in
// transitively via ToolRegistryService's DatabaseService import.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeTool(overrides: Partial<ToolEntity> = {}): ToolEntity {
  return {
    publicId: 'tool-pub-1',
    name: 'calculator',
    displayName: 'Calculator',
    description: 'Evaluate a mathematical expression',
    parameters: {},
    handlerType: 'builtin',
    handlerConfig: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('ToolExecutorService', () => {
  let service: ToolExecutorService;
  let toolRegistryMock: { findActiveTool: jest.Mock };
  let weatherToolMock: { execute: jest.Mock };
  let httpMock: { request: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    toolRegistryMock = { findActiveTool: jest.fn() };
    weatherToolMock = { execute: jest.fn() };
    httpMock = { request: jest.fn() };
    configMock = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolExecutorService,
        { provide: ToolRegistryService, useValue: toolRegistryMock },
        { provide: WeatherTool, useValue: weatherToolMock },
        { provide: HttpService, useValue: httpMock },
        { provide: ConfigService, useValue: configMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<ToolExecutorService>(ToolExecutorService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('execute() — builtin dispatch', () => {
    it('routes to calculator by name and returns its result', async () => {
      toolRegistryMock.findActiveTool.mockResolvedValue(
        makeTool({ name: 'calculator', handlerType: 'builtin' }),
      );

      const result = await service.execute('calculator', { expression: '2 + 2' });

      expect(result).toEqual({
        success: true,
        result: { result: 4 },
        executionMs: expect.any(Number),
      });
    });

    it('routes to datetime by name and returns its result', async () => {
      toolRegistryMock.findActiveTool.mockResolvedValue(
        makeTool({ name: 'datetime', handlerType: 'builtin' }),
      );

      const result = await service.execute('datetime', { timezone: 'UTC' });

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({ timezone: 'UTC' });
    });

    it('routes to weather by name via the injected WeatherTool', async () => {
      toolRegistryMock.findActiveTool.mockResolvedValue(
        makeTool({ name: 'weather', handlerType: 'builtin' }),
      );
      weatherToolMock.execute.mockResolvedValue({ city: 'London', temperature: 15 });

      const result = await service.execute('weather', { city: 'London' });

      expect(weatherToolMock.execute).toHaveBeenCalledWith({ city: 'London' });
      expect(result).toEqual({
        success: true,
        result: { city: 'London', temperature: 15 },
        executionMs: expect.any(Number),
      });
    });

    it('surfaces a builtin handler error as a structured failure, never a rejection', async () => {
      toolRegistryMock.findActiveTool.mockResolvedValue(
        makeTool({ name: 'calculator', handlerType: 'builtin' }),
      );

      const result = await service.execute('calculator', { expression: '((' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.executionMs).toEqual(expect.any(Number));
    });
  });

  describe('execute() — unknown/inactive tool', () => {
    it('returns a structured failure when the tool registry throws', async () => {
      toolRegistryMock.findActiveTool.mockRejectedValue(new NotFoundException('not found'));

      const result = await service.execute('nonexistent', {});

      expect(result).toEqual({
        success: false,
        result: null,
        error: "Tool 'nonexistent' is not available",
        executionMs: expect.any(Number),
      });
    });

    it('returns a structured failure for a builtin-typed tool with no matching handler', async () => {
      toolRegistryMock.findActiveTool.mockResolvedValue(
        makeTool({ name: 'not-a-real-handler', handlerType: 'builtin' }),
      );

      const result = await service.execute('not-a-real-handler', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Tool 'not-a-real-handler' is not available");
    });
  });

  describe('execute() — builtin timeout', () => {
    it('returns the exact timeout error shape when a builtin tool exceeds toolTimeoutMs', async () => {
      jest.useFakeTimers();
      configMock.get.mockImplementation((key: string) =>
        key === 'chat.toolTimeoutMs' ? 100 : undefined,
      );
      toolRegistryMock.findActiveTool.mockResolvedValue(
        makeTool({ name: 'weather', handlerType: 'builtin' }),
      );
      weatherToolMock.execute.mockReturnValue(new Promise(() => {}));

      const promise = service.execute('weather', { city: 'London' });
      await jest.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(result).toEqual({
        success: false,
        result: null,
        error: 'Tool execution timed out',
        executionMs: expect.any(Number),
      });
    });
  });

  describe('execute() — HTTP tools', () => {
    function makeHttpTool(overrides: Partial<ToolEntity> = {}): ToolEntity {
      return makeTool({
        name: 'http-tool',
        handlerType: 'http',
        handlerConfig: { url: 'https://example.com/api' },
        ...overrides,
      });
    }

    it('issues the request when the host is in the allowed-domains whitelist', async () => {
      configMock.get.mockImplementation((key: string) =>
        key === 'chat.httpToolAllowedDomains' ? ['example.com'] : undefined,
      );
      toolRegistryMock.findActiveTool.mockResolvedValue(makeHttpTool());
      httpMock.request.mockReturnValue(of({ data: { ok: true } }));

      const result = await service.execute('http-tool', { foo: 'bar' });

      expect(httpMock.request).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com/api', data: { foo: 'bar' } }),
      );
      expect(result).toEqual({
        success: true,
        result: { ok: true },
        executionMs: expect.any(Number),
      });
    });

    it('rejects a disallowed domain before any request is sent', async () => {
      configMock.get.mockImplementation((key: string) =>
        key === 'chat.httpToolAllowedDomains' ? ['other.com'] : undefined,
      );
      toolRegistryMock.findActiveTool.mockResolvedValue(makeHttpTool());

      const result = await service.execute('http-tool', {});

      expect(httpMock.request).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        result: null,
        error: 'Domain not allowed: example.com',
        executionMs: expect.any(Number),
      });
    });

    it('fails closed — an empty (default) whitelist blocks every HTTP tool', async () => {
      configMock.get.mockImplementation((key: string) =>
        key === 'chat.httpToolAllowedDomains' ? [] : undefined,
      );
      toolRegistryMock.findActiveTool.mockResolvedValue(makeHttpTool());

      const result = await service.execute('http-tool', {});

      expect(httpMock.request).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Domain not allowed: example.com');
    });

    it('returns the exact timeout error shape when an HTTP tool exceeds httpToolTimeoutMs', async () => {
      jest.useFakeTimers();
      configMock.get.mockImplementation((key: string) => {
        if (key === 'chat.httpToolAllowedDomains') return ['example.com'];
        if (key === 'chat.httpToolTimeoutMs') return 100;
        return undefined;
      });
      toolRegistryMock.findActiveTool.mockResolvedValue(makeHttpTool());
      httpMock.request.mockReturnValue(NEVER);

      const promise = service.execute('http-tool', {});
      await jest.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(result).toEqual({
        success: false,
        result: null,
        error: 'Tool execution timed out',
        executionMs: expect.any(Number),
      });
    });

    it('returns a structured failure when handlerConfig is missing a url', async () => {
      toolRegistryMock.findActiveTool.mockResolvedValue(makeHttpTool({ handlerConfig: {} }));

      const result = await service.execute('http-tool', {});

      expect(httpMock.request).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/missing a url/);
    });
  });

  describe('execute() — concurrency', () => {
    it('runs ten concurrent calls independently with no cross-call state bleed', async () => {
      toolRegistryMock.findActiveTool.mockImplementation((name: string) => {
        if (name === 'calculator') return Promise.resolve(makeTool({ name: 'calculator' }));
        if (name === 'datetime') return Promise.resolve(makeTool({ name: 'datetime' }));
        return Promise.reject(new NotFoundException());
      });

      const calls = Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0
          ? service.execute('calculator', { expression: `${i} + 1` })
          : service.execute('datetime', { timezone: 'UTC' }),
      );

      const results = await Promise.all(calls);

      results.forEach((result, i) => {
        expect(result.success).toBe(true);
        expect(result.executionMs).toEqual(expect.any(Number));
        if (i % 2 === 0) {
          expect(result.result).toEqual({ result: i + 1 });
        } else {
          expect(result.result).toMatchObject({ timezone: 'UTC' });
        }
      });
    });
  });
});
