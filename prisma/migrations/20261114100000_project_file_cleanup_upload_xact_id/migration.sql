-- K158 (Phase 9, Codex diff critique round 3, finding 3): the upload transaction id of a key queued
-- after an unknown commit outcome. One nullable column, no default, no data change.
-- `prisma migrate dev --create-only` also proposed dropping the "searchVector" generated columns
-- and their indexes on "Message" and "Ticket" (they are managed in raw SQL, not in schema.prisma);
-- those statements were removed by hand, as in the earlier migrations that keep them.

-- AlterTable
ALTER TABLE "ProjectFileCleanup" ADD COLUMN "uploadXactId" TEXT;
