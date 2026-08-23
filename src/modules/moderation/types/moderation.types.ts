import type { ModerationAction } from '../constants/moderation-action.constant';
import type { ModerationDirection } from '../constants/moderation-direction.constant';

export interface ModerationOptions {
  userId?: string;
  requestId?: string;
  direction?: ModerationDirection;
  source?: string;
  action?: ModerationAction;
}

export interface ModerationResult {
  isFlagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
  flaggedCategories: string[];
  highestScore: { category: string; score: number };
}

// --- Moderation logs + stats query surface (AI-071) ---

export interface ModerationLogEntity {
  publicId: string;
  requestId: string | null;
  userId: string | null;
  direction: string;
  content: string;
  isFlagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
  action: string;
  source: string;
  createdAt: Date;
}

export interface QueryModerationLogsParams {
  userId?: string;
  isFlagged?: boolean;
  direction?: string;
  source?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedModerationLogsResult {
  data: ModerationLogEntity[];
  total: number;
  page: number;
  limit: number;
}

export interface ModerationStatsQueryParams {
  startDate?: string;
  endDate?: string;
}

export interface TopFlaggedCategory {
  category: string;
  count: number;
}

export interface ModerationStatsResult {
  totalChecks: number;
  flaggedCount: number;
  violationRate: number;
  byDirection: { input: number; output: number };
  topCategories: TopFlaggedCategory[];
}
