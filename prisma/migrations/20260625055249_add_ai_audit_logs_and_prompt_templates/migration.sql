-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latency" INTEGER NOT NULL DEFAULT 0,
    "request" JSONB,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_cache" (
    "id" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embedding_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT,
    "model" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "userMessage" TEXT NOT NULL,
    "assistantResponse" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "estimatedCost" DOUBLE PRECISION NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION,
    "maxTokens" INTEGER,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "fewShotExamples" JSONB,
    "technique" TEXT NOT NULL,
    "recommendedModel" TEXT NOT NULL DEFAULT 'gpt-4o',
    "recommendedTemperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_model_idx" ON "audit_logs"("model");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_cache_textHash_key" ON "embedding_cache"("textHash");

-- CreateIndex
CREATE INDEX "embedding_cache_model_idx" ON "embedding_cache"("model");

-- CreateIndex
CREATE UNIQUE INDEX "ai_audit_logs_publicId_key" ON "ai_audit_logs"("publicId");

-- CreateIndex
CREATE INDEX "ai_audit_logs_userId_createdAt_idx" ON "ai_audit_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_audit_logs_model_createdAt_idx" ON "ai_audit_logs"("model", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_audit_logs_status_idx" ON "ai_audit_logs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_publicId_key" ON "prompt_templates"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_name_key" ON "prompt_templates"("name");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
