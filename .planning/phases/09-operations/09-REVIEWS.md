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
