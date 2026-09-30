-- Phase 12.1 (Ticket lifecycle: custom states and SLA pause): TicketStateGroup, TicketState,
-- TicketStateConfig, Ticket.stateId, Ticket.slaPausedAt and Ticket.slaPausedMs; every ticket and
-- every saved view moved onto state ids; the TicketStatus enum, its column and its index removed.
-- Generated with `prisma migrate dev --create-only` against a fresh database, then edited by hand
-- (D-08):
--   * removed the generated DROP INDEX of "Ticket_searchVector_idx" and "Message_searchVector_idx"
--     and the generated DROP COLUMN of the two generated FTS columns of "Ticket" and "Message"
--     (all four are hand-written in 20260701234808_ticket_search and invisible to Prisma);
--   * split the generated ALTER TABLE "Ticket": the new columns are added first with "stateId"
--     nullable (Prisma generates it NOT NULL in one step, which fails on a populated table); the
--     NOT NULL, the new index and every foreign key are added in step 9, after the data moved;
--   * moved the generated DROP INDEX "Ticket_organizationId_status_idx", DROP COLUMN "status" and
--     DROP TYPE "TicketStatus" to the end (step 11), after the data moved off the enum;
--   * kept the generated CREATE TYPE, CREATE TABLE, CREATE INDEX and ADD FOREIGN KEY statements
--     unchanged (the composite foreign keys keep Prisma's ON DELETE RESTRICT ON UPDATE CASCADE);
--   * added the hand-written objects below the separator (steps 2, 3, 4, 6, 7, 8 and 10).
-- Atomicity: the file holds no explicit transaction statement. It is sent as one script; whether
-- a RAISE inside it rolls every earlier statement back is not assumed here but tested on two
-- paths by plan 12.1-03, both on a populated pre-12.1 database with a malformed saved view: the
-- one-query harness path in tests/integration/ticket-states-migration.test.ts and the real
-- `pnpm prisma migrate deploy` path in tests/integration/ticket-states-deploy.test.ts.
-- This file is final once applied: no later plan edits it (its checksum is recorded by every
-- database it ran on); a partial change found by the deploy test is a blocker for a replan.
-- "group" is a reserved word and is quoted everywhere.

-- 1. CreateEnum
CREATE TYPE "TicketStateGroup" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "TicketState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorToken" TEXT NOT NULL,
    "group" "TicketStateGroup" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "legacyStatus" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStateConfig" (
    "organizationId" TEXT NOT NULL,
    "newStateId" TEXT NOT NULL,
    "reopenStateId" TEXT NOT NULL,
    "resolveStateId" TEXT NOT NULL,
    "autoCloseStateId" TEXT NOT NULL,
    "mergeCloseStateId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketStateConfig_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE INDEX "TicketState_organizationId_group_sortOrder_idx" ON "TicketState"("organizationId", "group", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TicketState_organizationId_id_key" ON "TicketState"("organizationId", "id");

-- ---------------------------------------------------------------------------
-- Hand-written below (D-03, D-05, D-07 amended, D-08, D-09, D-16). Keep in any later
-- Prisma-generated migration.
-- ---------------------------------------------------------------------------

-- 2. TicketState rules (D-03 amended, K42). Names are trimmed and 1 to 40 characters; colour keys
-- are the UI-SPEC palette keys; legacyStatus is one of the five old enum keys or null.
ALTER TABLE "TicketState" ADD CONSTRAINT "TicketState_name_check"
  CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 40);

ALTER TABLE "TicketState" ADD CONSTRAINT "TicketState_color_token_check"
  CHECK ("colorToken" IN (
    'indigo-filled', 'indigo', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink',
    'purple', 'gray'
  ));

ALTER TABLE "TicketState" ADD CONSTRAINT "TicketState_legacy_status_check"
  CHECK ("legacyStatus" IS NULL OR "legacyStatus" IN ('NEW', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED'));

-- Active state names are unique per organization, case-insensitively; a soft-deleted state's name
-- can be reused.
CREATE UNIQUE INDEX "TicketState_active_name_key"
  ON "TicketState" ("organizationId", lower("name"))
  WHERE "deletedAt" IS NULL;

-- At most one state per organization carries each legacy key (old URL mapping, D-09).
CREATE UNIQUE INDEX "TicketState_legacy_status_key"
  ON "TicketState" ("organizationId", "legacyStatus")
  WHERE "legacyStatus" IS NOT NULL;

-- 3. The five default states and the configuration row of one organization (D-05, D-08).
-- Idempotent: an organization that already has its configuration row gets nothing.
CREATE OR REPLACE FUNCTION aida_seed_ticket_states(org_id text)
RETURNS void AS $$
DECLARE
  new_id text := gen_random_uuid()::text;
  open_id text := gen_random_uuid()::text;
  pending_id text := gen_random_uuid()::text;
  resolved_id text := gen_random_uuid()::text;
  closed_id text := gen_random_uuid()::text;
BEGIN
  IF EXISTS (SELECT 1 FROM "TicketStateConfig" WHERE "organizationId" = org_id) THEN
    RETURN;
  END IF;

  INSERT INTO "TicketState"
    ("id", "organizationId", "name", "colorToken", "group", "sortOrder", "legacyStatus",
     "createdAt", "updatedAt")
  VALUES
    (new_id, org_id, 'New', 'indigo-filled', 'OPEN', 0, 'NEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (open_id, org_id, 'Open', 'indigo', 'OPEN', 1, 'OPEN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (pending_id, org_id, 'Pending', 'amber', 'PENDING', 2, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (resolved_id, org_id, 'Resolved', 'green', 'RESOLVED', 3, 'RESOLVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (closed_id, org_id, 'Closed', 'gray', 'CLOSED', 4, 'CLOSED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  -- updatedAt is written here: Prisma's @updatedAt has no database default.
  INSERT INTO "TicketStateConfig"
    ("organizationId", "newStateId", "reopenStateId", "resolveStateId", "autoCloseStateId",
     "mergeCloseStateId", "updatedAt")
  VALUES (org_id, new_id, open_id, resolved_id, closed_id, closed_id, CURRENT_TIMESTAMP);
END;
$$ LANGUAGE plpgsql;

-- 4. Backfill every existing organization, including organizations without tickets (D-08).
DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT "id" FROM "organization" ORDER BY "id" LOOP
    PERFORM aida_seed_ticket_states(org."id");
  END LOOP;
END;
$$;

-- 5. New Ticket columns (generated, split): stateId stays nullable until step 9.
ALTER TABLE "Ticket" ADD COLUMN "stateId" TEXT,
ADD COLUMN     "slaPausedAt" TIMESTAMPTZ(3),
ADD COLUMN     "slaPausedMs" BIGINT NOT NULL DEFAULT 0;

-- 6. Each ticket moves to the state of its own organization with the same legacy key (NEW and
-- OPEN stay two states).
UPDATE "Ticket" t
SET "stateId" = s."id"
FROM "TicketState" s
WHERE s."organizationId" = t."organizationId"
  AND s."legacyStatus" = t."status"::text;

DO $$
DECLARE
  missing text;
BEGIN
  SELECT "id" INTO missing FROM "Ticket" WHERE "stateId" IS NULL ORDER BY "id" LIMIT 1;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Ticket % has no matching TicketState', missing;
  END IF;
END;
$$;

-- 7. Tickets pending at migration time start their SLA pause now (the migration transaction
-- time); no deadline changes (D-08, D-16).
UPDATE "Ticket"
SET "slaPausedAt" = date_trunc('milliseconds', now())
WHERE "status" = 'PENDING';

-- 8. Saved views version 1 become version 2 (D-09): statuses become the ids of the view
-- organization's states with those legacy keys, in code-unit order; every other key is kept.
-- Malformed filters or an unknown status value fail the migration with the view id.
-- "Malformed" is anything the version 1 grammar refused (storedViewFiltersSchema before this
-- migration, a strict object): only the keys version, view, statuses, tagId, cf, q, snoozed;
-- version 1; view one of all, unassigned, mine; statuses an array of unique status strings;
-- tagId a string of 1 to 64 UTF-16 code units; cf an object with exactly definitionId (1 to 64)
-- and value (0 to 200); q a string of 1 to 200; snoozed only true. Every key but version is
-- optional and JSON null is never valid.
DO $$
DECLARE
  v record;
  f jsonb;
  cf jsonb;
  statuses jsonb;
  state_ids jsonb;
BEGIN
  FOR v IN SELECT "id", "organizationId", "filters" FROM "SavedView" ORDER BY "id" LOOP
    f := v."filters";
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'SavedView % has malformed filters', v."id";
    END IF;

    cf := f -> 'cf';
    IF (f -> 'version') IS DISTINCT FROM '1'::jsonb
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(f) AS k(key)
         WHERE k.key NOT IN ('version', 'view', 'statuses', 'tagId', 'cf', 'q', 'snoozed')
       )
       OR (f ? 'view' AND (f -> 'view') NOT IN ('"all"'::jsonb, '"unassigned"'::jsonb, '"mine"'::jsonb))
       OR (f ? 'snoozed' AND (f -> 'snoozed') IS DISTINCT FROM 'true'::jsonb)
       OR (cf IS NOT NULL AND jsonb_typeof(cf) IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'SavedView % has malformed filters', v."id";
    END IF;
    -- A separate statement: SQL does not promise to short-circuit OR, and jsonb_object_keys
    -- raises on a non-object.
    IF cf IS NOT NULL
       AND (SELECT array_agg(k.key ORDER BY k.key COLLATE "C") FROM jsonb_object_keys(cf) AS k(key))
           IS DISTINCT FROM ARRAY['definitionId', 'value']::text[] THEN
      RAISE EXCEPTION 'SavedView % has malformed filters', v."id";
    END IF;

    -- String lengths in UTF-16 code units, as zod counts them: code points above U+FFFF count 2.
    IF EXISTS (
      SELECT 1
      FROM (VALUES (f -> 'tagId', 1, 64),
                   (f -> 'cf' -> 'definitionId', 1, 64),
                   (f -> 'cf' -> 'value', 0, 200),
                   (f -> 'q', 1, 200)) AS t(value, min_units, max_units)
      WHERE t.value IS NOT NULL
        AND (jsonb_typeof(t.value) IS DISTINCT FROM 'string'
             OR (char_length(t.value #>> '{}')
                 + (SELECT count(*) FROM regexp_split_to_table(t.value #>> '{}', '') AS c(ch)
                    WHERE ascii(c.ch) > 65535))
                NOT BETWEEN t.min_units AND t.max_units)
    ) THEN
      RAISE EXCEPTION 'SavedView % has malformed filters', v."id";
    END IF;

    statuses := COALESCE(f -> 'statuses', '[]'::jsonb);
    IF jsonb_typeof(statuses) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'SavedView % has malformed filters', v."id";
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(statuses) AS e(value)
      WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string'
         OR (e.value #>> '{}') NOT IN ('NEW', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED')
    ) THEN
      RAISE EXCEPTION 'SavedView % has an unknown status value', v."id";
    END IF;
    IF jsonb_array_length(statuses)
       <> (SELECT count(DISTINCT e.value) FROM jsonb_array_elements(statuses) AS e(value)) THEN
      RAISE EXCEPTION 'SavedView % has malformed filters', v."id";
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(s."id") ORDER BY s."id" COLLATE "C"), '[]'::jsonb)
    INTO state_ids
    FROM "TicketState" s
    WHERE s."organizationId" = v."organizationId"
      AND s."legacyStatus" IN (SELECT e.value #>> '{}' FROM jsonb_array_elements(statuses) AS e(value));

    UPDATE "SavedView"
    SET "filters" = (v."filters" - 'statuses' - 'version')
                    || jsonb_build_object('version', 2, 'stateIds', state_ids)
    WHERE "id" = v."id";
  END LOOP;
END;
$$;

-- 9. Constraints after the data moved (generated statements, moved here).
ALTER TABLE "Ticket" ALTER COLUMN "stateId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Ticket_organizationId_stateId_idx" ON "Ticket"("organizationId", "stateId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_organizationId_stateId_fkey" FOREIGN KEY ("organizationId", "stateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketState" ADD CONSTRAINT "TicketState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_newStateId_fkey" FOREIGN KEY ("organizationId", "newStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_reopenStateId_fkey" FOREIGN KEY ("organizationId", "reopenStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_resolveStateId_fkey" FOREIGN KEY ("organizationId", "resolveStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_autoCloseStateId_fkey" FOREIGN KEY ("organizationId", "autoCloseStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStateConfig" ADD CONSTRAINT "TicketStateConfig_organizationId_mergeCloseStateId_fkey" FOREIGN KEY ("organizationId", "mergeCloseStateId") REFERENCES "TicketState"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 10. The pause sum is never negative (D-16).
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_sla_paused_ms_check" CHECK ("slaPausedMs" >= 0);

-- Every organization inserted from now on gets its five states and configuration in the same
-- transaction, whatever creates it (setup action, bootstrap, demo, SQL, test fixtures; D-07
-- amended, K43).
CREATE OR REPLACE FUNCTION aida_organization_seed_ticket_states()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM aida_seed_ticket_states(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aida_organization_ticket_states
  AFTER INSERT ON "organization"
  FOR EACH ROW EXECUTE FUNCTION aida_organization_seed_ticket_states();

-- A state's group never changes after creation (D-03): the service has no update path for it,
-- and this trigger is the second fence.
CREATE OR REPLACE FUNCTION aida_ticket_state_group_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'TicketState.group cannot change';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aida_ticket_state_group_fixed
  BEFORE UPDATE OF "group" ON "TicketState"
  FOR EACH ROW
  WHEN (OLD."group" IS DISTINCT FROM NEW."group")
  EXECUTE FUNCTION aida_ticket_state_group_immutable();

-- 11. The old status enum, its index and its column go last (generated statements, moved here).
-- DropIndex
DROP INDEX "Ticket_organizationId_status_idx";

-- AlterTable
ALTER TABLE "Ticket" DROP COLUMN "status";

-- DropEnum
DROP TYPE "TicketStatus";
