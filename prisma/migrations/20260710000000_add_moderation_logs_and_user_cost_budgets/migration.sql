-- CreateTable
CREATE TABLE "moderation_logs" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "requestId" TEXT,
    "userId" TEXT,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isFlagged" BOOLEAN NOT NULL,
    "categories" JSONB NOT NULL,
    "categoryScores" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cost_budgets" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyLimitUsd" DOUBLE PRECISION,
    "monthlyLimitUsd" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "alertThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_cost_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "moderation_logs_publicId_key" ON "moderation_logs"("publicId");

-- CreateIndex
CREATE INDEX "moderation_logs_userId_createdAt_idx" ON "moderation_logs"("userId", "createdAt" DESC);

-- CreateIndex
-- PARTIAL index: only flagged rows need coverage (violation-monitoring use case, spec §3.3).
-- Prisma's schema DSL declares this as a plain @@index([isFlagged]); the partial predicate is
-- applied here by hand, mirroring ai_audit_logs' status partial index (20260625055424).
CREATE INDEX "moderation_logs_isFlagged_idx" ON "moderation_logs"("isFlagged") WHERE "isFlagged" = true;

-- CreateIndex
CREATE UNIQUE INDEX "user_cost_budgets_publicId_key" ON "user_cost_budgets"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "user_cost_budgets_userId_key" ON "user_cost_budgets"("userId");
