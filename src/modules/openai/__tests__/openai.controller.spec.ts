import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';

import { AiAuditStatus } from '../constants/ai-audit-status.enum';
import { OpenAIModel } from '../constants/openai-model.enum';
import { PromptTechnique } from '../constants/prompt-technique.enum';
import { ChatCompletionDto } from '../dto/chat-completion.dto';
import { OpenaiController } from '../openai.controller';
import { AiAuditService } from '../services/ai-audit.service';
import { ModelRegistryService } from '../services/model-registry.service';
import { OpenaiService } from '../services/openai.service';
import { OpenRouterSyncService } from '../services/openrouter-sync.service';
import { PromptTemplateService } from '../services/prompt-template.service';
import { RetryService } from '../services/retry.service';
import { TokenService } from '../services/token.service';
import type { PromptTemplateEntity } from '../types/prompt-template.types';

// Must be hoisted before any import that loads DatabaseService → Prisma ESM (import.meta.url)
jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

// ── Shared fixtures ────────────────────────────────────────────────────────────

const COMPLETION_RESULT = {
  content: 'Hello from AI',
  model: OpenAIModel.GPT_4O,
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  estimatedCost: 0.001,
  latencyMs: 120,
};

function makeTemplateEntity(overrides: Partial<PromptTemplateEntity> = {}): PromptTemplateEntity {
  return {
    publicId: 'pub-abc-123',
    name: 'test-template',
    description: null,
    systemPrompt: 'You are helpful.',
    fewShotExamples: null,
    technique: PromptTechnique.SYSTEM_PROMPT,
    recommendedModel: 'gpt-4o',
    recommendedTemperature: 0.7,
    tags: [],
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeAuditLogRaw() {
  return {
    publicId: 'audit-pub-1',
    requestId: 'req-1',
    userId: null,
    model: 'gpt-4o',
    endpoint: 'chat_completions',
    systemPrompt: null,
    userMessage: 'Hello',
    assistantResponse: null,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    estimatedCost: 0.001,
    latencyMs: 100,
    temperature: null,
    maxTokens: null,
    status: AiAuditStatus.SUCCESS,
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-01-01'),
    metadata: null,
  };
}

// ── Controller tests ───────────────────────────────────────────────────────────

describe('OpenaiController', () => {
  let controller: OpenaiController;
  let openaiMock: { chatCompletion: jest.Mock; getModelPricing: jest.Mock };
  let auditMock: { findAll: jest.Mock; getCostSummary: jest.Mock; log: jest.Mock };
  let tokenMock: { countTokens: jest.Mock };
  let templateMock: {
    create: jest.Mock;
    findAll: jest.Mock;
    findByPublicId: jest.Mock;
    findByName: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let retryMock: { getCircuitState: jest.Mock };
  let modelRegistryMock: {
    findAllProviders: jest.Mock;
    createProvider: jest.Mock;
    updateProvider: jest.Mock;
    deleteProvider: jest.Mock;
    findAllModels: jest.Mock;
    createModel: jest.Mock;
    updateModel: jest.Mock;
    deleteModel: jest.Mock;
    findModelByModelId: jest.Mock;
    getModelPricing: jest.Mock;
    getPricingTable: jest.Mock;
    countModels: jest.Mock;
    countProviders: jest.Mock;
  };
  let openRouterSyncMock: { syncAll: jest.Mock; getLastSyncedAt: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    openaiMock = {
      chatCompletion: jest.fn().mockResolvedValue(COMPLETION_RESULT),
      getModelPricing: jest.fn().mockReturnValue({ 'gpt-4o': { input: 5, output: 15 } }),
    };
    auditMock = {
      findAll: jest
        .fn()
        .mockResolvedValue({ total: 1, page: 1, limit: 20, data: [makeAuditLogRaw()] }),
      getCostSummary: jest.fn().mockResolvedValue({
        totalCost: 0.5,
        callCount: 10,
        averageLatencyMs: 200,
        perModelBreakdown: [],
      }),
      log: jest.fn().mockResolvedValue(undefined),
    };
    tokenMock = { countTokens: jest.fn().mockReturnValue(5) };
    templateMock = {
      create: jest.fn().mockResolvedValue(makeTemplateEntity()),
      findAll: jest.fn().mockResolvedValue({ data: [makeTemplateEntity()], total: 1 }),
      findByPublicId: jest.fn().mockResolvedValue(makeTemplateEntity()),
      findByName: jest.fn().mockResolvedValue(makeTemplateEntity()),
      update: jest.fn().mockResolvedValue(makeTemplateEntity({ name: 'updated-name' })),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    retryMock = { getCircuitState: jest.fn().mockReturnValue('CLOSED') };
    modelRegistryMock = {
      findAllProviders: jest.fn().mockResolvedValue([]),
      createProvider: jest.fn(),
      updateProvider: jest.fn(),
      deleteProvider: jest.fn().mockResolvedValue(undefined),
      findAllModels: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
      createModel: jest.fn(),
      updateModel: jest.fn(),
      deleteModel: jest.fn().mockResolvedValue(undefined),
      findModelByModelId: jest.fn().mockResolvedValue(null),
      getModelPricing: jest.fn().mockResolvedValue({ input: 0, output: 0 }),
      getPricingTable: jest.fn().mockResolvedValue({ providers: [] }),
      countModels: jest.fn().mockResolvedValue(0),
      countProviders: jest.fn().mockResolvedValue(0),
    };
    openRouterSyncMock = {
      syncAll: jest
        .fn()
        .mockResolvedValue({ providersCreated: 0, modelsCreated: 0, modelsUpdated: 0 }),
      getLastSyncedAt: jest.fn().mockReturnValue(null),
    };
    configMock = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OpenaiController],
      providers: [
        { provide: OpenaiService, useValue: openaiMock },
        { provide: AiAuditService, useValue: auditMock },
        { provide: TokenService, useValue: tokenMock },
        { provide: PromptTemplateService, useValue: templateMock },
        { provide: RetryService, useValue: retryMock },
        { provide: ModelRegistryService, useValue: modelRegistryMock },
        { provide: OpenRouterSyncService, useValue: openRouterSyncMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    controller = module.get<OpenaiController>(OpenaiController);
  });

  // ── chatCompletion ───────────────────────────────────────────────────────────

  describe('chatCompletion()', () => {
    it('delegates to OpenaiService.chatCompletion() and returns the result', async () => {
      const dto = { prompt: 'What is 2+2?', model: OpenAIModel.GPT_4O };

      const result = await controller.chatCompletion(dto);

      expect(openaiMock.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'What is 2+2?', model: OpenAIModel.GPT_4O }),
      );
      expect(result.content).toBe(COMPLETION_RESULT.content);
      expect(result.usage).toEqual(COMPLETION_RESULT.usage);
    });
  });

  // ── compareModels ────────────────────────────────────────────────────────────

  describe('compareModels()', () => {
    it('calls chatCompletion() once per model and returns a results array', async () => {
      const dto = {
        prompt: 'Explain AI',
        models: [OpenAIModel.GPT_4O, OpenAIModel.GPT_4O_MINI],
      };

      const result = await controller.compareModels(dto);

      expect(openaiMock.chatCompletion).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        model: expect.any(String),
        content: expect.any(String),
      });
    });
  });

  // ── promptTest ───────────────────────────────────────────────────────────────

  describe('promptTest()', () => {
    it('without templateName: uses dto.systemPrompt and calls chatCompletion()', async () => {
      const dto = { prompt: 'Hello', systemPrompt: 'You are a robot.' };

      await controller.promptTest(dto);

      expect(templateMock.findByName).not.toHaveBeenCalled();
      expect(openaiMock.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: 'You are a robot.' }),
      );
    });

    it('with templateName: loads template systemPrompt via findByName() then calls chatCompletion()', async () => {
      templateMock.findByName.mockResolvedValue(
        makeTemplateEntity({ systemPrompt: 'Template system prompt.' }),
      );
      const dto = { prompt: 'Hello', templateName: 'test-template' };

      await controller.promptTest(dto);

      expect(templateMock.findByName).toHaveBeenCalledWith('test-template');
      expect(openaiMock.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: 'Template system prompt.' }),
      );
    });

    it('propagates NotFoundException when templateName refers to a missing template', async () => {
      templateMock.findByName.mockRejectedValue(new NotFoundException('Not found'));
      const dto = { prompt: 'Hello', templateName: 'missing' };

      await expect(
        controller.promptTest(dto as Parameters<typeof controller.promptTest>[0]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── countTokens ──────────────────────────────────────────────────────────────

  describe('countTokens()', () => {
    it('calls TokenService.countTokens() and returns token count with character count', () => {
      const dto = { text: 'Hello world', model: OpenAIModel.GPT_4O };

      const result = controller.countTokens(dto);

      expect(tokenMock.countTokens).toHaveBeenCalledWith('Hello world', OpenAIModel.GPT_4O);
      expect(result.tokenCount).toBe(5);
      expect(result.characterCount).toBe(11);
    });

    it('does NOT call AiAuditService.log()', () => {
      controller.countTokens({ text: 'test', model: OpenAIModel.GPT_4O });

      expect(auditMock.log).not.toHaveBeenCalled();
    });
  });

  // ── getModelPricing ──────────────────────────────────────────────────────────

  describe('getModelPricing()', () => {
    it('calls OpenaiService.getModelPricing() and wraps result in { pricing }', () => {
      const result = controller.getModelPricing();

      expect(openaiMock.getModelPricing).toHaveBeenCalled();
      expect(result).toHaveProperty('pricing');
    });
  });

  // ── getHealth ────────────────────────────────────────────────────────────────

  describe('getHealth()', () => {
    it('returns { circuitState: CLOSED, status: ok } when circuit is CLOSED', () => {
      retryMock.getCircuitState.mockReturnValue('CLOSED');

      const result = controller.getHealth();

      expect(result).toEqual({ circuitState: 'CLOSED', status: 'ok' });
    });

    it('returns { circuitState: OPEN, status: degraded } when circuit is OPEN', () => {
      retryMock.getCircuitState.mockReturnValue('OPEN');

      const result = controller.getHealth();

      expect(result).toEqual({ circuitState: 'OPEN', status: 'degraded' });
    });
  });

  // ── getAuditLogs ─────────────────────────────────────────────────────────────

  describe('getAuditLogs()', () => {
    it('delegates to AiAuditService.findAll() and maps result stripping BigInt id', async () => {
      const query = { page: 1, limit: 20 };

      const result = await controller.getAuditLogs(query);

      expect(auditMock.findAll).toHaveBeenCalledWith(query);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).not.toHaveProperty('id');
      expect(result.data[0].publicId).toBe('audit-pub-1');
      expect(result.data[0].userId).toBeUndefined();
    });
  });

  // ── getCostSummary ───────────────────────────────────────────────────────────

  describe('getCostSummary()', () => {
    it('delegates to AiAuditService.getCostSummary() and returns the result directly', async () => {
      const query = { userId: 'u-1' };

      const result = await controller.getCostSummary(query);

      expect(auditMock.getCostSummary).toHaveBeenCalledWith(query);
      expect(result.callCount).toBe(10);
      expect(result.totalCost).toBe(0.5);
    });
  });

  // ── createTemplate ───────────────────────────────────────────────────────────

  describe('createTemplate()', () => {
    it('delegates to PromptTemplateService.create() and returns mapped PromptTemplateResDto', async () => {
      const dto = {
        name: 'new-template',
        systemPrompt: 'Be concise.',
        technique: PromptTechnique.SYSTEM_PROMPT,
      };

      const result = await controller.createTemplate(dto);

      expect(templateMock.create).toHaveBeenCalledWith(dto);
      expect(result.publicId).toBe('pub-abc-123');
      expect(result).not.toHaveProperty('id');
    });

    it('maps description: null to undefined', async () => {
      templateMock.create.mockResolvedValue(makeTemplateEntity({ description: null }));

      const result = await controller.createTemplate({
        name: 'x',
        systemPrompt: 'y',
        technique: PromptTechnique.SYSTEM_PROMPT,
      });

      expect(result.description).toBeUndefined();
    });
  });

  // ── listTemplates ────────────────────────────────────────────────────────────

  describe('listTemplates()', () => {
    it('delegates to PromptTemplateService.findAll() and returns paginated result', async () => {
      const query = { isActive: true, page: 1, limit: 10 };

      const result = await controller.listTemplates(query);

      expect(templateMock.findAll).toHaveBeenCalledWith(query);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].publicId).toBe('pub-abc-123');
    });
  });

  // ── getTemplate ──────────────────────────────────────────────────────────────

  describe('getTemplate()', () => {
    it('returns mapped PromptTemplateResDto for a valid publicId', async () => {
      const result = await controller.getTemplate('pub-abc-123');

      expect(templateMock.findByPublicId).toHaveBeenCalledWith('pub-abc-123');
      expect(result.publicId).toBe('pub-abc-123');
    });

    it('propagates NotFoundException when publicId is not found', async () => {
      templateMock.findByPublicId.mockRejectedValue(new NotFoundException('Not found'));

      await expect(controller.getTemplate('missing-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── updateTemplate ───────────────────────────────────────────────────────────

  describe('updateTemplate()', () => {
    it('delegates to PromptTemplateService.update() and returns updated template', async () => {
      const dto = { name: 'updated-name' };

      const result = await controller.updateTemplate('pub-abc-123', dto);

      expect(templateMock.update).toHaveBeenCalledWith('pub-abc-123', dto);
      expect(result.name).toBe('updated-name');
    });
  });

  // ── removeTemplate ───────────────────────────────────────────────────────────

  describe('removeTemplate()', () => {
    it('delegates to PromptTemplateService.remove() and returns void', async () => {
      await expect(controller.removeTemplate('pub-abc-123')).resolves.toBeUndefined();

      expect(templateMock.remove).toHaveBeenCalledWith('pub-abc-123');
    });

    it('propagates NotFoundException when publicId is not found', async () => {
      templateMock.remove.mockRejectedValue(new NotFoundException('Not found'));

      await expect(controller.removeTemplate('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

// ── DTO validation tests ───────────────────────────────────────────────────────

describe('ChatCompletionDto validation', () => {
  it('empty prompt produces a validation error on the prompt field', async () => {
    const dto = new ChatCompletionDto();
    dto.prompt = '';

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'prompt')).toBe(true);
  });

  it('temperature above 2 produces a validation error on the temperature field', async () => {
    const dto = new ChatCompletionDto();
    dto.prompt = 'valid prompt';
    dto.temperature = 5;

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'temperature')).toBe(true);
  });
});
