-- Phase 12.2 (Ticket lifecycle: knowledge from resolved work), review a-IN-01: final KbProposal
-- rows (REJECTED, PUBLISHED, FAILED) keep their actor, time, failure and version columns. D-12
-- records human review actions only on these columns, never in AuditEvent, so the status fence of
-- 20261111100000_kb_proposals (which froze only title, body and article) is extended here. That
-- migration is final once applied and is not edited.
-- Generated with `prisma migrate dev --create-only --name kb_proposal_final_fence` against a fresh
-- scratch database (folder 20261109072721_kb_proposal_final_fence, renamed to
-- 20261112100000_kb_proposal_final_fence so that it sorts after 20261111100000_kb_proposals),
-- then edited by hand:
--   * the schema has no change, so the generated file held only Prisma's warning comment block
--     and the generated DROP INDEX of "Message_searchVector_idx" and "Ticket_searchVector_idx" and
--     DROP COLUMN of the "searchVector" columns of "Message" and "Ticket" (all four are
--     hand-written in 20260701234808_ticket_search and invisible to Prisma); all of it was
--     removed, as in 11-01, 12-01, 12.1-01 and 12.2-01;
--   * the generated diff named no other hand-written object, so nothing else was removed;
--   * added the hand-written function below the separator.
-- The trigger aida_kb_proposal_status_fence is unchanged: it already runs
-- aida_kb_proposal_status_immutable() BEFORE UPDATE on every row, and CREATE OR REPLACE keeps
-- that binding. The file holds no explicit transaction statement. This file is final once applied.

-- ---------------------------------------------------------------------------
-- Hand-written below (D-12, D-16; review a-IN-01). Keep in any later Prisma-generated migration.
-- ---------------------------------------------------------------------------

-- D-16: the status machine in the database. Allowed changes: GENERATING to DRAFT or FAILED (the
-- job), DRAFT to PUBLISHED or REJECTED (a reviewer). REJECTED, PUBLISHED and FAILED are final: no
-- status change out of them, and (review a-IN-01) no change of any column except updatedAt: the
-- content (title, body, published article), the actors (requester, last editor, reviewer,
-- publisher), every time column, the failure code, version, the generation epoch and the
-- truncation flag. A rejected proposal can never become PUBLISHED, even by a direct UPDATE. id and
-- organizationId are held by the composite foreign keys (ON UPDATE RESTRICT).
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
    OR OLD."version" IS DISTINCT FROM NEW."version"
    OR OLD."generationEpoch" IS DISTINCT FROM NEW."generationEpoch"
    OR OLD."inputTruncated" IS DISTINCT FROM NEW."inputTruncated"
    OR OLD."requestedByUserId" IS DISTINCT FROM NEW."requestedByUserId"
    OR OLD."generationQueuedAt" IS DISTINCT FROM NEW."generationQueuedAt"
    OR OLD."generationClaimedAt" IS DISTINCT FROM NEW."generationClaimedAt"
    OR OLD."generatedAt" IS DISTINCT FROM NEW."generatedAt"
    OR OLD."lastEditedByUserId" IS DISTINCT FROM NEW."lastEditedByUserId"
    OR OLD."lastEditedAt" IS DISTINCT FROM NEW."lastEditedAt"
    OR OLD."rejectedByUserId" IS DISTINCT FROM NEW."rejectedByUserId"
    OR OLD."rejectedAt" IS DISTINCT FROM NEW."rejectedAt"
    OR OLD."publishedByUserId" IS DISTINCT FROM NEW."publishedByUserId"
    OR OLD."publishedAt" IS DISTINCT FROM NEW."publishedAt"
    OR OLD."failureCode" IS DISTINCT FROM NEW."failureCode"
    OR OLD."failedAt" IS DISTINCT FROM NEW."failedAt"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  ) THEN
    RAISE EXCEPTION 'KbProposal is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
