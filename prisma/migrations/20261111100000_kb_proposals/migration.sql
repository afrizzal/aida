-- Phase 12.2 (Ticket lifecycle: knowledge from resolved work): KB proposals. Enums
-- KbProposalStatus and KbProposalFailureCode, the AuditActionType value KB_PROPOSAL_GENERATED,
-- tables KbProposal and KbProposalSource, the composite-key targets Ticket_organizationId_id_key
-- and KbArticle_organizationId_id_key, and the nullable column AuditEvent.kbProposalId.
-- Generated with `prisma migrate dev --create-only --name kb_proposals` against a fresh database
-- (folder 20261109040846_kb_proposals, renamed to 20261111100000_kb_proposals), then edited by hand:
--   * removed Prisma's generated warning comment block (it named the two drops below);
--   * removed the generated DROP INDEX of "Message_searchVector_idx" and "Ticket_searchVector_idx"
--     and the generated DROP COLUMN of the "searchVector" columns of "Message" and "Ticket" (all
--     four are hand-written in 20260701234808_ticket_search and invisible to Prisma; removed as in
--     11-01, 12-01, 12.1-01 and the 12.1 follow-up);
--   * the generated diff named no other hand-written object (no SavedView partial index, no
--     Phase 12.1 trigger, function or partial index, no TicketRelation or Ticket CHECK), so
--     nothing else was removed or moved;
--   * kept every other generated statement unchanged; the new composite foreign keys use
--     ON DELETE RESTRICT ON UPDATE RESTRICT, the referential actions of Ticket.state;
--   * added the hand-written objects below the separator.
-- The new enum value KB_PROPOSAL_GENERATED is only added here, as its own statement, and used
-- nowhere else in this file (a new enum value cannot be used in the transaction that adds it).
-- The file holds no explicit transaction statement. This file is final once applied: no later
-- plan edits it.

-- CreateEnum
CREATE TYPE "KbProposalStatus" AS ENUM ('GENERATING', 'DRAFT', 'REJECTED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "KbProposalFailureCode" AS ENUM ('AI_OFF', 'SOURCE_CHANGED', 'PROVIDER', 'INVALID_OUTPUT', 'CONFIGURATION', 'REQUESTER_NOT_ALLOWED', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'KB_PROPOSAL_GENERATED';

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "kbProposalId" TEXT;

-- CreateTable
CREATE TABLE "KbProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "KbProposalStatus" NOT NULL DEFAULT 'GENERATING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "generationEpoch" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT,
    "bodyMarkdown" TEXT,
    "inputTruncated" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" "KbProposalFailureCode",
    "requestedByUserId" TEXT NOT NULL,
    "generationQueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generationClaimedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "lastEditedByUserId" TEXT,
    "lastEditedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "publishedArticleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbProposalSource" (
    "organizationId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "snapshotSeq" BIGINT,
    "citedSections" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbProposalSource_pkey" PRIMARY KEY ("proposalId","ticketId")
);

-- CreateIndex
CREATE UNIQUE INDEX "KbProposal_publishedArticleId_key" ON "KbProposal"("publishedArticleId");

-- CreateIndex
CREATE INDEX "KbProposal_organizationId_status_createdAt_idx" ON "KbProposal"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KbProposal_organizationId_id_key" ON "KbProposal"("organizationId", "id");

-- CreateIndex
CREATE INDEX "KbProposalSource_organizationId_ticketId_idx" ON "KbProposalSource"("organizationId", "ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "KbProposalSource_proposalId_position_key" ON "KbProposalSource"("proposalId", "position");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_kbProposalId_idx" ON "AuditEvent"("organizationId", "kbProposalId");

-- CreateIndex
CREATE UNIQUE INDEX "KbArticle_organizationId_id_key" ON "KbArticle"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_organizationId_id_key" ON "Ticket"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_kbProposalId_fkey" FOREIGN KEY ("organizationId", "kbProposalId") REFERENCES "KbProposal"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KbProposal" ADD CONSTRAINT "KbProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbProposal" ADD CONSTRAINT "KbProposal_organizationId_publishedArticleId_fkey" FOREIGN KEY ("organizationId", "publishedArticleId") REFERENCES "KbArticle"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KbProposalSource" ADD CONSTRAINT "KbProposalSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbProposalSource" ADD CONSTRAINT "KbProposalSource_organizationId_proposalId_fkey" FOREIGN KEY ("organizationId", "proposalId") REFERENCES "KbProposal"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KbProposalSource" ADD CONSTRAINT "KbProposalSource_organizationId_ticketId_fkey" FOREIGN KEY ("organizationId", "ticketId") REFERENCES "Ticket"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------
-- Hand-written below (D-03, D-04, D-12, D-16; reviews C5 and R2-3). Keep in any later
-- Prisma-generated migration.
-- ---------------------------------------------------------------------------

-- KbProposal integrity fences. They are integrity rules, not authorization: who may move a
-- proposal is decided by the server paths (D-01).
ALTER TABLE "KbProposal" ADD CONSTRAINT "KbProposal_version_check" CHECK ("version" >= 0);

-- Review R2-3: the generation epoch starts at 1 and only grows.
ALTER TABLE "KbProposal" ADD CONSTRAINT "KbProposal_generation_epoch_check" CHECK ("generationEpoch" >= 1);

-- char_length counts code points, the unit of proposal-schema.ts (plan 12.2-02).
ALTER TABLE "KbProposal" ADD CONSTRAINT "KbProposal_title_length_check"
  CHECK ("title" IS NULL OR char_length("title") BETWEEN 3 AND 120);

-- The columns each status requires (D-03, D-16): PUBLISHED exactly when the article, the publish
-- time and the publisher are set; FAILED exactly when a failure code is set; REJECTED exactly when
-- the rejection time and the reviewer are set; DRAFT, REJECTED and PUBLISHED rows have a title and
-- a body.
ALTER TABLE "KbProposal" ADD CONSTRAINT "KbProposal_status_fields_check" CHECK (
  (("status" = 'PUBLISHED') = ("publishedArticleId" IS NOT NULL))
  AND (("status" = 'PUBLISHED') = ("publishedAt" IS NOT NULL))
  AND (("status" = 'PUBLISHED') = ("publishedByUserId" IS NOT NULL))
  AND (("status" = 'FAILED') = ("failureCode" IS NOT NULL))
  AND (("status" = 'REJECTED') = ("rejectedAt" IS NOT NULL))
  AND (("status" = 'REJECTED') = ("rejectedByUserId" IS NOT NULL))
  AND (
    "status" NOT IN ('DRAFT', 'REJECTED', 'PUBLISHED')
    OR ("title" IS NOT NULL AND "bodyMarkdown" IS NOT NULL)
  )
);

-- D-07: one to five sources per proposal.
ALTER TABLE "KbProposalSource" ADD CONSTRAINT "KbProposalSource_position_check"
  CHECK ("position" BETWEEN 1 AND 5);

-- D-16: the status machine in the database. Allowed changes: GENERATING to DRAFT or FAILED (the
-- job), DRAFT to PUBLISHED or REJECTED (a reviewer). REJECTED, PUBLISHED and FAILED are final: no
-- status change out of them and no change of title, body or published article. A rejected
-- proposal can never become PUBLISHED, even by a direct UPDATE.
CREATE OR REPLACE FUNCTION aida_kb_proposal_status_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" IS DISTINCT FROM NEW."status" AND NOT (
    (OLD."status" = 'GENERATING' AND NEW."status" IN ('DRAFT', 'FAILED'))
    OR (OLD."status" = 'DRAFT' AND NEW."status" IN ('PUBLISHED', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION 'KbProposal status transition % -> % is not allowed', OLD."status", NEW."status";
  END IF;
  IF OLD."status" IN ('REJECTED', 'PUBLISHED', 'FAILED') AND (
    OLD."title" IS DISTINCT FROM NEW."title"
    OR OLD."bodyMarkdown" IS DISTINCT FROM NEW."bodyMarkdown"
    OR OLD."publishedArticleId" IS DISTINCT FROM NEW."publishedArticleId"
  ) THEN
    RAISE EXCEPTION 'KbProposal is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aida_kb_proposal_status_fence
  BEFORE UPDATE ON "KbProposal"
  FOR EACH ROW
  EXECUTE FUNCTION aida_kb_proposal_status_immutable();
