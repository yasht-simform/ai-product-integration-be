-- Drop the regular status index and replace with a partial index.
-- Only non-SUCCESS rows need index coverage (error monitoring use case).
DROP INDEX IF EXISTS "ai_audit_logs_status_idx";

CREATE INDEX "ai_audit_logs_status_idx" ON "ai_audit_logs"("status") WHERE status != 'SUCCESS';