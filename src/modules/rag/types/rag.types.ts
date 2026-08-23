export interface DocumentEntity {
  publicId: string;
  title: string;
  description: string | null;
  sourceType: string;
  originalFilename: string | null;
  fileSize: number | null;
  totalChunks: number;
  totalTokens: number;
  embeddingModel: string;
  embeddingStatus: string;
  category: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentChunkEntity {
  publicId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  startChar: number;
  endChar: number;
  embeddingStatus: string;
  createdAt: Date;
}

export interface DocumentWithChunks extends DocumentEntity {
  chunks: DocumentChunkEntity[];
}

export interface PaginatedDocumentsResult {
  data: DocumentEntity[];
  total: number;
  page: number;
  limit: number;
}

export interface ChunkDescriptor {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  startChar: number;
  endChar: number;
}

export interface IngestionStatusResult {
  embeddingStatus: string;
  totalChunks: number;
  totalTokens: number;
}

export interface PaginatedChunksResult {
  data: DocumentChunkEntity[];
  total: number;
  page: number;
  limit: number;
}

export interface SearchOptions {
  topK?: number;
  similarityThreshold?: number;
  categoryFilter?: string;
  documentIds?: string[];
}

export interface SearchResult {
  chunkPublicId: string;
  documentPublicId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  score: number;
  category: string | null;
}

export interface RagOptions {
  topK?: number;
  model?: string;
  temperature?: number;
  categoryFilter?: string;
  includeSourceChunks?: boolean;
}

export interface RagSource {
  documentTitle: string;
  documentPublicId: string;
  chunkContent: string;
  chunkIndex: number;
  similarityScore: number;
}

export interface RagResult {
  answer: string;
  model: string;
  sources: RagSource[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCost: number;
  latencyMs: number;
  chunksRetrieved: number;
  searchLatencyMs: number;
  generationLatencyMs: number;
}

export interface MockOptions {
  categories?: string[];
  minWords?: number;
  maxWords?: number;
}

export interface QaPairEntity {
  publicId: string;
  question: string;
  expectedAnswer: string;
  sourceDocumentId: string;
  complexity: string;
  createdAt: Date;
}

// Minimal shape MockDataService.evaluate() needs per pair — satisfied both by a persisted
// QaPair row (a structural superset) and by a caller-supplied EvaluateQaPairDto, so the same
// evaluation loop runs unmodified regardless of where the pairs came from.
export interface EvaluateQaPairInput {
  question: string;
  expectedAnswer: string;
  complexity: string;
}

export type EvaluationClassification =
  | 'correct'
  | 'partiallyCorrect'
  | 'incorrect'
  | 'appropriateIDK';

export interface EvaluationComplexityBreakdown {
  total: number;
  correct: number;
  accuracy: number;
}

export interface EvaluationResult {
  totalQuestions: number;
  correct: number;
  partiallyCorrect: number;
  incorrect: number;
  appropriateIDK: number;
  accuracy: number;
  avgLatencyMs: number;
  avgTokens: number;
  byComplexity: Record<string, EvaluationComplexityBreakdown>;
}

export interface PaginatedQaPairsResult {
  data: QaPairEntity[];
  total: number;
  page: number;
  limit: number;
}

export interface DocumentStatsResult {
  totalDocuments: number;
  totalChunks: number;
}
