-- CreateEnum
CREATE TYPE "KbEmbeddingStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'DRAFT_GENERATED';
ALTER TYPE "AuditActionType" ADD VALUE 'DRAFT_APPROVED';

-- NOTE: `searchVector` columns/GIN indexes on "Message"/"Ticket" are hand-managed
-- (never declared in schema.prisma, per 02-01/03-01/04-01 Pitfall 3) and must survive
-- this migration untouched. The generated diff spuriously proposed dropping them;
-- those DROP statements were removed by hand during 05-01's migration review.

-- NOTE: v1 uses brute-force KNN (`ORDER BY embedding <=> $1`) over "KbChunk" — no
-- vector index is created here on purpose (Decision 4 / 05-RESEARCH.md Pitfall 2).
-- If a future phase adds one, hand-add
--   CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)
-- to that migration and then hand-review every SUBSEQUENT migration touching
-- "KbChunk" for a spurious DROP INDEX (Prisma's diff engine doesn't understand
-- pgvector's HNSW/IVFFlat index types — prisma/prisma#28414).

-- CreateTable
CREATE TABLE "KbArticle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "embeddingStatus" "KbEmbeddingStatus" NOT NULL DEFAULT 'PENDING',
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbChunk" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "headingPath" TEXT,
    "content" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(768) NOT NULL,

    CONSTRAINT "KbChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbArticle_organizationId_idx" ON "KbArticle"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KbArticle_organizationId_slug_key" ON "KbArticle"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "KbChunk_organizationId_idx" ON "KbChunk"("organizationId");

-- CreateIndex
CREATE INDEX "KbChunk_articleId_idx" ON "KbChunk"("articleId");

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbChunk" ADD CONSTRAINT "KbChunk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbChunk" ADD CONSTRAINT "KbChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
