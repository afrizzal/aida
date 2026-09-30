-- Phase 12.1 code review WR-01: the six composite state foreign keys refuse an update of the
-- referenced TicketState key instead of cascading it. With ON UPDATE CASCADE, one
-- UPDATE "TicketState" SET "organizationId" = X silently moved every ticket in that state, and the
-- configuration row that pointed at it, into organization X. Nothing in the product changes a
-- state's organization or id, so RESTRICT only removes that path. ON DELETE stays RESTRICT.
--
-- Generated with `prisma migrate dev --create-only` against a fresh database, then edited by hand:
-- Prisma's generated DROPs of the hand-written full-text objects (the "searchVector" columns of
-- Ticket and Message and their GIN indexes, from 20260701234808_ticket_search) were removed, as in
-- 11-01, 12-01 and 12.1-01. Every other hand-written object (CHECKs, triggers, partial unique
-- indexes) is untouched; the generated diff did not name them.

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_organizationId_stateId_fkey";

-- DropForeignKey
ALTER TABLE "TicketStateConfig" DROP CONSTRAINT "TicketStateConfig_organizationId_autoCloseStateId_fkey";

-- DropForeignKey
ALTER TABLE "TicketStateConfig" DROP CONSTRAINT "TicketStateConfig_organizationId_mergeCloseStateId_fkey";

-- DropForeignKey
ALTER TABLE "TicketStateConfig" DROP CONSTRAINT "TicketStateConfig_organizationId_newStateId_fkey";

-- DropForeignKey
ALTER TABLE "TicketStateConfig" DROP CONSTRAINT "TicketStateConfig_organizationId_reopenStateId_fkey";

-- DropForeignKey
ALTER TABLE "TicketStateConfig" DROP CONSTRAINT "TicketStateConfig_organizationId_resolveStateId_fkey";

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_organizationId_stateId_fkey" FOREIGN KEY ("organizationId", "stateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_newStateId_fkey" FOREIGN KEY ("organizationId", "newStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_reopenStateId_fkey" FOREIGN KEY ("organizationId", "reopenStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_resolveStateId_fkey" FOREIGN KEY ("organizationId", "resolveStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_autoCloseStateId_fkey" FOREIGN KEY ("organizationId", "autoCloseStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_mergeCloseStateId_fkey" FOREIGN KEY ("organizationId", "mergeCloseStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
