import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type { PromptTemplate } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { PromptTechnique } from '../constants/prompt-technique.enum';
import type { CreatePromptTemplateDto } from '../dto/create-prompt-template.dto';
import type { QueryPromptTemplateDto } from '../dto/query-prompt-template.dto';
import { PromptTemplateService } from '../services/prompt-template.service';

// Prevents Jest from loading the Prisma-generated ESM client (import.meta.url)
// by substituting an empty class for the DI token.
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: BigInt(1),
    publicId: 'pub-uuid-001',
    name: 'test-template',
    description: null,
    systemPrompt: 'You are a helpful assistant.',
    fewShotExamples: null,
    technique: PromptTechnique.SYSTEM_PROMPT,
    recommendedModel: 'gpt-4o',
    recommendedTemperature: 0.7,
    tags: [],
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('PromptTemplateService', () => {
  let service: PromptTemplateService;
  let dbMock: DeepMockProxy<DatabaseService>;

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptTemplateService,
        { provide: DatabaseService, useValue: dbMock },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<PromptTemplateService>(PromptTemplateService);
    jest.clearAllMocks();
  });

  describe('create()', () => {
    it('calls db.promptTemplate.create() with correct data and returns entity without id', async () => {
      const dto: CreatePromptTemplateDto = {
        name: 'test-template',
        systemPrompt: 'You are helpful.',
        technique: PromptTechnique.SYSTEM_PROMPT,
        tags: ['test'],
      };
      dbMock.promptTemplate.create.mockResolvedValue(makeTemplate({ tags: ['test'] }));

      const result = await service.create(dto);

      expect(dbMock.promptTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'test-template',
            systemPrompt: 'You are helpful.',
            technique: PromptTechnique.SYSTEM_PROMPT,
            tags: ['test'],
          }),
        }),
      );
      expect(result).not.toHaveProperty('id');
      expect(result.publicId).toBe('pub-uuid-001');
    });

    it('throws ConflictException when Prisma returns P2002 (duplicate name)', async () => {
      const dto: CreatePromptTemplateDto = {
        name: 'existing-template',
        systemPrompt: 'You are helpful.',
        technique: PromptTechnique.SYSTEM_PROMPT,
      };
      const p2002 = Object.assign(new Error('Unique constraint failed on (name)'), {
        code: 'P2002',
      });
      dbMock.promptTemplate.create.mockRejectedValue(p2002);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll()', () => {
    it('calls findMany() with correct where, skip, take, and orderBy arguments', async () => {
      const query: QueryPromptTemplateDto = { page: 2, limit: 10 };
      dbMock.promptTemplate.findMany.mockResolvedValue([makeTemplate()]);
      dbMock.promptTemplate.count.mockResolvedValue(1);

      await service.findAll(query);

      expect(dbMock.promptTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          orderBy: { createdAt: 'desc' },
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it('applies hasSome filter when tags query param is provided', async () => {
      const query: QueryPromptTemplateDto = { tags: 'rag, search' };
      dbMock.promptTemplate.findMany.mockResolvedValue([]);
      dbMock.promptTemplate.count.mockResolvedValue(0);

      await service.findAll(query);

      expect(dbMock.promptTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tags: { hasSome: ['rag', 'search'] },
          }),
        }),
      );
    });

    it('applies technique filter when provided', async () => {
      const query: QueryPromptTemplateDto = { technique: PromptTechnique.FEW_SHOT };
      dbMock.promptTemplate.findMany.mockResolvedValue([]);
      dbMock.promptTemplate.count.mockResolvedValue(0);

      await service.findAll(query);

      expect(dbMock.promptTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ technique: PromptTechnique.FEW_SHOT }),
        }),
      );
    });

    it('returns { data, total } with correct pagination metadata', async () => {
      const templates = [makeTemplate(), makeTemplate({ id: BigInt(2), publicId: 'pub-002' })];
      dbMock.promptTemplate.findMany.mockResolvedValue(templates);
      dbMock.promptTemplate.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe('findByPublicId()', () => {
    it('throws NotFoundException when findUnique returns null', async () => {
      dbMock.promptTemplate.findUnique.mockResolvedValue(null);

      await expect(service.findByPublicId('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('returns entity without id when template is found', async () => {
      dbMock.promptTemplate.findUnique.mockResolvedValue(makeTemplate());

      const result = await service.findByPublicId('pub-uuid-001');

      expect(result.publicId).toBe('pub-uuid-001');
      expect(result).not.toHaveProperty('id');
    });
  });

  describe('update()', () => {
    it('throws NotFoundException when template does not exist', async () => {
      dbMock.promptTemplate.findUnique.mockResolvedValue(null);

      await expect(service.update('missing-id', { name: 'new-name' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calls db.promptTemplate.update() with partial data after finding the template', async () => {
      dbMock.promptTemplate.findUnique.mockResolvedValue(makeTemplate());
      dbMock.promptTemplate.update.mockResolvedValue(makeTemplate({ name: 'updated-name' }));

      const result = await service.update('pub-uuid-001', { name: 'updated-name' });

      expect(dbMock.promptTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { publicId: 'pub-uuid-001' },
          data: expect.objectContaining({ name: 'updated-name' }),
        }),
      );
      expect(result.name).toBe('updated-name');
    });
  });

  describe('remove()', () => {
    it('calls db.promptTemplate.delete() and returns void', async () => {
      dbMock.promptTemplate.findUnique.mockResolvedValue(makeTemplate());
      dbMock.promptTemplate.delete.mockResolvedValue(makeTemplate());

      const result = await service.remove('pub-uuid-001');

      expect(dbMock.promptTemplate.delete).toHaveBeenCalledWith({
        where: { publicId: 'pub-uuid-001' },
      });
      expect(result).toBeUndefined();
    });
  });
});
