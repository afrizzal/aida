-- Phase 11 (Inbox): SavedView and TicketAuditEvent.
-- Generated with `prisma migrate dev --create-only`, then edited by hand:
--   * removed the generated DROP of the "searchVector" columns and their GIN indexes on
--     "Ticket" and "Message" (hand-written in 20260701234808_ticket_search, invisible to Prisma);
--   * appended the partial unique name indexes, the CHECK constraints and the append-only
--     trigger at the end of this file. Prisma cannot express them; later generated
--     migrations must keep them.

-- CreateEnum
CREATE TYPE "SavedViewVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateEnum
CREATE TYPE "TicketAuditActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TicketAuditAction" AS ENUM ('ASSIGNEE_CHANGED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'TAG_ADDED', 'TAG_REMOVED', 'AUTO_CLOSED');

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "SavedViewVisibility" NOT NULL,
    "filters" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorType" "TicketAuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "action" "TicketAuditAction" NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_organizationId_visibility_position_idx" ON "SavedView"("organizationId", "visibility", "position");

-- CreateIndex
CREATE INDEX "SavedView_organizationId_ownerUserId_idx" ON "SavedView"("organizationId", "ownerUserId");

-- CreateIndex
CREATE INDEX "TicketAuditEvent_organizationId_ticketId_idx" ON "TicketAuditEvent"("organizationId", "ticketId");

-- CreateIndex
CREATE INDEX "TicketAuditEvent_organizationId_batchId_idx" ON "TicketAuditEvent"("organizationId", "batchId");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAuditEvent" ADD CONSTRAINT "TicketAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below (D-04, D-07). Keep in any later Prisma-generated migration.
-- ---------------------------------------------------------------------------

-- Saved view names compare case-insensitively (the service trims them): unique per owner
-- among PRIVATE views, unique per organization among SHARED views. One PRIVATE and one
-- SHARED view may share a name.
CREATE UNIQUE INDEX "SavedView_private_name_key"
  ON "SavedView" ("organizationId", "ownerUserId", lower("name"))
  WHERE "visibility" = 'PRIVATE';

CREATE UNIQUE INDEX "SavedView_shared_name_key"
  ON "SavedView" ("organizationId", lower("name"))
  WHERE "visibility" = 'SHARED';

ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 80);

-- SYSTEM actors carry no user id; USER actors always do.
ALTER TABLE "TicketAuditEvent" ADD CONSTRAINT "TicketAuditEvent_actor_check"
  CHECK (
    ("actorType" = 'SYSTEM' AND "actorUserId" IS NULL)
    OR ("actorType" = 'USER' AND "actorUserId" IS NOT NULL)
  );

-- TicketAuditEvent is append-only at the database level, the same pattern as AuditEvent
-- (aida_audit_event_immutable in 20260707053633_ai_foundation).
CREATE OR REPLACE FUNCTION aida_ticket_audit_event_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'TicketAuditEvent is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aida_ticket_audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "TicketAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION aida_ticket_audit_event_immutable();
