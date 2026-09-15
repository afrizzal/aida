# Phase 9: Operations — Plan Reviews

Reviews run under `run-loop/PIAGAM.md` step 5: Codex reads a `git archive` export of `HEAD` and gives opinions only. The orchestrator re-checked the factual claims before setting a disposition. The planner must carry every accepted item into the relevant PLAN.md, with a `## Review Dispositions Ledger` / `### Round 1 — <REVIEWS sha>` entry per changed plan.

## Codex

### Cycle 1

- Question: `run-loop/codex/fase09-plan-tanya.md` (commit `1954b75`); answer: `run-loop/codex/fase09-plan-jawab.md`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`.
- Codex verdict: not ready (7 HIGH, 5 MEDIUM). The 09-09 fault hook was judged sound: two gates, and no normal production path turns it on.

| ID | Severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| P1 | HIGH | 09-01 startup guard compares with `POSTGRES_PASSWORD`, which compose never passes to `migrate`, `app` or `worker`; the guard is inert in the real deployment | Verified: none of the three services has `POSTGRES_PASSWORD` in `docker-compose.yml` | accept |
| P2 | HIGH | The backup lease can expire while a slow backup still runs; no renewal, holder identity or fencing | Accepted as described (09-04, 09-06) | accept |
| P3 | HIGH | The deletion sweep runs in `worker`, which has no `uploads_data` mount, and `ENOENT` counts as success; `PendingFileDeletion` is classified as infrastructure, but the charter requires every new model to be org-scoped through `scopedDb` with a non-mocked isolation test | Verified: `worker` lacks the mount; charter "Aturan teknis AIDA" overrides CONTEXT D-15 for this model | accept |
| P4 | HIGH | Deferred deletion is not crash-durable (the queue row is written after the referencing commit); not every delete path (cascades, organization removal, failure after a file is stored) is inventoried | Accepted; Codex also states commit-then-lease ordering itself does not corrupt the dump | accept |
| P5 | HIGH | Restore checks `uploads.sha256` only after writing the target; it does not stop the backup scheduler | Accepted as described (09-10) | accept |
| P6 | HIGH | Status, retention and temp cleanup are not serialized against a following run; the "wrong PGDATABASE" test cannot record its status in that same database | Accepted as described (09-06) | accept |
| P7 | HIGH | The written-but-not-run stack tests do not follow R3-1…R3-3 operationally (race after preflight, ownership of resources, rendered image tags), and the second stack conflicts with the preflight that forbids any `aida` container | Accepted as described (09-11) | accept |
| P8 | MEDIUM | Stack-test isolation is not an execution gate (only a literal-script grep; no default-NotRun gate before Docker) | Accepted | accept |
| P9 | MEDIUM | A crash mid demo seed leaves a partial dataset that the demo-only classifier may skip; Better Auth writes are separate operations | Verified: `src/lib/demo/identities.ts` has 6 separate writes | accept |
| P10 | MEDIUM | Concurrent logo replaces can orphan a file; `immutable` caching keeps serving a removed logo | Accepted | accept (serialize per org; document or shorten caching) |
| P11 | MEDIUM | Backup component tests rely on assumptions that can fail (status write to an unreachable DB, `chmod 000` under root) | Accepted | accept |
| P12 | MEDIUM | The installer's download is not recorded in `docs/SECURITY.md` or covered by egress evidence | Accepted | accept |

### Required properties for the replan

- **P1:** `migrate`, `app` and `worker` receive the parts they need to validate the URL (password, user, database) through compose; the compose-config test checks they are present and runs the guard against the rendered environment, including a mismatch, without printing values.
- **P2:** the lease carries a holder id and is renewed while the backup runs; losing it aborts the run; ownership is re-checked before publishing; tests cover a run that outlives the TTL and a lease takeover. D-02's guarantee is not claimed before those tests pass.
- **P3:** the sweep runs where the uploads volume is mounted (mount it into `worker` or move the sweep), refuses to treat `ENOENT` as done unless the mount is verified; `PendingFileDeletion` is org-scoped through `scopedDb` with a non-mocked isolation test, and the cross-organization sweep is an explicit, documented system job (precedent: `sla-flag`).
- **P4:** the deletion record is written in the same transaction as the reference change (outbox), processed after commit; every delete and replace path is inventoried with a test, including crash before and after commit.
- **P5:** restore validates the manifest, every checksum and every archive entry (traversal, symlinks, hard links, special names, forged checksums) in an isolated staging area before touching the target, stops the scheduler and coordinates with a running backup, and verifies the mounts point at the real volumes.
- **P6:** publish, retention and status are serialized; a running run's temp directory is never removed; "status could not be recorded" is a defined, visible condition; overlapping runs and status failure are tested separately.
- **P7 and P8:** the stack tests follow R3-1…R3-3 (ID-scoped cleanup, re-check before every mutation, rendered image tags), the restore sequence is consistent with the single-`aida`-stack guard, and a default-NotRun gate stops them before any Docker call; tests prove that globs and the usual scripts never run them.
- **P9:** a completion marker plus idempotent recovery for the demo dataset; crash tests at each stage; refusal by both paths for a foreign organization and a foreign user.
- **P10:** logo replace is serialized per organization (row lock or compare-and-swap) with an interleaving test; the cache policy either documents that removal does not revoke cached copies or uses revalidation.
- **P11:** test failures use real causes that still allow the status write; permission tests run as a non-root user; "database unreachable" is its own test.
- **P12:** `docs/SECURITY.md` records the installer's single download; the fake-`curl` test covers every subcommand and fails on any other host.

### Cycle 2

- Question: `run-loop/codex/fase09-plan-r2-tanya.md` (commit `661c76b`); answer: `run-loop/codex/fase09-plan-r2-jawab.md`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`.
- Codex verdict: not ready (6 HIGH, 4 MEDIUM). P1, P8 and P10 confirmed incorporated; P2–P7, P9, P11 and P12 have gaps. Of the five deferrals, long-lived logo caching with documentation, lease loss as `unknown`, and stack tests waiting for the owner are accepted as grounded; the unsigned manifest is accepted as an integrity (not authenticity) limit; status-unrecorded may stay out of Settings but its evidence must not vanish on the next run.

| ID | Severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| Q1 | HIGH | The outbox trigger misses `storageKey` updates on `Attachment` and its INSERT omits `id`, while `Attachment.id` has no database default | Verified: `prisma/migrations/20260701234550_core_ticketing/migration.sql` line 142 `"id" TEXT NOT NULL`; 09-04 lists AFTER UPDATE only for the logo setting | accept |
| Q2 | HIGH | Lease check then unlink, and ownership check then rename/retention/status, are not atomic fencing | Accepted as described (09-04 Task 2, 09-06 Task 1) | accept |
| Q3 | HIGH | Restore takes the lease without renewal, drops the lease carried in the dump, and its holder id is not unique | Accepted as described (09-10 Tasks 1–2) | accept |
| Q4 | HIGH | The root marker `.aida-uploads-volume` is archived by backup but rejected by the restore validator's member rule | Accepted as described; 09-10 does not name the marker | accept |
| Q5 | HIGH | Stack guard: labels not set on every resource, ownership not proven for IDs gathered after `up`, and `scripts/restore.sh` runs Docker outside `mutate()` | Accepted as described (09-11) | accept |
| Q6 | HIGH | The charter requires new egress in both `docs/SECURITY.md` and `tests/integration/egress-isolation.test.ts`; 09-10 covers only the docs | Verified: 09-10 never references the egress test | accept |
| Q7 | MEDIUM | The volume marker does not prove the right volume is mounted | Accepted | accept |
| Q8 | MEDIUM | Backup failure evidence is inconsistent (order, holder file before directory, per-case assertions, status file on a read-only volume, marker removed by the next run) | Accepted | accept |
| Q9 | MEDIUM | Demo recovery does not inventory the writes inside `createFirstOrgAndAdmin` (user created, organization or membership missing) | Accepted; feasibility unverified | accept |
| Q10 | MEDIUM | The trigger migration is edited after `prisma migrate dev` applied it | Accepted; generate with `--create-only`, edit, then apply on a clean disposable database | accept |

### Required properties for the replan (cycle 2)

- **Q1:** trigger rows get an id the database supplies (or the trigger supplies), `AFTER UPDATE OF "storageKey"` is covered, and each operation is tested on commit and on rollback.
- **Q2 and Q3:** one mutual-exclusion protocol that covers the file action together with lease acquisition (for example the backup and the deletion path take the same transaction-scoped advisory lock around check and action, or a fencing token enforced at the mutation); restore uses its own lock that survives the database replacement, with a random holder id, renewal and release on every path; tests interleave exactly after the check, during long pauses, with a manual backup and with two restores.
- **Q4:** the marker is excluded from the archive and recreated safely after restore, or explicitly allowed by the validator, proven by a real round trip.
- **Q5:** every stack resource carries the run label from the overlay; only resources proven created by the run are recorded; `scripts/restore.sh` runs through the same guard (or the stack test calls a guarded wrapper); a fake test covers a partial `up` and a foreign resource appearing at the mutation boundary.
- **Q6:** installer download evidence is added to `tests/integration/egress-isolation.test.ts` in a way that suite can run, besides `docs/SECURITY.md`.
- **Q7:** mount identity is verified (expected volume, not just a marker), with a test where a local directory already holds a marker.
- **Q8:** one order for publish, status and retention, one assertion set per test case, a fallback channel visible when both the database and the status volume cannot be written, and the record of a missed status kept (history or reconciliation) instead of deleted.
- **Q9:** every write inside `createFirstOrgAndAdmin` is inventoried, each partial state has a defined recovery, and a crash is injected between each pair.
- **Q10:** the migration is created with `prisma migrate dev --create-only`, edited, then applied and verified on a clean disposable database.

### Cycle 3 (last)

- Question: `run-loop/codex/fase09-plan-r3-tanya.md`; answer: `run-loop/codex/fase09-plan-r3-jawab.md`. Log: `model: gpt-6.1-terra`, `reasoning effort: xhigh`.
- Codex verdict: not ready; 1 HIGH, 4 MEDIUM, 1 LOW; "the phase must be parked".

| ID | Severity | Finding (short) | Orchestrator check | Disposition |
|---|---|---|---|---|
| R1 | HIGH | `recoverDemoPartial()` deletes demo organizations and users that lack the new completion marker, on both the seed CLI and the demo boot path; AIDA-37 requires the seed to refuse before any write when tenant data exists and the boot to skip a demo-only database; a legitimate demo dataset created before the marker existed would be deleted | Verified: 09-02 lines 96 and 114 use the recovery on both paths | accept |
| R2 | MEDIUM | The advisory-lock fence does not stop a file action if the lock holder's database session drops mid-action (Q2 partial) | Accepted | accept |
| R3 | MEDIUM | `uploads:volume-id` is undefined before the first upload, so an empty backup and restore round trip has no complete contract | Accepted | accept |
| R4 | MEDIUM | 09-06 Task 3 still has a blanket "for each" assertion that contradicts the success cases (Q8 partial) | Accepted | accept |
| R5 | MEDIUM | The Docker shim still has a check-to-mutation window inside one call (Q5 partial); not a parking reason while the suite stays unrun | Accepted | accept |
| R6 | LOW | 09-04 acceptance still asks for a removed container name although the task now drops a database | Accepted | accept |

### Outcome

The third and last review cycle ended with one HIGH finding (R1). Under `run-loop/PIAGAM.md` → Titik keputusan, **Phase 9 is parked** (run-loop decision K25, same rule as K24 for Phase 8). The findings are accepted and recorded but not incorporated; no Phase 9 code was executed. Unparking is the owner's decision (`run-loop/LAPORAN.md`).
