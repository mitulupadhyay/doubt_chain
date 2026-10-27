-- Phase 4: semantic search index + AI assistant audit trail.
-- Purely additive: two new tables, their indexes and foreign keys.

-- CreateTable
CREATE TABLE "DoubtEmbedding" (
    "id" TEXT NOT NULL,
    "doubtId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoubtEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "grounded" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "latencyMs" INTEGER,
    "sources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "doubtId" TEXT,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoubtEmbedding_doubtId_key" ON "DoubtEmbedding"("doubtId");

-- CreateIndex
CREATE INDEX "DoubtEmbedding_model_idx" ON "DoubtEmbedding"("model");

-- CreateIndex
CREATE INDEX "DoubtEmbedding_provider_idx" ON "DoubtEmbedding"("provider");

-- CreateIndex (approximate nearest-neighbour index for cosine distance; pgvector >= 0.5)
CREATE INDEX "DoubtEmbedding_embedding_hnsw_idx" ON "DoubtEmbedding" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE INDEX "AiInteraction_userId_createdAt_idx" ON "AiInteraction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_createdAt_idx" ON "AiInteraction"("createdAt");

-- AddForeignKey
ALTER TABLE "DoubtEmbedding" ADD CONSTRAINT "DoubtEmbedding_doubtId_fkey" FOREIGN KEY ("doubtId") REFERENCES "Doubt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
