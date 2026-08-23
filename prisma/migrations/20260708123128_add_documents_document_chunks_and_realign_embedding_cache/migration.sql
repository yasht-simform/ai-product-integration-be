-- AlterTable
ALTER TABLE "embedding_cache" DROP CONSTRAINT "embedding_cache_pkey",
ADD COLUMN     "publicId" TEXT NOT NULL,
ADD COLUMN     "tokenCount" INTEGER,
DROP COLUMN "id",
ADD COLUMN     "id" BIGSERIAL NOT NULL,
ADD CONSTRAINT "embedding_cache_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "documents" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "originalFilename" TEXT,
    "fileSize" INTEGER,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "embeddingModel" TEXT NOT NULL,
    "embeddingStatus" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "documentId" BIGINT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "startChar" INTEGER NOT NULL,
    "endChar" INTEGER NOT NULL,
    "pineconeId" TEXT,
    "embeddingStatus" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_publicId_key" ON "documents"("publicId");

-- CreateIndex
CREATE INDEX "documents_category_idx" ON "documents"("category");

-- CreateIndex
CREATE INDEX "documents_embeddingStatus_idx" ON "documents"("embeddingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_publicId_key" ON "document_chunks"("publicId");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_chunkIndex_idx" ON "document_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_cache_publicId_key" ON "embedding_cache"("publicId");

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

