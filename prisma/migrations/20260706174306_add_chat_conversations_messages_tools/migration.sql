-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT,
    "systemPrompt" TEXT,
    "model" TEXT NOT NULL,
    "userId" TEXT,
    "toolsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "conversationId" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "toolCalls" JSONB,
    "toolCallId" TEXT,
    "toolName" TEXT,
    "tokenCount" INTEGER,
    "cost" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_tools" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "handlerType" TEXT NOT NULL,
    "handlerConfig" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_tools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_publicId_key" ON "chat_conversations"("publicId");

-- CreateIndex
CREATE INDEX "chat_conversations_userId_updatedAt_idx" ON "chat_conversations"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_publicId_key" ON "chat_messages"("publicId");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_createdAt_idx" ON "chat_messages"("conversationId", "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "chat_tools_publicId_key" ON "chat_tools"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_tools_name_key" ON "chat_tools"("name");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
