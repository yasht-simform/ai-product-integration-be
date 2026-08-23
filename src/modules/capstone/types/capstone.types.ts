import type { EvaluationResult } from '../../rag/types/rag.types';

export interface CapstoneSeedResult {
  documents: number;
  chunks: number;
  vectors: number;
  qaPairs: number;
  conversations: number;
  budgets: number;
  evaluation: EvaluationResult;
  summary: string;
}

export interface CapstoneResetResult {
  documentsDeleted: number;
  conversationsDeleted: number;
  budgetsDeleted: number;
  summary: string;
}

export interface CapstoneStatusResult {
  ready: boolean;
  documents: number;
  chunks: number;
  vectors: number;
  qaPairs: number;
  conversations: number;
  budgets: number;
  lastEvaluation: EvaluationResult | null;
}
