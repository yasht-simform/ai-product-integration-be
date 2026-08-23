import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

import { faker } from '@faker-js/faker';
import { BadRequestException, Injectable } from '@nestjs/common';

import type { Document, DocumentChunk, Prisma } from '../../../../generated/prisma/client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { DatabaseService } from '../../../database/database.service';
import { DocumentCategory } from '../constants/document-category.constant';
import { QaComplexity } from '../constants/qa-complexity.constant';
import { RAG_CONFIG } from '../constants/rag-config.constant';
import type { QueryQaPairsDto } from '../dto/query-qa-pairs.dto';
import type {
  DocumentEntity,
  EvaluateQaPairInput,
  EvaluationClassification,
  EvaluationComplexityBreakdown,
  EvaluationResult,
  MockOptions,
  PaginatedQaPairsResult,
  QaPairEntity,
} from '../types/rag.types';
import { DocumentService } from './document.service';
import { RagService } from './rag.service';

const DEFAULT_MIN_WORDS = 200;
const DEFAULT_MAX_WORDS = 2000;
const MAX_SECTION_ITERATIONS = 200;

const SIMPLE_RATIO = 0.6;
const MULTI_STEP_RATIO = 0.25;

const DOCUMENTS_PER_CATEGORY = 10;
const QA_PAIRS_PER_DOCUMENT = 10;

// Static, hand-written, coherent English documents — the opposite of generateDocuments()'s
// faker.lorem-filled content, which AI-055's live verification proved produces embeddings too
// weak to clear the default similarity threshold (see seedRealisticDataset()'s own notes below).
const REALISTIC_SEED_DIR = join(__dirname, '..', 'seed-data');
// Exported so CapstoneService can identify (and delete) exactly the documents this method
// created, without duplicating the tag string or re-deriving it some other way.
export const REALISTIC_SEED_TAG = 'realistic-seed';
const REALISTIC_QA_PAIRS_FILE = 'qa-pairs.json';

const REALISTIC_SEED_METADATA: Record<string, { title: string; category: DocumentCategory }> = {
  'product-return-policy.md': {
    title: 'CloudPulse Subscription Return & Refund Policy',
    category: DocumentCategory.FAQ,
  },
  'getting-started-guide.md': {
    title: 'Getting Started with CloudPulse',
    category: DocumentCategory.GUIDE,
  },
  'api-reference.md': { title: 'CloudPulse REST API Reference', category: DocumentCategory.DOCS },
  'pricing-plans.md': { title: 'CloudPulse Pricing Plans', category: DocumentCategory.DOCS },
  'troubleshooting-faq.md': {
    title: 'CloudPulse Troubleshooting FAQ',
    category: DocumentCategory.FAQ,
  },
  'security-best-practices.md': {
    title: 'CloudPulse Security Best Practices',
    category: DocumentCategory.GUIDE,
  },
  'deployment-guide.md': {
    title: 'Deploying the CloudPulse Sync Agent',
    category: DocumentCategory.GUIDE,
  },
  'team-management.md': {
    title: 'Team Management in CloudPulse',
    category: DocumentCategory.GUIDE,
  },
  'changelog-2026.md': {
    title: 'CloudPulse Changelog — 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'integrations-guide.md': {
    title: 'CloudPulse Integrations Guide',
    category: DocumentCategory.GUIDE,
  },
  // The following 40 entries extend the original 10-document realistic seed (Phase 3, AI-055) to
  // 50 documents / 250 Q&A pairs for the capstone's production demo dataset (10 per
  // DocumentCategory) — see docs/specs/Capstone_Knowledge_Base_QA_Specification.md §3.1.
  'migration-guide.md': {
    title: 'Migrating to CloudPulse from Trello, Asana, or Jira',
    category: DocumentCategory.GUIDE,
  },
  'performance-tuning-guide.md': {
    title: 'Performance Tuning the CloudPulse Sync Agent',
    category: DocumentCategory.GUIDE,
  },
  'backup-restore-guide.md': {
    title: 'Backup and Restore (Enterprise)',
    category: DocumentCategory.GUIDE,
  },
  'sso-configuration-guide.md': {
    title: 'Configuring SSO for CloudPulse Enterprise',
    category: DocumentCategory.GUIDE,
  },
  'custom-fields-guide.md': {
    title: 'Working with Custom Fields',
    category: DocumentCategory.GUIDE,
  },
  'billing-faq.md': { title: 'CloudPulse Billing FAQ', category: DocumentCategory.FAQ },
  'security-faq.md': { title: 'CloudPulse Security FAQ', category: DocumentCategory.FAQ },
  'technical-faq.md': { title: 'CloudPulse Technical FAQ', category: DocumentCategory.FAQ },
  'account-faq.md': { title: 'CloudPulse Account FAQ', category: DocumentCategory.FAQ },
  'mobile-app-faq.md': { title: 'CloudPulse Mobile App FAQ', category: DocumentCategory.FAQ },
  'notifications-faq.md': {
    title: 'CloudPulse Notifications FAQ',
    category: DocumentCategory.FAQ,
  },
  'data-export-faq.md': { title: 'CloudPulse Data Export FAQ', category: DocumentCategory.FAQ },
  'api-faq.md': { title: 'CloudPulse API FAQ', category: DocumentCategory.FAQ },
  'architecture-overview.md': {
    title: 'CloudPulse Architecture Overview',
    category: DocumentCategory.DOCS,
  },
  'data-model.md': { title: 'CloudPulse Data Model', category: DocumentCategory.DOCS },
  'webhooks-reference.md': {
    title: 'CloudPulse Webhooks Reference',
    category: DocumentCategory.DOCS,
  },
  'sdk-reference-js.md': {
    title: 'CloudPulse Node.js SDK Reference',
    category: DocumentCategory.DOCS,
  },
  'sdk-reference-python.md': {
    title: 'CloudPulse Python SDK Reference',
    category: DocumentCategory.DOCS,
  },
  'cli-reference.md': { title: 'CloudPulse CLI Reference', category: DocumentCategory.DOCS },
  'permissions-reference.md': {
    title: 'CloudPulse Permissions Reference',
    category: DocumentCategory.DOCS,
  },
  'search-reference.md': {
    title: 'CloudPulse Search API Reference',
    category: DocumentCategory.DOCS,
  },
  'tutorial-first-board.md': {
    title: 'Tutorial: Create Your First CloudPulse Board',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-inviting-team.md': {
    title: 'Tutorial: Inviting Your Team and Assigning Roles',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-automation-basics.md': {
    title: 'Tutorial: Creating Your First Automation Rule',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-custom-fields.md': {
    title: 'Tutorial: Adding Custom Fields to a Board',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-slack-integration.md': {
    title: 'Tutorial: Connecting Slack to CloudPulse',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-github-integration.md': {
    title: 'Tutorial: Linking GitHub Commits to Tasks',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-api-quickstart.md': {
    title: 'Tutorial: Your First CloudPulse API Call',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-zapier-recipes.md': {
    title: 'Tutorial: Building Your First Zap with CloudPulse',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-reporting-dashboard.md': {
    title: 'Tutorial: Using the Timeline View and Bulk Editing',
    category: DocumentCategory.TUTORIAL,
  },
  'tutorial-webhooks-setup.md': {
    title: 'Tutorial: Setting Up a Webhook Receiver',
    category: DocumentCategory.TUTORIAL,
  },
  'changelog-2026-01.md': {
    title: 'CloudPulse Changelog — January 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'changelog-2026-02.md': {
    title: 'CloudPulse Changelog — February 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'changelog-2026-03.md': {
    title: 'CloudPulse Changelog — March 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'changelog-2026-04.md': {
    title: 'CloudPulse Changelog — April 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'changelog-2026-05.md': {
    title: 'CloudPulse Changelog — May 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'changelog-2026-06.md': {
    title: 'CloudPulse Changelog — June 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'changelog-2026-07.md': {
    title: 'CloudPulse Changelog — July 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'changelog-2026-08.md': {
    title: 'CloudPulse Changelog — August 2026',
    category: DocumentCategory.CHANGELOG,
  },
  'changelog-2026-09.md': {
    title: 'CloudPulse Changelog — September 2026',
    category: DocumentCategory.CHANGELOG,
  },
};

interface RealisticQaPairSeed {
  question: string;
  expectedAnswer: string;
  sourceDocument: string;
  complexity: string;
}

// Each evaluated question costs a live embedding + Pinecone + generation call — bounded by
// default, and hard-capped regardless of what a caller requests (AI-050's own "must be explicitly
// bounded" requirement).
const DEFAULT_EVAL_SAMPLE_SIZE = 50;
const MAX_EVAL_SAMPLE_SIZE = 200;

// Text-similarity heuristic thresholds, not a ground-truth grader (see evaluate()'s own notes) —
// the fraction of expectedAnswer's keywords that also appear in the generated answer.
const CORRECT_OVERLAP_THRESHOLD = 0.5;
const PARTIAL_OVERLAP_THRESHOLD = 0.2;
const MIN_KEYWORD_LENGTH = 4;

const STOPWORDS = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'what',
  'does',
  'your',
  'into',
  'each',
  'their',
  'about',
  'which',
  'there',
  'these',
  'those',
  'were',
  'been',
  'being',
  'only',
  'some',
  'such',
  'than',
  'then',
  'them',
  'they',
  'also',
  'when',
  'where',
  'while',
  'under',
  'over',
]);

// Paraphrase variants of RAG_CONFIG.noInfoSentinel that count as "the model appropriately
// declined to answer" — an LLM rarely reproduces the sentinel verbatim, so this checks for the
// core phrase plus common alternate phrasings rather than an exact match.
const IDK_PHRASES = [
  "don't have enough information",
  'do not have enough information',
  "i don't know",
  'i do not know',
  'cannot answer',
  "can't answer",
  'no relevant information',
  'not contain the answer',
  'unable to answer',
  "doesn't contain",
  'does not contain',
];

interface EvaluationRow {
  complexity: string;
  classification: EvaluationClassification;
  latencyMs: number;
  totalTokens: number;
}

// Deliberately unrelated to any faker-generated document content (see buildEdgeCasePairs()) —
// hardcoded rather than templated with faker.hacker.*/commerce.* terms, since those vocabularies
// overlap with the very content generateDocuments() produces, which could accidentally make an
// "edge case" question answerable.
const EDGE_CASE_QUESTIONS = [
  'What happens if I exceed the rate limit during a solar eclipse?',
  'How does this affect my horoscope compatibility with the current moon phase?',
  'What is the recommended dosage for a deployment powered by quantum tea leaves?',
  'Does this integrate with a time machine set to next Tuesday?',
  'What color is the sound made by a leap second?',
  'How many angels can dance on the head of this API endpoint?',
  'What happens if the server catches a cold during a meteor shower?',
  'Can this be operated safely while riding a unicycle underwater?',
];

interface DocumentTemplate {
  title: string;
  header: string;
  nextSection: (index: number) => string;
}

type DocumentWithChunkRows = Document & { chunks: DocumentChunk[] };

interface QaPairDraft {
  publicId: string;
  question: string;
  expectedAnswer: string;
  sourceDocumentId: bigint;
  sourceDocumentPublicId: string;
  complexity: string;
  createdAt: Date;
}

@Injectable()
export class MockDataService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: AppLoggerService,
    private readonly documentService: DocumentService,
    private readonly ragService: RagService,
  ) {}

  async generateDocuments(count: number, options: MockOptions = {}): Promise<DocumentEntity[]> {
    const categories = (
      options.categories?.length ? options.categories : Object.values(DocumentCategory)
    ) as DocumentCategory[];
    const minWords = options.minWords ?? DEFAULT_MIN_WORDS;
    const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;

    const documents: DocumentEntity[] = [];
    for (let i = 0; i < count; i++) {
      const category = categories[i % categories.length];
      const { title, content } = this.buildDocumentContent(category, minWords, maxWords);

      const document = await this.documentService.createFromText({
        title,
        category,
        tags: ['mock-data'],
        content,
      });
      documents.push(document);
    }

    return documents;
  }

  async generateQAPairs(count: number, documentIds?: string[]): Promise<QaPairEntity[]> {
    const documents = await this.databaseService.document.findMany({
      where: documentIds?.length ? { publicId: { in: documentIds } } : {},
      include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
    });

    const usableDocuments = documents.filter((document) => document.chunks.length > 0);
    if (usableDocuments.length === 0) {
      throw new BadRequestException(
        'No documents with embedded chunks are available to generate Q&A pairs from',
      );
    }

    const simpleCount = Math.round(count * SIMPLE_RATIO);
    const multiStepCount = Math.round(count * MULTI_STEP_RATIO);
    const edgeCaseCount = count - simpleCount - multiStepCount;

    const drafts: QaPairDraft[] = [
      ...this.buildSimplePairs(simpleCount, usableDocuments),
      ...this.buildMultiStepPairs(multiStepCount, usableDocuments),
      ...this.buildEdgeCasePairs(edgeCaseCount, usableDocuments),
    ];

    if (drafts.length > 0) {
      await this.databaseService.qaPair.createMany({
        data: drafts.map((draft) => ({
          publicId: draft.publicId,
          question: draft.question,
          expectedAnswer: draft.expectedAnswer,
          sourceDocumentId: draft.sourceDocumentId,
          complexity: draft.complexity,
          createdAt: draft.createdAt,
        })),
      });
    }

    return drafts.map((draft) => ({
      publicId: draft.publicId,
      question: draft.question,
      expectedAnswer: draft.expectedAnswer,
      sourceDocumentId: draft.sourceDocumentPublicId,
      complexity: draft.complexity,
      createdAt: draft.createdAt,
    }));
  }

  async seedDefaultDataset(): Promise<{ documents: number; qaPairs: number }> {
    const totalDocuments = Object.values(DocumentCategory).length * DOCUMENTS_PER_CATEGORY;
    const documents = await this.generateDocuments(totalDocuments);
    const qaPairs = await this.generateQAPairs(
      documents.length * QA_PAIRS_PER_DOCUMENT,
      documents.map((document) => document.publicId),
    );

    return { documents: documents.length, qaPairs: qaPairs.length };
  }

  // Seeds a hand-written, coherent English dataset (see seed-data/*.md — 50 CloudPulse documents,
  // 10 per DocumentCategory, extended from the original 10-document set by the capstone project;
  // see docs/specs/Capstone_Knowledge_Base_QA_Specification.md §3.1) instead of
  // generateDocuments()'s faker.lorem-filled content — AI-055's live verification against a real
  // Pinecone index found that faker-generated body text produces embeddings too weak to clear the
  // default 0.7 similarity threshold even for a question naming a real heading verbatim, making
  // faker-based evaluation results structurally meaningless. Every document is ingested through
  // the real DocumentService.ingestFromFile() pipeline (chunk + embed + Pinecone upsert), so this
  // method resolves only once every embedding has actually completed — no fire-and-forget.
  //
  // Q&A pairs are read from seed-data/qa-pairs.json and persisted as real QaPair rows (same
  // table generateQAPairs() writes to), keyed to each seeded document's internal id — so they're
  // immediately queryable via GET /rag/mock/qa-pairs and evaluable via the default
  // database-backed POST /rag/evaluate path, in addition to being passable directly in that
  // route's request body (see EvaluateDto.qaPairs).
  async seedRealisticDataset(): Promise<{ documents: number; qaPairs: number }> {
    const filenames = (await fs.readdir(REALISTIC_SEED_DIR))
      .filter((filename) => filename.endsWith('.md'))
      .sort();

    const documents: DocumentEntity[] = [];
    for (const filename of filenames) {
      const buffer = await fs.readFile(join(REALISTIC_SEED_DIR, filename));
      const metadata = REALISTIC_SEED_METADATA[filename];
      const document = await this.documentService.ingestFromFile(
        {
          fieldname: 'file',
          originalname: filename,
          encoding: '7bit',
          mimetype: 'text/markdown',
          size: buffer.length,
          buffer,
          stream: Readable.from(buffer),
          destination: '',
          filename: '',
          path: '',
        },
        { title: metadata?.title, category: metadata?.category, tags: [REALISTIC_SEED_TAG] },
      );
      documents.push(document);
    }

    const qaPairsRaw = JSON.parse(
      await fs.readFile(join(REALISTIC_SEED_DIR, REALISTIC_QA_PAIRS_FILE), 'utf-8'),
    ) as RealisticQaPairSeed[];

    const documentRows = await this.databaseService.document.findMany({
      where: { publicId: { in: documents.map((document) => document.publicId) } },
    });
    const documentIdByFilename = new Map<string, bigint>();
    for (const document of documentRows) {
      if (document.originalFilename) {
        documentIdByFilename.set(document.originalFilename, document.id);
      }
    }

    const drafts = qaPairsRaw
      .map((pair) => {
        const sourceDocumentId = documentIdByFilename.get(pair.sourceDocument);
        if (!sourceDocumentId) return null;
        return {
          publicId: randomUUID(),
          question: pair.question,
          expectedAnswer: pair.expectedAnswer,
          sourceDocumentId,
          complexity: pair.complexity,
          createdAt: new Date(),
        };
      })
      .filter((draft): draft is NonNullable<typeof draft> => draft !== null);

    if (drafts.length > 0) {
      await this.databaseService.qaPair.createMany({ data: drafts });
    }

    return { documents: documents.length, qaPairs: drafts.length };
  }

  // `documentId` filters by the source document's publicId — resolved to the internal FK id
  // before querying. An unresolvable documentId returns an empty page rather than 404ing, since
  // this is a listing filter (same convention as ChatService.findAllConversations()'s userId
  // filter), not a single-resource lookup.
  async findAllQaPairs(query: QueryQaPairsDto): Promise<PaginatedQaPairsResult> {
    const { page = 1, limit = 20, documentId, complexity } = query;
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where: Prisma.QaPairWhereInput = {};
    if (complexity) where.complexity = complexity;
    if (documentId) {
      const document = await this.databaseService.document.findUnique({
        where: { publicId: documentId },
      });
      if (!document) {
        return { data: [], total: 0, page, limit: take };
      }
      where.sourceDocumentId = document.id;
    }

    const [pairs, total] = await Promise.all([
      this.databaseService.qaPair.findMany({
        where,
        include: { sourceDocument: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.databaseService.qaPair.count({ where }),
    ]);

    return {
      data: pairs.map((pair) => ({
        publicId: pair.publicId,
        question: pair.question,
        expectedAnswer: pair.expectedAnswer,
        sourceDocumentId: pair.sourceDocument.publicId,
        complexity: pair.complexity,
        createdAt: pair.createdAt,
      })),
      total,
      page,
      limit: take,
    };
  }

  // Runs a bounded sample of Q&A pairs through the real RagService.query() pipeline and scores
  // each answer with a documented heuristic (see classifyAnswer()) — not a ground-truth grader.
  // sampleSize is always clamped to MAX_EVAL_SAMPLE_SIZE regardless of what the caller requests,
  // since every evaluated question is a live embedding + Pinecone + generation call and this
  // phase's target Q&A volume (10K+) makes an unbounded default a real cost/rate-limit hazard.
  //
  // When `qaPairs` is supplied (e.g. the static realistic dataset from seedRealisticDataset(),
  // which is intentionally never persisted to the qaPair table), it's used directly instead of
  // reading from the database — sampleSize still bounds how many of them are run.
  async evaluate(
    sampleSize: number = DEFAULT_EVAL_SAMPLE_SIZE,
    qaPairs?: EvaluateQaPairInput[],
  ): Promise<EvaluationResult> {
    const take = Math.min(sampleSize, MAX_EVAL_SAMPLE_SIZE);
    const pairs: EvaluateQaPairInput[] = qaPairs?.length
      ? qaPairs.slice(0, take)
      : await this.databaseService.qaPair.findMany({ take, orderBy: { id: 'asc' } });

    const rows: EvaluationRow[] = [];
    for (const pair of pairs) {
      const result = await this.ragService.query(pair.question);
      rows.push({
        complexity: pair.complexity,
        classification: this.classifyAnswer(pair.complexity, pair.expectedAnswer, result.answer),
        latencyMs: result.latencyMs,
        totalTokens: result.usage.totalTokens,
      });
    }

    return this.aggregateEvaluations(rows);
  }

  // Edge-case pairs are scored on whether the answer appropriately declines (see AI-050 AC #3),
  // never on content similarity — a technically-plausible-sounding answer to an unanswerable
  // question is still wrong. Simple/multi-step pairs use keyword overlap against expectedAnswer
  // as a cheap proxy for correctness, since exact-string matching is unreliable given LLM
  // phrasing variance and a full LLM-as-judge grader is out of this issue's scope.
  private classifyAnswer(
    complexity: string,
    expectedAnswer: string,
    answer: string,
  ): EvaluationClassification {
    if (complexity === QaComplexity.EDGE_CASE) {
      return this.looksLikeIDK(answer) ? 'appropriateIDK' : 'incorrect';
    }

    const overlap = this.keywordOverlapRatio(expectedAnswer, answer);
    if (overlap >= CORRECT_OVERLAP_THRESHOLD) return 'correct';
    if (overlap >= PARTIAL_OVERLAP_THRESHOLD) return 'partiallyCorrect';
    return 'incorrect';
  }

  private looksLikeIDK(answer: string): boolean {
    const normalized = answer.toLowerCase();
    return IDK_PHRASES.some((phrase) => normalized.includes(phrase));
  }

  private keywordOverlapRatio(expected: string, actual: string): number {
    const expectedWords = this.extractKeywords(expected);
    if (expectedWords.size === 0) return 0;

    const actualWords = this.extractKeywords(actual);
    let matches = 0;
    for (const word of expectedWords) {
      if (actualWords.has(word)) matches++;
    }
    return matches / expectedWords.size;
  }

  private extractKeywords(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= MIN_KEYWORD_LENGTH && !STOPWORDS.has(word)),
    );
  }

  private aggregateEvaluations(rows: EvaluationRow[]): EvaluationResult {
    const totalQuestions = rows.length;
    const correct = rows.filter((r) => r.classification === 'correct').length;
    const partiallyCorrect = rows.filter((r) => r.classification === 'partiallyCorrect').length;
    const incorrect = rows.filter((r) => r.classification === 'incorrect').length;
    const appropriateIDK = rows.filter((r) => r.classification === 'appropriateIDK').length;

    const byComplexity: Record<string, EvaluationComplexityBreakdown> = {};
    for (const tier of Object.values(QaComplexity)) {
      const tierRows = rows.filter((r) => r.complexity === tier);
      const tierTotal = tierRows.length;
      const tierCorrect = tierRows.filter((r) =>
        tier === QaComplexity.EDGE_CASE
          ? r.classification === 'appropriateIDK'
          : r.classification === 'correct',
      ).length;
      byComplexity[tier] = {
        total: tierTotal,
        correct: tierCorrect,
        accuracy: tierTotal > 0 ? this.roundTo2dp(tierCorrect / tierTotal) : 0,
      };
    }

    return {
      totalQuestions,
      correct,
      partiallyCorrect,
      incorrect,
      appropriateIDK,
      accuracy: totalQuestions > 0 ? this.roundTo2dp(correct / totalQuestions) : 0,
      avgLatencyMs:
        totalQuestions > 0
          ? Math.round(this.sum(rows.map((r) => r.latencyMs)) / totalQuestions)
          : 0,
      avgTokens:
        totalQuestions > 0
          ? Math.round(this.sum(rows.map((r) => r.totalTokens)) / totalQuestions)
          : 0,
      byComplexity,
    };
  }

  private sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
  }

  private roundTo2dp(value: number): number {
    return Math.round(value * 100) / 100;
  }

  // Round-robins documents and their chunks so a simple-tier question's expectedAnswer is always
  // exactly one chunk's own content — the fact it asks about is, by construction, answerable from
  // that single chunk.
  private buildSimplePairs(count: number, documents: DocumentWithChunkRows[]): QaPairDraft[] {
    const drafts: QaPairDraft[] = [];
    for (let i = 0; i < count; i++) {
      const document = documents[i % documents.length];
      const chunk = document.chunks[i % document.chunks.length];
      const topic = this.extractTopic(chunk.content);

      drafts.push(
        this.buildDraft(
          `According to "${document.title}", what is covered under "${topic}"?`,
          chunk.content.trim(),
          document,
          QaComplexity.SIMPLE,
        ),
      );
    }
    return drafts;
  }

  // Prefers cross-document synthesis (two different generated documents' chunks) when the pool
  // has at least two usable documents, matching the spec's "compare X and Y" example; falls back
  // to comparing two chunks within the same document when only one document is available.
  private buildMultiStepPairs(count: number, documents: DocumentWithChunkRows[]): QaPairDraft[] {
    const drafts: QaPairDraft[] = [];
    for (let i = 0; i < count; i++) {
      if (documents.length >= 2) {
        const docA = documents[i % documents.length];
        const docB = documents[(i + 1) % documents.length];
        const chunkA = docA.chunks[i % docA.chunks.length];
        const chunkB = docB.chunks[i % docB.chunks.length];
        const topicA = this.extractTopic(chunkA.content);
        const topicB = this.extractTopic(chunkB.content);

        drafts.push(
          this.buildDraft(
            `Compare "${docA.title}" and "${docB.title}": how does each address "${topicA}" versus "${topicB}"?`,
            `From "${docA.title}": ${chunkA.content.trim()}\n\nFrom "${docB.title}": ${chunkB.content.trim()}`,
            docA,
            QaComplexity.MULTI_STEP,
          ),
        );
      } else {
        const document = documents[0];
        const chunkA = document.chunks[i % document.chunks.length];
        const chunkB = document.chunks[(i + 1) % document.chunks.length];
        const topicA = this.extractTopic(chunkA.content);
        const topicB = this.extractTopic(chunkB.content);

        drafts.push(
          this.buildDraft(
            `Within "${document.title}", compare "${topicA}" with "${topicB}".`,
            `${chunkA.content.trim()}\n\n${chunkB.content.trim()}`,
            document,
            QaComplexity.MULTI_STEP,
          ),
        );
      }
    }
    return drafts;
  }

  // Cycles a hardcoded pool of scenarios that no generated document could ever answer, pairing
  // each with RAG_CONFIG's own "no info" sentinel as expectedAnswer — the same phrase the real
  // RAG pipeline is instructed to say when it can't answer from context (see rag-config.constant.ts).
  private buildEdgeCasePairs(count: number, documents: DocumentWithChunkRows[]): QaPairDraft[] {
    const drafts: QaPairDraft[] = [];
    for (let i = 0; i < count; i++) {
      const document = documents[i % documents.length];
      const question = EDGE_CASE_QUESTIONS[i % EDGE_CASE_QUESTIONS.length];

      drafts.push(
        this.buildDraft(question, RAG_CONFIG.noInfoSentinel, document, QaComplexity.EDGE_CASE),
      );
    }
    return drafts;
  }

  private buildDraft(
    question: string,
    expectedAnswer: string,
    document: DocumentWithChunkRows,
    complexity: string,
  ): QaPairDraft {
    return {
      publicId: randomUUID(),
      question,
      expectedAnswer,
      sourceDocumentId: document.id,
      sourceDocumentPublicId: document.publicId,
      complexity,
      createdAt: new Date(),
    };
  }

  // The generated templates always lead a section with a markdown heading (e.g. "## Installation",
  // "### Step 1: ...") — stripping the leading `#`s gives a short, human-readable topic string for
  // the question text. Falls back to a content excerpt for the rare heading-less first line.
  private extractTopic(content: string): string {
    const firstLine = content.split('\n').find((line) => line.trim().length > 0) ?? content;
    const cleaned = firstLine
      .replace(/^#+\s*/, '')
      .replace(/[`*]/g, '')
      .trim();
    return cleaned.length > 0 ? cleaned : content.trim().slice(0, 60);
  }

  private buildDocumentContent(
    category: DocumentCategory,
    minWords: number,
    maxWords: number,
  ): { title: string; content: string } {
    const template = this.buildTemplate(category);
    const content = this.assembleContent(template.header, template.nextSection, minWords, maxWords);

    return { title: template.title, content };
  }

  private buildTemplate(category: DocumentCategory): DocumentTemplate {
    switch (category) {
      case DocumentCategory.GUIDE:
        return this.buildGuideTemplate();
      case DocumentCategory.FAQ:
        return this.buildFaqTemplate();
      case DocumentCategory.DOCS:
        return this.buildDocsTemplate();
      case DocumentCategory.TUTORIAL:
        return this.buildTutorialTemplate();
      case DocumentCategory.CHANGELOG:
        return this.buildChangelogTemplate();
      default:
        return this.buildDocsTemplate();
    }
  }

  // Tech guide: prerequisites, CLI-driven installation, configuration block, troubleshooting.
  private buildGuideTemplate(): DocumentTemplate {
    const product = faker.commerce.productName();
    const cliName = product.toLowerCase().replace(/\s+/g, '-');
    const title = `${product} Installation Guide`;
    const header = [`# ${title}`, '', '## Overview', faker.lorem.paragraph(4)].join('\n');

    const sections = [
      () =>
        [
          '## Prerequisites',
          '',
          `- ${faker.hacker.noun()} version ${faker.system.semver()} or later`,
          `- Valid ${faker.hacker.noun()} access credentials`,
          '- A supported operating system',
        ].join('\n'),
      () =>
        [
          '## Installation',
          '',
          `1. Download the ${product} package`,
          `2. Run \`${cliName} install\``,
          `3. Verify the installation with \`${cliName} --version\``,
          '',
          faker.lorem.paragraph(2),
        ].join('\n'),
      () =>
        [
          '## Configuration',
          '',
          faker.lorem.paragraph(3),
          '',
          '```',
          `${faker.hacker.noun()}.${faker.hacker.noun()}=${faker.number.int({ min: 1, max: 9999 })}`,
          '```',
        ].join('\n'),
      () =>
        [`### ${faker.hacker.ingverb()} fails to start`, '', faker.lorem.paragraph(3)].join('\n'),
      () =>
        [`### Connection ${faker.hacker.noun()} errors`, '', faker.lorem.paragraph(2)].join('\n'),
    ];

    return { title, header, nextSection: (index) => sections[index % sections.length]() };
  }

  // FAQ: question/answer pairs as level-2 headings.
  private buildFaqTemplate(): DocumentTemplate {
    const product = faker.commerce.productName();
    const title = `${product} Frequently Asked Questions`;
    const header = [`# ${title}`, '', faker.lorem.paragraph(2)].join('\n');

    const questions = [
      () => `What is ${product}?`,
      () => `How much does ${product} cost?`,
      () => 'What is the refund policy?',
      () => `Is ${product} available for teams?`,
      () => 'How do I contact support?',
      () => `Does ${product} support ${faker.hacker.noun()} integration?`,
    ];

    return {
      title,
      header,
      nextSection: (index) =>
        `## ${questions[index % questions.length]()}\n\n${faker.lorem.paragraph(2)}`,
    };
  }

  // Product docs: feature list, API reference entries, architecture overview.
  private buildDocsTemplate(): DocumentTemplate {
    const product = faker.commerce.productName();
    const title = `${product} Documentation`;
    const header = [`# ${title}`, '', '## Overview', faker.lorem.paragraph(3)].join('\n');

    const sections = [
      () =>
        [
          '## Features',
          '',
          `- **${faker.hacker.noun()}**: ${faker.lorem.sentence()}`,
          `- **${faker.hacker.noun()}**: ${faker.lorem.sentence()}`,
          `- **${faker.hacker.noun()}**: ${faker.lorem.sentence()}`,
        ].join('\n'),
      () =>
        [
          '## API Reference',
          '',
          `### \`GET /api/${faker.hacker.noun()}\``,
          '',
          faker.lorem.paragraph(2),
        ].join('\n'),
      () => [`### \`POST /api/${faker.hacker.noun()}\``, '', faker.lorem.paragraph(2)].join('\n'),
      () => ['## Architecture', '', faker.lorem.paragraph(3)].join('\n'),
    ];

    return { title, header, nextSection: (index) => sections[index % sections.length]() };
  }

  // Tutorial: numbered step-by-step instructions.
  private buildTutorialTemplate(): DocumentTemplate {
    const product = faker.commerce.productName();
    const action = faker.hacker.ingverb();
    const title = `How to Set Up ${action} with ${product}`;
    const header = [`# ${title}`, '', '## Introduction', faker.lorem.paragraph(2)].join('\n');

    return {
      title,
      header,
      nextSection: (index) =>
        [
          `### Step ${index + 1}: ${faker.hacker.verb()} the ${faker.hacker.noun()}`,
          '',
          faker.lorem.paragraph(2),
        ].join('\n'),
    };
  }

  // Changelog: dated, semver-style version headers with Added/Fixed subsections.
  private buildChangelogTemplate(): DocumentTemplate {
    const product = faker.commerce.productName();
    const title = `${product} Changelog`;
    const header = `# ${title}`;

    return {
      title,
      header,
      nextSection: (index) => {
        const version = `${2 + Math.floor(index / 10)}.${index % 10}.${faker.number.int({ min: 0, max: 9 })}`;
        const date = faker.date.past({ years: 2 }).toISOString().slice(0, 10);
        return [
          `## [${version}] - ${date}`,
          '',
          '### Added',
          `- ${faker.lorem.sentence()}`,
          '',
          '### Fixed',
          `- ${faker.lorem.sentence()}`,
        ].join('\n');
      },
    };
  }

  // Appends generated sections until minWords is reached (bounded by a safety iteration cap in
  // case a template's sections are ever pathologically short), then falls back to a word-count
  // truncation if the last appended section pushed the total past maxWords.
  private assembleContent(
    header: string,
    nextSection: (index: number) => string,
    minWords: number,
    maxWords: number,
  ): string {
    let content = header;
    let words = this.countWords(content);
    let index = 0;

    while (words < minWords && index < MAX_SECTION_ITERATIONS) {
      content = `${content}\n\n${nextSection(index)}`;
      words = this.countWords(content);
      index++;
    }

    if (words > maxWords) {
      content = this.truncateToWordCount(content, maxWords);
    }

    return content;
  }

  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  private truncateToWordCount(text: string, maxWords: number): string {
    return text.trim().split(/\s+/).slice(0, maxWords).join(' ');
  }
}
