-- CreateTable
CREATE TABLE "qa_pairs" (
    "id" BIGSERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "sourceDocumentId" BIGINT NOT NULL,
    "complexity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qa_pairs_publicId_key" ON "qa_pairs"("publicId");

-- CreateIndex
CREATE INDEX "qa_pairs_sourceDocumentId_idx" ON "qa_pairs"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "qa_pairs_complexity_idx" ON "qa_pairs"("complexity");

-- AddForeignKey
ALTER TABLE "qa_pairs" ADD CONSTRAINT "qa_pairs_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
