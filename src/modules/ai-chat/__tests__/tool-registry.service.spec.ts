import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { ChatTool } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { ToolHandlerType } from '../constants/tool-handler-type.enum';
import { ToolRegistryService } from '../services/tool-registry.service';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeChatTool(overrides: Partial<ChatTool> = {}): ChatTool {
  return {
    id: BigInt(1),
    publicId: 'tool-pub-1',
    name: 'calculator',
    displayName: 'Calculator',
    description: 'Evaluate a mathematical expression',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'Math expression to evaluate' } },
      required: ['expression'],
    },
    handlerType: ToolHandlerType.BUILTIN,
    handlerConfig: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('ToolRegistryService', () => {
  let service: ToolRegistryService;
  let dbMock: DeepMockProxy<DatabaseService>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolRegistryService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<ToolRegistryService>(ToolRegistryService);
    jest.clearAllMocks();
  });

  describe('onModuleInit()', () => {
    it('upserts all three built-in tools by name', async () => {
      dbMock.chatTool.upsert.mockResolvedValue(makeChatTool());

      await service.onModuleInit();

      expect(dbMock.chatTool.upsert).toHaveBeenCalledTimes(3);
      expect(dbMock.chatTool.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'calculator' } }),
      );
      expect(dbMock.chatTool.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'weather' } }),
      );
      expect(dbMock.chatTool.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'datetime' } }),
      );
    });

    it('logs and swallows errors instead of crashing app boot', async () => {
      dbMock.chatTool.upsert.mockRejectedValue(new Error('db down'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('findAllTools()', () => {
    it('maps DB rows to ToolEntity', async () => {
      dbMock.chatTool.findMany.mockResolvedValue([makeChatTool()]);

      const result = await service.findAllTools();

      expect(result[0]).toMatchObject({ publicId: 'tool-pub-1', name: 'calculator' });
    });
  });

  describe('findActiveTool()', () => {
    it('throws NotFoundException when the tool does not exist', async () => {
      dbMock.chatTool.findUnique.mockResolvedValue(null);

      await expect(service.findActiveTool('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the tool exists but is inactive', async () => {
      dbMock.chatTool.findUnique.mockResolvedValue(makeChatTool({ isActive: false }));

      await expect(service.findActiveTool('calculator')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the mapped entity for an active tool', async () => {
      dbMock.chatTool.findUnique.mockResolvedValue(makeChatTool());

      const result = await service.findActiveTool('calculator');

      expect(result.name).toBe('calculator');
    });
  });

  describe('createTool()', () => {
    it('creates the tool', async () => {
      dbMock.chatTool.create.mockResolvedValue(makeChatTool());

      const result = await service.createTool({
        name: 'calculator',
        displayName: 'Calculator',
        description: 'Evaluate a mathematical expression',
        parameters: { type: 'object', properties: {} },
        handlerType: ToolHandlerType.BUILTIN,
      });

      expect(result.name).toBe('calculator');
    });

    it('throws ConflictException on a duplicate name (P2002)', async () => {
      dbMock.chatTool.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.createTool({
          name: 'calculator',
          displayName: 'Calculator',
          description: 'Evaluate a mathematical expression',
          parameters: { type: 'object', properties: {} },
          handlerType: ToolHandlerType.BUILTIN,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateTool()', () => {
    it('throws NotFoundException when the tool does not exist', async () => {
      dbMock.chatTool.findUnique.mockResolvedValue(null);

      await expect(service.updateTool('missing', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates and returns the mapped entity', async () => {
      dbMock.chatTool.findUnique.mockResolvedValue(makeChatTool());
      dbMock.chatTool.update.mockResolvedValue(makeChatTool({ displayName: 'Renamed' }));

      const result = await service.updateTool('tool-pub-1', { displayName: 'Renamed' });

      expect(result.displayName).toBe('Renamed');
    });
  });

  describe('deleteTool()', () => {
    it('throws NotFoundException when the tool does not exist', async () => {
      dbMock.chatTool.findUnique.mockResolvedValue(null);

      await expect(service.deleteTool('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes by setting isActive to false', async () => {
      dbMock.chatTool.findUnique.mockResolvedValue(makeChatTool());
      dbMock.chatTool.update.mockResolvedValue(makeChatTool({ isActive: false }));

      await service.deleteTool('tool-pub-1');

      expect(dbMock.chatTool.update).toHaveBeenCalledWith({
        where: { publicId: 'tool-pub-1' },
        data: { isActive: false },
      });
    });
  });

  describe('getToolDefinitions()', () => {
    it('matches the exact OpenAI tool-format shape from spec §5.3', async () => {
      dbMock.chatTool.findMany.mockResolvedValue([
        makeChatTool({
          name: 'calculator',
          description: 'Evaluate a mathematical expression and return the numeric result.',
          parameters: {
            type: 'object',
            properties: {
              expression: { type: 'string', description: 'Math expression to evaluate' },
            },
            required: ['expression'],
          },
        }),
      ]);

      const result = await service.getToolDefinitions();

      expect(result).toEqual([
        {
          type: 'function',
          function: {
            name: 'calculator',
            description: 'Evaluate a mathematical expression and return the numeric result.',
            parameters: {
              type: 'object',
              properties: {
                expression: { type: 'string', description: 'Math expression to evaluate' },
              },
              required: ['expression'],
            },
          },
        },
      ]);
    });

    it('queries only active tools', async () => {
      dbMock.chatTool.findMany.mockResolvedValue([]);

      await service.getToolDefinitions();

      expect(dbMock.chatTool.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
    });
  });
});
