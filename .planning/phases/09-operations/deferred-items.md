# Phase 09 deferred items

Out-of-scope findings logged by plan executors. Not fixed by the plan that found them.

## From 09-08

- **Badge `destructive` variant in dark mode** (`src/components/ui/badge.tsx`): the variant adds `dark:bg-destructive/20`. axe measured 3.96:1 for 12px `text-destructive` on that tint over `--card` in dark mode (needs 4.5:1), found by `tests/e2e/backups-status.spec.ts` on the Backups "Failed" badge. The Backups page now passes the spec's `/10` tint in both themes (`dark:bg-destructive/10`). Other uses of the Badge `destructive` variant, if any, were not scanned. A fix at the variant (or the token) belongs to a design-system pass, not to this plan.

## From 09-09

- **The page still runs under the "No workspace found" fallback** (`src/app/(app)/layout.tsx`, `src/lib/session.ts:41`): for a signed-in user with no organization, the layout returns its fallback, but next dev still renders the route's page in parallel, so `/tickets` runs `TicketListPanel`, whose `getScopedDb()` throws "No active organization on session" and logs a server error with a digest. Seen in `tests/e2e/single-h1.spec.ts` (the no-workspace case): the browser gets only the fallback and no tenant data, because the throw happens before any query. This behaviour existed before 09-09 and is not caused by it. A quieter path (a page-level guard, or `getScopedDb` returning a typed "no workspace" result) is a separate change.

## From the Phase 9 code review, part c (fix batch F1)

Recorded unchanged from `09-REVIEW-c.md`; not fixed in F1 (F1 fixed c-CR-01, c-WR-01, c-WR-02, c-WR-03, c-IN-02 and c-IN-05).

- **c-IN-01:** the logo admin gate maps every throw (a Prisma connection error included) to a silent 401 `unauthorized`; only a redirect or a missing organization should be 401, anything else logged and 500 `failed`.
- **c-IN-03:** a replace whose commit outcome is ambiguous (the connection drops during COMMIT) discards the staged file that the committed setting may name; re-read the setting before discarding.
- **c-IN-04:** animated WebP (`VP8X` animation flag, `ANMF` frames) is accepted while APNG and GIF are refused; refuse it or document the exception.
- **c-IN-06:** the organization id in a valid status page's logo URL is accepted as is (orchestrator disposition); the review suggests one line in `docs/SECURITY.md` next to the logo cache note.
- **c-IN-07:** the Backups tab shows the instance-wide backup status to every workspace's admins; note it in D-04 and `docs/OPERATIONS.md`, or gate it on an instance-operator check once one exists.
- **c-IN-08:** the logo route handlers rely on SameSite=Lax only (no Origin check as server actions get); refuse a present `Origin` that differs from the app origin, or `Sec-Fetch-Site` other than `same-origin`, before the gate.

## From the Phase 9 code review, part d (fix batch F2)

Recorded unchanged from `09-REVIEW-d.md`; not fixed in F2 (F2 fixed d-CR-1, d-WR-1, d-WR-2 and d-WR-3; d-WR-4 is covered by the d-CR-1 test).

- **d-IN-1:** the `backup` service has none of `backup-init`'s hardening (no `cap_drop`, `no-new-privileges` or read-only root) and keeps full outbound network although it only talks to `db`.
- **d-IN-2:** `install.sh upgrade` overwrites local edits to shipped files (`Caddyfile`, `docker-compose.yml`) without notice and does not take the backup it recommends.
- **d-IN-3:** `backup-init` cannot repair a mode drift on a mount point already owned by 1000 (no `CAP_FOWNER`), so `docker compose up` fails on its dependency; skip `chmod` for a 1000-owned mount or print the documented fix.
- **d-IN-4:** the bind-mounted `scripts/backup` directory is empty when the install path is not shared with the Docker VM (Docker Desktop, Colima), and `backup` then restarts in a loop; add a troubleshooting line or fail early.
- **d-IN-5:** `backup.sh` exit code 1 is ambiguous: `docker compose run`'s own failures (1, 125 to 127) pass through as the run's code; map them to one documented code.

## From the Phase 9 code review, part b (fix batch F3)

Recorded unchanged from `09-REVIEW-b.md`; not fixed in F3 (F3 fixed b-WR-1, b-WR-2 and b-WR-5 under K143, b-WR-3, b-WR-4 under K144, and b-IN-1).

- **b-IN-2:** a lease lost (or a failed retention) after the publish rename reports a failed run although `<setId>` is complete in the backups volume; `on_lease_lost` could set `PUBLISHED=1` when the set directory exists and log that the set was published before the status. Since K143 such a run also writes a failed unrecorded record with no set id.
- **b-IN-3:** retention orders sets by name only, so a set dated by a fast clock is never pruned, and any directory with a valid name counts as a set even without a `manifest.json` naming it.
- **b-IN-4:** `tests/unit/file-delete-callers.test.ts` misses deletes through an alias (`const files = localFileStorage`, an inferred `deps.fileStore`, an aliased `unlink` import from `node:fs`).
- **b-IN-5:** the deleter requires a mount point plus the marker, the backup only the marker; the backup could also check `mountpoint -q` or the device of the uploads directory against its parent.
- **b-IN-6:** the window between `fence_open` and `lease_acquire` is covered only by verification; a `fence_alive` check right after `lease_acquire` would fail the run early with `file fence unavailable`.
