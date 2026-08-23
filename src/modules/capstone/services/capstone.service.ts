import { ConflictException, Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { ChatService } from '../../ai-chat/services/chat.service';
import { CostBudgetService } from '../../cost-management/services/cost-budget.service';
import { DocumentService } from '../../rag/services/document.service';
import { MockDataService, REALISTIC_SEED_TAG } from '../../rag/services/mock-data.service';
import { PineconeService } from '../../rag/services/pinecone.service';
import type { EvaluationResult } from '../../rag/types/rag.types';
import {
  CAPSTONE_DEMO_DOCUMENT_COUNT,
  CAPSTONE_EVAL_SAMPLE_SIZE,
  DEMO_BUDGETS,
  DEMO_CONVERSATION_TITLE_PREFIX,
  DEMO_CONVERSATIONS,
  DEMO_USER_IDS,
} from '../constants/demo-data.constant';
import type {
  CapstoneResetResult,
  CapstoneSeedResult,
  CapstoneStatusResult,
} from '../types/capstone.types';

// This service does not implement any new AI capability of its own — it is purely an
// orchestration/composition layer over MockDataService (Phase 3), ChatService (Phase 2), and
// CostBudgetService (Phase 4), proving (per the capstone spec's own framing) that all 4 phases
// work together as one product rather than as four isolated modules.
@Injectable()
export class CapstoneService {
  // The most recent evaluation report from THIS process (reset on restart, same tradeoff
  // RetentionService.lastReport already accepts for its own "last run" field) — read by
  // getStatus() so a demo presenter can show an accuracy figure without re-running evaluation.
  private lastEvaluation: EvaluationResult | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: AppLoggerService,
    private readonly mockDataService: MockDataService,
    private readonly documentService: DocumentService,
    private readonly pineconeService: PineconeService,
    private readonly chatService: ChatService,
    private readonly costBudgetService: CostBudgetService,
  ) {}

  /**
   * Runs the full demo-dataset seed (spec §3.3): 50 documents (embedded synchronously — every
   * `await` below only resolves once the prior step's work, including embeddings, is actually
   * done — `MockDataService.seedRealisticDataset()` awaits `DocumentService.ingestFromFile()` per
   * document, which itself awaits the full chunk→embed→Pinecone-upsert pipeline, so there is no
   * separate "wait for embeddings" step to add here), 250 Q&A pairs, 2-3 sample conversations, 3
   * sample budgets, then a real evaluation run — returning one summary object a demo script or a
   * CI job can print directly.
   */
  async seed(): Promise<CapstoneSeedResult> {
    this.logger.log(
      'Capstone seed: starting — this seeds 50 documents and can take several minutes',
    );

    const { documents, qaPairs } = await this.mockDataService.seedRealisticDataset();
    const conversations = await this.seedSampleConversations();
    const budgets = await this.seedSampleBudgets();
    const evaluation = await this.mockDataService.evaluate(CAPSTONE_EVAL_SAMPLE_SIZE);
    this.lastEvaluation = evaluation;

    const { chunks, vectors } = await this.getDatasetStats();

    const summary =
      `Demo dataset ready: ${documents} docs, ${chunks} chunks, ${vectors} vectors, ` +
      `${qaPairs} Q&A pairs, ${conversations} conversations, ${budgets} budgets ` +
      `(evaluation accuracy: ${Math.round(evaluation.accuracy * 100)}%)`;
    this.logger.log(summary);

    return { documents, chunks, vectors, qaPairs, conversations, budgets, evaluation, summary };
  }

  /**
   * Deletes exactly what `seed()` created (spec §7): every document tagged `"realistic-seed"`
   * (cascading its chunks, Q&A pairs, and Pinecone vectors via `DocumentService.delete()`), every
   * conversation titled with the `"[Capstone Demo]"` prefix, and the 3 fixed demo budgets. Nothing
   * else in the database is touched — this is a scoped reset of capstone demo data, not a general
   * database wipe.
   */
  async reset(): Promise<CapstoneResetResult> {
    const documentsDeleted = await this.deleteDemoDocuments();
    const conversationsDeleted = await this.deleteDemoConversations();
    const budgetsDeleted = await this.deleteDemoBudgets();
    this.lastEvaluation = null;

    const summary =
      `Capstone demo data cleared: ${documentsDeleted} documents, ` +
      `${conversationsDeleted} conversations, ${budgetsDeleted} budgets deleted`;
    this.logger.log(summary);

    return { documentsDeleted, conversationsDeleted, budgetsDeleted, summary };
  }

  /** Demo readiness check (spec §7): dataset shape plus the most recent in-process evaluation. */
  async getStatus(): Promise<CapstoneStatusResult> {
    const { documents, chunks, vectors, qaPairs } = await this.getDatasetStats();
    const conversations = await this.databaseService.chatConversation.count({
      where: { title: { startsWith: DEMO_CONVERSATION_TITLE_PREFIX } },
    });
    const budgets = await this.databaseService.userCostBudget.count({
      where: { userId: { in: DEMO_USER_IDS } },
    });

    return {
      ready: documents >= CAPSTONE_DEMO_DOCUMENT_COUNT,
      documents,
      chunks,
      vectors,
      qaPairs,
      conversations,
      budgets,
      lastEvaluation: this.lastEvaluation,
    };
  }

  /** Runs (and remembers, for getStatus()) a full evaluation over the seeded Q&A pairs. */
  async runEvaluation(sampleSize?: number): Promise<EvaluationResult> {
    const result = await this.mockDataService.evaluate(sampleSize ?? CAPSTONE_EVAL_SAMPLE_SIZE);
    this.lastEvaluation = result;
    return result;
  }

  // ── Seeding helpers ──────────────────────────────────────────────────────

  // Skips a conversation whose exact demo title already exists, so calling seed() twice in a row
  // (without an intervening reset()) doesn't pile up duplicate demo conversations. Each
  // conversation's message-sending is isolated in its own try/catch — a single flaky free-tier
  // model response must not abort the rest of the seed (same degrade-gracefully convention as
  // ToolExecutorService.execute() and RagController.getStats()'s Pinecone guard).
  private async seedSampleConversations(): Promise<number> {
    for (const demo of DEMO_CONVERSATIONS) {
      const existing = await this.databaseService.chatConversation.findFirst({
        where: { title: demo.title },
      });
      if (existing) continue;

      try {
        const conversation = await this.chatService.createConversation({
          title: demo.title,
          systemPrompt: demo.systemPrompt,
          toolsEnabled: demo.toolsEnabled,
        });
        for (const content of demo.messages) {
          await this.chatService.sendMessage(conversation.publicId, { content });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Capstone seed: failed to seed demo conversation "${demo.title}": ${message}`,
        );
      }
    }

    return this.databaseService.chatConversation.count({
      where: { title: { startsWith: DEMO_CONVERSATION_TITLE_PREFIX } },
    });
  }

  // Each budget's unique userId means a second seed() run without a reset() would throw
  // ConflictException on every already-existing budget — caught and skipped per-budget so seed()
  // stays safe to re-run, then the final count is read back from the database rather than
  // accumulated locally, so it's correct whether this run created 0, some, or all 3 budgets.
  private async seedSampleBudgets(): Promise<number> {
    for (const demo of DEMO_BUDGETS) {
      try {
        await this.costBudgetService.createBudget({
          userId: demo.userId,
          dailyLimitUsd: demo.dailyLimitUsd,
          monthlyLimitUsd: demo.monthlyLimitUsd,
          alertThreshold: demo.alertThreshold,
        });
      } catch (error) {
        if (error instanceof ConflictException) continue;
        throw error;
      }
    }

    return this.databaseService.userCostBudget.count({
      where: { userId: { in: DEMO_USER_IDS } },
    });
  }

  // ── Reset helpers ────────────────────────────────────────────────────────

  private async deleteDemoDocuments(): Promise<number> {
    const documents = await this.databaseService.document.findMany({
      where: { tags: { has: REALISTIC_SEED_TAG } },
      select: { publicId: true },
    });
    for (const document of documents) {
      await this.documentService.delete(document.publicId);
    }
    return documents.length;
  }

  private async deleteDemoConversations(): Promise<number> {
    const result = await this.databaseService.chatConversation.deleteMany({
      where: { title: { startsWith: DEMO_CONVERSATION_TITLE_PREFIX } },
    });
    return result.count;
  }

  private async deleteDemoBudgets(): Promise<number> {
    const result = await this.databaseService.userCostBudget.deleteMany({
      where: { userId: { in: DEMO_USER_IDS } },
    });
    return result.count;
  }

  // ── Shared stats ─────────────────────────────────────────────────────────

  // Scoped to demo-tagged documents for `documents`/`chunks`/`qaPairs` (this module's own data),
  // but `vectors` reflects the whole configured Pinecone index — same as RagController.getStats()
  // — since Pinecone has no per-tag count and this module shares one index/namespace with the
  // rest of the RAG pipeline. Degrades to 0 vectors (never throws) if Pinecone is unreachable,
  // mirroring RagController's own guard.
  private async getDatasetStats(): Promise<{
    documents: number;
    chunks: number;
    vectors: number;
    qaPairs: number;
  }> {
    const demoDocuments = await this.databaseService.document.findMany({
      where: { tags: { has: REALISTIC_SEED_TAG } },
      select: { totalChunks: true },
    });
    const documents = demoDocuments.length;
    const chunks = demoDocuments.reduce((sum, doc) => sum + doc.totalChunks, 0);

    const qaPairs = await this.databaseService.qaPair.count({
      where: { sourceDocument: { tags: { has: REALISTIC_SEED_TAG } } },
    });

    let vectors = 0;
    try {
      const stats = await this.pineconeService.describeIndex();
      vectors = stats.totalRecordCount;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Capstone: could not fetch Pinecone index stats: ${message}`);
    }

    return { documents, chunks, vectors, qaPairs };
  }
}
