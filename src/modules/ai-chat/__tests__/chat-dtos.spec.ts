import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ToolHandlerType } from '../constants/tool-handler-type.enum';
import { CreateConversationDto } from '../dto/create-conversation.dto';
import { CreateToolDto } from '../dto/create-tool.dto';
import { QueryConversationsDto } from '../dto/query-conversations.dto';
import { SendMessageDto } from '../dto/send-message.dto';
import { UpdateConversationDto } from '../dto/update-conversation.dto';
import { UpdateToolDto } from '../dto/update-tool.dto';

describe('CreateConversationDto validation', () => {
  it('rejects an invalid model string', async () => {
    const dto = plainToInstance(CreateConversationDto, { model: 'not a valid model' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'model')).toBe(true);
  });

  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(CreateConversationDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(CreateConversationDto, {
      title: 'My chat',
      systemPrompt: 'You are helpful.',
      model: 'gpt-4o',
      toolsEnabled: true,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('UpdateConversationDto validation', () => {
  it('rejects toolsEnabled — not part of the update surface', async () => {
    // Mirrors main.ts's ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }) — plain
    // validate() ignores properties without decorators, so it needs these options to reproduce
    // the app's actual "unknown field" rejection.
    const dto = plainToInstance(UpdateConversationDto, { toolsEnabled: true });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((e) => e.property === 'toolsEnabled')).toBe(true);
  });

  it('accepts a partial title-only update', async () => {
    const dto = plainToInstance(UpdateConversationDto, { title: 'Renamed' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('QueryConversationsDto validation', () => {
  it('rejects a limit above 100', async () => {
    const dto = plainToInstance(QueryConversationsDto, { limit: '500' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('accepts string query values, coercing page/limit to numbers', async () => {
    const dto = plainToInstance(QueryConversationsDto, {
      userId: 'user-1',
      isArchived: 'true',
      page: '2',
      limit: '10',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
    expect(dto.isArchived).toBe(true);
  });
});

describe('SendMessageDto validation', () => {
  it('rejects an empty content string', async () => {
    const dto = plainToInstance(SendMessageDto, { content: '' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('accepts a valid payload with overrides', async () => {
    const dto = plainToInstance(SendMessageDto, {
      content: 'What is 2+2?',
      model: 'gpt-4o-mini',
      temperature: 0.5,
      maxTokens: 512,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('CreateToolDto validation', () => {
  it('rejects an invalid handlerType', async () => {
    const dto = plainToInstance(CreateToolDto, {
      name: 'calculator',
      displayName: 'Calculator',
      description: 'Evaluate a mathematical expression',
      parameters: { type: 'object', properties: {} },
      handlerType: 'not-a-handler',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'handlerType')).toBe(true);
  });

  it('accepts a valid built-in tool payload', async () => {
    const dto = plainToInstance(CreateToolDto, {
      name: 'calculator',
      displayName: 'Calculator',
      description: 'Evaluate a mathematical expression',
      parameters: { type: 'object', properties: {} },
      handlerType: ToolHandlerType.BUILTIN,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('UpdateToolDto validation', () => {
  it('rejects a non-object parameters field', async () => {
    const dto = plainToInstance(UpdateToolDto, { parameters: 'not-an-object' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'parameters')).toBe(true);
  });

  it('accepts a partial displayName-only update', async () => {
    const dto = plainToInstance(UpdateToolDto, { displayName: 'Renamed tool' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
