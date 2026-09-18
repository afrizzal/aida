-- Phase 12 (Ticket lifecycle): TicketRelation, merge and snooze columns, Message.seq, and six
-- new TicketAuditAction values.
-- Generated with `prisma migrate dev --create-only`, then edited by hand (D-19):
--   * removed the generated DROP INDEX of the GIN indexes on the generated FTS columns of
--     "Ticket" and "Message", and the generated DROP COLUMN of those two columns (all four are
--     hand-written in 20260701234808_ticket_search and invisible to Prisma);
--   * appended the pair index, the one-parent index and the two CHECK constraints at the end of
--     this file. Prisma cannot express them; later generated migrations must keep them.
-- Nothing below uses a new TicketAuditAction value: PostgreSQL cannot use a value added by
-- ALTER TYPE ... ADD VALUE before the migration transaction commits.
-- Message.seq is a BIGSERIAL: PostgreSQL draws it when the row is inserted, and the ADD COLUMN
-- numbers the existing rows. pg_get_serial_sequence('"Message"', 'seq') resolves to its sequence.

-- CreateEnum
CREATE TYPE "TicketRelationType" AS ENUM ('DUPLICATE_OF', 'RELATED_TO', 'CHILD_OF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketAuditAction" ADD VALUE 'RELATION_ADDED';
ALTER TYPE "TicketAuditAction" ADD VALUE 'RELATION_REMOVED';
ALTER TYPE "TicketAuditAction" ADD VALUE 'MERGED_INTO';
ALTER TYPE "TicketAuditAction" ADD VALUE 'MERGED_FROM';
ALTER TYPE "TicketAuditAction" ADD VALUE 'SNOOZED';
ALTER TYPE "TicketAuditAction" ADD VALUE 'WOKEN';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mergedFromTicketId" TEXT,
ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "mergeMessageSeq" BIGINT,
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoTicketId" TEXT,
ADD COLUMN     "snoozedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TicketRelation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "TicketRelationType" NOT NULL,
    "fromTicketId" TEXT NOT NULL,
    "toTicketId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketRelation_organizationId_fromTicketId_idx" ON "TicketRelation"("organizationId", "fromTicketId");

-- CreateIndex
CREATE INDEX "TicketRelation_organizationId_toTicketId_idx" ON "TicketRelation"("organizationId", "toTicketId");

-- CreateIndex
CREATE INDEX "Message_ticketId_seq_idx" ON "Message"("ticketId", "seq");

-- CreateIndex
CREATE INDEX "Ticket_snoozedUntil_idx" ON "Ticket"("snoozedUntil");

-- CreateIndex
CREATE INDEX "Ticket_organizationId_mergedIntoTicketId_idx" ON "Ticket"("organizationId", "mergedIntoTicketId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_mergedIntoTicketId_fkey" FOREIGN KEY ("mergedIntoTicketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRelation" ADD CONSTRAINT "TicketRelation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRelation" ADD CONSTRAINT "TicketRelation_fromTicketId_fkey" FOREIGN KEY ("fromTicketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketRelation" ADD CONSTRAINT "TicketRelation_toTicketId_fkey" FOREIGN KEY ("toTicketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below (D-03, D-05, D-08, D-09 amended). Keep in any later Prisma-generated
-- migration.
-- ---------------------------------------------------------------------------

-- One relation per unordered pair (D-03): A->B and B->A cannot both exist, and a pair cannot
-- carry two types at once.
CREATE UNIQUE INDEX "TicketRelation_pair_key"
  ON "TicketRelation" ("organizationId", LEAST("fromTicketId", "toTicketId"), GREATEST("fromTicketId", "toTicketId"));

-- No self-link (D-03).
ALTER TABLE "TicketRelation" ADD CONSTRAINT "TicketRelation_no_self_check"
  CHECK ("fromTicketId" <> "toTicketId");

-- A child has at most one parent: a database guard beside the advisory-locked check of D-05.
CREATE UNIQUE INDEX "TicketRelation_one_parent_key"
  ON "TicketRelation" ("organizationId", "fromTicketId")
  WHERE "type" = 'CHILD_OF';

-- Merge fields are all null or all set, and a ticket is never merged into itself (D-08, D-09).
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_merge_fields_check"
  CHECK (
    ("mergedIntoTicketId" IS NULL) = ("mergedAt" IS NULL)
    AND ("mergedIntoTicketId" IS NULL) = ("mergeMessageSeq" IS NULL)
    AND ("mergedIntoTicketId" IS NULL OR "mergedIntoTicketId" <> "id")
  );
