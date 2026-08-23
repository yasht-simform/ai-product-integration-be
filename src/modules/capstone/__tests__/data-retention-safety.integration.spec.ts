import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';

import type {
  AiAuditLog,
  ChatConversation,
  ModerationLog,
} from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { RetentionService } from '../../cost-management/services/retention.service';
import { mockLogger } from './capstone-test-helpers';

jest.mock('../../../database/database.service', () => ({
  DatabaseService: class MockDatabaseService {},
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

function makeAuditLog(id: number, createdAt: Date): AiAuditLog {
  return {
    id: BigInt(id),
    publicId: `audit-${id}`,
    requestId: null,
    userId: null,
    model: 'test-model',
    endpoint: 'chat.completions',
    systemPrompt: null,
    userMessage: null,
    assistantResponse: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    latencyMs: 0,
    temperature: null,
    maxTokens: null,
    status: 'SUCCESS',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    metadata: null,
    createdAt,
  };
}

function makeModerationLog(id: number, createdAt: Date): ModerationLog {
  return {
    id: BigInt(id),
    publicId: `modlog-${id}`,
    requestId: null,
    userId: null,
    direction: 'input',
    content: 'stub',
    isFlagged: false,
    categories: {},
    categoryScores: {},
    action: 'allowed',
    source: 'chat',
    metadata: null,
    createdAt,
  };
}

function makeConversation(id: number, isArchived: boolean, updatedAt: Date): ChatConversation {
  return {
    id: BigInt(id),
    publicId: `conv-${id}`,
    title: isArchived ? `Archived ${id}` : `Active ${id}`,
    systemPrompt: null,
    model: 'test-model',
    userId: null,
    toolsEnabled: false,
    metadata: null,
    isArchived,
    createdAt: updatedAt,
    updatedAt,
  };
}

// Test 4 (capstone spec §4): data retention safety — proves RetentionService (Phase 4) correctly
// distinguishes "old" from "current" across every retention category, and — the one property that
// matters most — never touches an active conversation regardless of its age (FR-RET-002), matching
// AI-075's own live-verified finding.
describe('Capstone Test 4 — Data Retention Safety', () => {
  let retentionService: RetentionService;
  let dbMock: DeepMockProxy<DatabaseService>;
  let auditLogs: AiAuditLog[];
  let moderationLogs: ModerationLog[];
  let conversations: ChatConversation[];

  beforeEach(async () => {
    dbMock = mockDeep<DatabaseService>();

    // Test data: one old + one current row per category, plus the critical case — an OLD but
    // ACTIVE (non-archived) conversation, which must survive cleanup no matter how old it is.
    auditLogs = [
      makeAuditLog(1, daysAgo(100)), // older than the 90-day default — due for deletion
      makeAuditLog(2, daysAgo(5)), // current — must survive
    ];
    moderationLogs = [
      makeModerationLog(1, daysAgo(100)), // older than the 90-day default — due for deletion
      makeModerationLog(2, daysAgo(5)), // current — must survive
    ];
    conversations = [
      makeConversation(1, true, daysAgo(40)), // archived, older than the 30-day default — deleted
      makeConversation(2, true, daysAgo(5)), // archived, but recent — must survive
      makeConversation(3, false, daysAgo(100)), // ACTIVE, very old — must survive regardless of age
    ];

    dbMock.aiAuditLog.findMany.mockImplementation((args) => {
      const cutoff = (args?.where as { createdAt?: { lt: Date } })?.createdAt?.lt;
      return Promise.resolve(
        auditLogs.filter((row) => !cutoff || row.createdAt < cutoff).map((row) => ({ id: row.id })),
      ) as never;
    });
    dbMock.aiAuditLog.deleteMany.mockImplementation((args) => {
      const ids = (args.where as { id: { in: bigint[] } }).id.in;
      const before = auditLogs.length;
      auditLogs = auditLogs.filter((row) => !ids.includes(row.id));
      return Promise.resolve({ count: before - auditLogs.length });
    });

    dbMock.moderationLog.findMany.mockImplementation((args) => {
      const cutoff = (args?.where as { createdAt?: { lt: Date } })?.createdAt?.lt;
      return Promise.resolve(
        moderationLogs
          .filter((row) => !cutoff || row.createdAt < cutoff)
          .map((row) => ({ id: row.id })),
      ) as never;
    });
    dbMock.moderationLog.deleteMany.mockImplementation((args) => {
      const ids = (args.where as { id: { in: bigint[] } }).id.in;
      const before = moderationLogs.length;
      moderationLogs = moderationLogs.filter((row) => !ids.includes(row.id));
      return Promise.resolve({ count: before - moderationLogs.length });
    });

    dbMock.chatConversation.findMany.mockImplementation((args) => {
      const where = args?.where as { isArchived?: boolean; updatedAt?: { lt: Date } };
      const cutoff = where?.updatedAt?.lt;
      return Promise.resolve(
        conversations
          .filter((row) => where?.isArchived === undefined || row.isArchived === where.isArchived)
          .filter((row) => !cutoff || row.updatedAt < cutoff)
          .map((row) => ({ id: row.id })),
      ) as never;
    });
    dbMock.chatConversation.deleteMany.mockImplementation((args) => {
      const ids = (args.where as { id: { in: bigint[] } }).id.in;
      const before = conversations.length;
      conversations = conversations.filter((row) => !ids.includes(row.id));
      return Promise.resolve({ count: before - conversations.length });
    });

    dbMock.embeddingCache.findMany.mockResolvedValue([]);
    dbMock.embeddingCache.count.mockResolvedValue(0);
    dbMock.aiAuditLog.count.mockResolvedValue(0);
    dbMock.moderationLog.count.mockResolvedValue(0);
    dbMock.chatConversation.count.mockResolvedValue(0);

    const mockConfig = { get: jest.fn(() => undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        SchedulerRegistry,
        { provide: DatabaseService, useValue: dbMock },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AppLoggerService, useValue: mockLogger },
      ],
    }).compile();

    retentionService = module.get<RetentionService>(RetentionService);
  });

  it('deletes old audit logs, old moderation logs, and old archived conversations while preserving current data and every active conversation', async () => {
    // Step 1 + 2: old + current test data already seeded above (fixture arrays).

    // Step 3: trigger cleanup.
    const report = await retentionService.runFullCleanup();

    // Step 4: old data deleted, current data preserved, active conversations untouched.
    expect(report.auditLogs.deleted).toBe(1);
    expect(report.moderationLogs.deleted).toBe(1);
    expect(report.archivedConversations.deleted).toBe(1);
    expect(report.totalDeleted).toBe(3);

    expect(auditLogs.map((row) => row.publicId)).toEqual(['audit-2']);
    expect(moderationLogs.map((row) => row.publicId)).toEqual(['modlog-2']);

    const survivingConversationIds = conversations.map((row) => row.publicId).sort();
    expect(survivingConversationIds).toEqual(['conv-2', 'conv-3']);

    // The one property that matters most: the old-but-active conversation (id 3) survived
    // despite being far older than the archived-conversation cutoff, because there is no code
    // path in RetentionService that ever deletes a non-archived conversation.
    const stillActive = conversations.find((row) => row.publicId === 'conv-3');
    expect(stillActive).toBeDefined();
    expect(stillActive?.isArchived).toBe(false);
  });
});
