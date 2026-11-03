# Phase 8 split (owner decision 2026-11-11, item 4)

## Why

Codex plan review cycle 4, the only one the owner allowed, left two HIGH findings, R4-1 and R4-2 (`08-REVIEWS.md`, Cycle 4). Both sit in the Docker test tooling. The owner's instruction, verbatim, is in `run-loop/ANTREAN.md`, section "Keputusan owner 2026-11-11", item 4: "Jika masih ada HIGH: jangan review ke-5. Pecah Fase 8: upgrade dependensi, CSP, non-root, rate limit dulu; alat test Docker belakangan. Lapor ke owner."

## Part A: Phase 8 proper, executed first

| Area | Plans |
|---|---|
| Dependency upgrades (AIDA-25) | 08-01, 08-02, 08-03, 08-04, with the 08-19 guard (08-02 depends on it) |
| Supply chain (AIDA-26) | 08-05 Tasks 1 and 2: system fonts, CI telemetry opt-out, the `audit` workflow, Dependabot. Task 3 (the `egress` CI job) moves to Part B |
| Errors and gates (AIDA-31, AIDA-32) | 08-06 |
| CSP (AIDA-28) | 08-07, 08-08 (host E2E), 08-17 (E2E harness) |
| Non-root images (AIDA-27, AIDA-32) | 08-09. Its image builds end `blocked (space)` while the VM has 13.9 GiB free; its static checks and unit tests can pass |
| Client IP and rate limits (AIDA-29, AIDA-30) | 08-10, 08-11, 08-12, 08-13, 08-18, 08-20 |
| Part A gate | A new plan, 08-24 (below) |

No Part A plan depends on 08-14, 08-15, 08-16, 08-21, 08-22 or 08-23 (checked against each plan's `depends_on`).

**Part A gate (08-24):**
- Runs the host gates `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build` and `pnpm audit --prod`, plus `pnpm test:egress` recorded under 08-19's recording rule (`blocked (space)` while the VM is short). The 08-09 image checks are recorded the same way.
- Records each Part A acceptance item in a small evidence matrix derived mechanically from source lines. This is the 08-16 verifier idea, limited to Part A rows, with no container-suite rows; R4-1 does not apply.
- Marks every container-proof item as moved to Part B, never as passed.
- Is planned by the planner and checked by the plan checker. Because no fifth Codex cycle is allowed, the Codex diff critique at execution step 7 is the second opinion.

## Part B: Docker test tooling and runtime proofs, later

The Docker test tooling and runtime proofs:
- 08-14: the container harness on per-run `aida-test-` projects;
- 08-21: production-mode host E2E. It depends on 08-14 and 08-20;
- 08-22: real Caddy;
- 08-23: the root-owned volume procedure and non-root backup on the real stack;
- 08-15: `docs/SECURITY.md` reconciliation with the full evidence table;
- 08-16: the full gate, including the compose gate and the container rows;
- the 08-05 Task 3 `egress` CI job.

Part B carries the open HIGH findings R4-1 and R4-2, and the blockers 0a2 (VM space) and 08-o2 (`caddy:2`). Per the owner's instruction, it is reported to the owner and waits for an owner decision on how it proceeds (review budget, blockers). It is not executed by the run on its own initiative.

## Requirements

No requirement is dropped. AIDA-25, 26 and 31 can close in Part A. The parts of AIDA-27, 28, 29, 30 and 32 that are runtime container proofs stay open until Part B. `REQUIREMENTS.md` traceability records each requirement as split.

## Release safe point

The charter asks for the Phase 8 commit as the safe point for `v1.0.0`. Part A completes the dependency, CSP, non-root and rate-limit work, but not the container proofs. Whether Part A's commit is enough for `v1.0.0` is the owner's call. The report gives the Part A commit as a candidate, not as the safe point.

## Steps (orchestrator)

1. Move the Part B plans into a new phase directory, Phase 8.1 "Docker test tooling and runtime proofs", keeping their content and their review history. Update the ROADMAP and the `depends_on` references.
2. Split 08-05: Tasks 1 and 2 stay in 08-05; Task 3 becomes a Phase 8.1 plan.
3. Plan the Part A gate (08-24) with the planner and the plan checker.
4. Update ROADMAP, REQUIREMENTS traceability, STATE, ANTREAN and LAPORAN.
5. Execute Part A (`/gsd-execute-phase 8 --no-transition`) once the structure checks pass.

## Correction after verification (2026-11-12)

The Requirements section above says AIDA-25 can close in Part A. That is wrong. AIDA-25 accepts a red audit only if every remaining critical and high advisory is listed in `docs/SECURITY.md` with its ID, why it cannot be fixed and why it is not reachable. Plan 08-04 hands that list to 08-15, which is in Part B, and two of the ten residual advisories (nodemailer GHSA-prgh-xp8r-p3m5 and GHSA-v53p-9fqp-m79j) are reachable (`08-04-SUMMARY.md`, Production residuals). AIDA-25 stays open until the owner decides on nodemailer (queue item 08-o3) and 08-15 runs. AIDA-26 and AIDA-31 closed in Part A (`08-VERIFICATION.md`).
