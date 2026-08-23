// Hardcoded fallback constant, mirroring CONTEXT_CONFIG/RAG_CONFIG's role — RetentionService
// should prefer reading the `retention` config namespace (src/config/app.config.ts) at call
// sites, falling back to this constant only where config isn't injected.
export const RETENTION_CONFIG = {
  auditLogRetentionDays: 90,
  moderationLogRetentionDays: 90,
  archivedConversationRetentionDays: 30,
  embeddingCacheRetentionDays: 180,
  cleanupCron: '0 2 * * *',
} as const;
