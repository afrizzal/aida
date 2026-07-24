-- CreateEnum
CREATE TYPE "InsightRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'INSIGHT_CLUSTER_LABELS';
ALTER TYPE "AuditActionType" ADD VALUE 'INSIGHT_SUMMARY';

-- NOTE: `searchVector` columns/GIN indexes on "Message"/"Ticket" are hand-managed
-- (never declared in schema.prisma, per 02-01/03-01/04-01/05-01 Pitfall 3) and must
-- survive this migration untouched. The generated diff spuriously proposed dropping
-- them (6th confirmed recurrence); those DROP statements were removed by hand during
-- 06-01's migration review.

-- NOTE: No pgvector index (hnsw/ivfflat) at v1 scale on "TicketEmbedding" — brute-force
-- KNN only; TicketEmbedding is bulk-read via JOIN, never KNN-queried. Mirrors KbChunk's
-- no-index decision (05-RESEARCH.md). Adding an index reopens prisma/prisma#28414
-- spurious-DROP-INDEX.

-- CreateTable
CREATE TABLE "InsightRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "InsightRunStatus" NOT NULL DEFAULT 'PENDING',
    "periodDays" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "params" JSONB NOT NULL,
    "clusters" JSONB,
    "kbGaps" JSONB,
    "volumeDrivers" JSONB,
    "slaCsat" JSONB,
    "narrative" JSONB,
    "ticketCount" INTEGER,
    "embeddingModel" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "InsightRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEmbedding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(768) NOT NULL,

    CONSTRAINT "TicketEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsatResponse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsatResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InsightRun_organizationId_periodDays_status_idx" ON "InsightRun"("organizationId", "periodDays", "status");

-- CreateIndex
CREATE INDEX "InsightRun_organizationId_idx" ON "InsightRun"("organizationId");

-- CreateIndex
CREATE INDEX "TicketEmbedding_organizationId_idx" ON "TicketEmbedding"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketEmbedding_ticketId_embeddingModel_key" ON "TicketEmbedding"("ticketId", "embeddingModel");

-- CreateIndex
CREATE UNIQUE INDEX "CsatResponse_ticketId_key" ON "CsatResponse"("ticketId");

-- CreateIndex
CREATE INDEX "CsatResponse_organizationId_idx" ON "CsatResponse"("organizationId");

-- AddForeignKey
ALTER TABLE "InsightRun" ADD CONSTRAINT "InsightRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEmbedding" ADD CONSTRAINT "TicketEmbedding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEmbedding" ADD CONSTRAINT "TicketEmbedding_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsatResponse" ADD CONSTRAINT "CsatResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsatResponse" ADD CONSTRAINT "CsatResponse_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
