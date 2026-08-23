export interface BudgetEntity {
  publicId: string;
  userId: string;
  dailyLimitUsd: number | null;
  monthlyLimitUsd: number | null;
  alertThreshold: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedBudgetsResult {
  data: BudgetEntity[];
  total: number;
  page: number;
  limit: number;
}

export interface QueryBudgetsParams {
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  dailySpend: number;
  monthlySpend: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailyPercentage: number;
  monthlyPercentage: number;
  warning?: string;
}

export interface BudgetAlertDto {
  userId: string;
  dailySpend: number;
  monthlySpend: number;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailyPercentage: number;
  monthlyPercentage: number;
  triggeredBy: 'daily' | 'monthly' | 'both';
}

// --- Cost analytics (AI-067) — read-only aggregates over ai_audit_logs ---

export interface SpendByUserRow {
  userId: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
}

export interface SpendByUserResult {
  data: SpendByUserRow[];
  total: number;
  page: number;
  limit: number;
}

export interface SpendByModelRow {
  model: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
}

export interface SpendByModelResult {
  data: SpendByModelRow[];
}

export interface SpendByFeatureRow {
  feature: string;
  endpoint: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
}

export interface SpendByFeatureResult {
  data: SpendByFeatureRow[];
}

export interface SpendTimelinePoint {
  date: string; // YYYY-MM-DD (UTC)
  totalCost: number;
  totalTokens: number;
  callCount: number;
}

export interface SpendTimelineResult {
  data: SpendTimelinePoint[];
}

export interface ProjectedSpendResult {
  monthToDate: number;
  dailyAverage: number;
  daysElapsed: number;
  daysInMonth: number;
  projected: number;
}

// --- Data retention (AI-069) ---

export interface RetentionCategoryResult {
  deleted: number;
  failed: boolean;
  error?: string;
}

export interface RetentionReport {
  auditLogs: RetentionCategoryResult;
  moderationLogs: RetentionCategoryResult;
  archivedConversations: RetentionCategoryResult;
  embeddingCache: RetentionCategoryResult;
  totalDeleted: number;
  ranAt: Date;
  durationMs: number;
}

// --- Data retention runtime config + cron (AI-070) ---

// The effective retention settings: `cron` is read-only at runtime (schedule changes require a
// restart with a new RETENTION_CRON), the four day fields accept in-memory runtime overrides.
export interface RetentionRuntimeConfig {
  auditDays: number;
  moderationDays: number;
  archivedConversationDays: number;
  embeddingCacheDays: number;
  cron: string;
}

export type RetentionConfigOverrides = Partial<
  Pick<
    RetentionRuntimeConfig,
    'auditDays' | 'moderationDays' | 'archivedConversationDays' | 'embeddingCacheDays'
  >
>;

export interface RetentionRowsDue {
  auditLogs: number;
  moderationLogs: number;
  archivedConversations: number;
  embeddingCache: number;
}

export interface RetentionStatsResult {
  lastReport: RetentionReport | null;
  rowsDue: RetentionRowsDue;
}
