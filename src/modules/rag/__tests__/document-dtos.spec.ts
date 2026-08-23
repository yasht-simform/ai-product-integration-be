import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateDocumentTextDto } from '../dto/create-document-text.dto';
import { CreateDocumentDto } from '../dto/create-document.dto';
import { QueryChunksDto } from '../dto/query-chunks.dto';
import { QueryDocumentsDto } from '../dto/query-documents.dto';
import { UpdateDocumentDto } from '../dto/update-document.dto';

describe('CreateDocumentDto validation', () => {
  it('rejects a missing sourceType', async () => {
    const dto = plainToInstance(CreateDocumentDto, { title: 'My Doc' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'sourceType')).toBe(true);
  });

  it('rejects an invalid sourceType', async () => {
    const dto = plainToInstance(CreateDocumentDto, { sourceType: 'docx' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'sourceType')).toBe(true);
  });

  it('rejects an invalid category', async () => {
    const dto = plainToInstance(CreateDocumentDto, { sourceType: 'txt', category: 'unknown' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('accepts a minimal valid payload', async () => {
    const dto = plainToInstance(CreateDocumentDto, { sourceType: 'txt' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(CreateDocumentDto, {
      title: 'Return Policy',
      description: 'How returns work',
      sourceType: 'pdf',
      category: 'faq',
      tags: ['policy', 'returns'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('UpdateDocumentDto validation', () => {
  it('rejects sourceType — not part of the update surface', async () => {
    const dto = plainToInstance(UpdateDocumentDto, { sourceType: 'pdf' });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((e) => e.property === 'sourceType')).toBe(true);
  });

  it('accepts a partial title-only update', async () => {
    const dto = plainToInstance(UpdateDocumentDto, { title: 'Renamed' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('QueryDocumentsDto validation', () => {
  it('rejects a limit above 100', async () => {
    const dto = plainToInstance(QueryDocumentsDto, { limit: '500' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects an invalid status', async () => {
    const dto = plainToInstance(QueryDocumentsDto, { status: 'unknown' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('accepts string query values, coercing page/limit to numbers', async () => {
    const dto = plainToInstance(QueryDocumentsDto, {
      category: 'docs',
      status: 'completed',
      tags: 'policy,returns',
      search: 'return',
      page: '2',
      limit: '10',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
  });
});

describe('CreateDocumentTextDto validation', () => {
  it('rejects a missing content', async () => {
    const dto = plainToInstance(CreateDocumentTextDto, { title: 'My Doc' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects sourceType — fixed to txt by DocumentService.createFromText(), not client-editable', async () => {
    const dto = plainToInstance(CreateDocumentTextDto, {
      content: 'Some raw text',
      sourceType: 'pdf',
    });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((e) => e.property === 'sourceType')).toBe(true);
  });

  it('accepts a minimal valid payload', async () => {
    const dto = plainToInstance(CreateDocumentTextDto, { content: 'Some raw text' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts a fully populated valid payload', async () => {
    const dto = plainToInstance(CreateDocumentTextDto, {
      title: 'Return Policy',
      description: 'How returns work',
      category: 'faq',
      tags: ['policy', 'returns'],
      content: 'Items can be returned within 30 days.',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('QueryChunksDto validation', () => {
  it('rejects a limit above 100', async () => {
    const dto = plainToInstance(QueryChunksDto, { limit: '500' });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('accepts string query values, coercing page/limit to numbers', async () => {
    const dto = plainToInstance(QueryChunksDto, { page: '2', limit: '10' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
  });

  it('accepts an empty payload — page/limit are optional', async () => {
    const dto = plainToInstance(QueryChunksDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
