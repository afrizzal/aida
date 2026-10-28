# Phase 8.1 plans, deferred (Part B of the Phase 8 split)

These six plans are Phase 8.1 "Docker test tooling and runtime proofs":
- 08-14: container harness
- 08-15: `docs/SECURITY.md` reconciliation
- 08-16: full gate and evidence matrix
- 08-21: production-mode host E2E
- 08-22: real Caddy
- 08-23: root-owned volume and non-root backup

Phase 8 was split after Codex plan review cycle 4. The owner's decision of 2026-11-11, item 4, is in `../08-SPLIT.md` and `../08-REVIEWS.md` (Cycle 4).

They sit in this subfolder so `/gsd-execute-phase 8` does not run them. GSD reads plans only from the phase folder itself. The file names are unchanged so every cross-reference stays valid.

The plans carry the open HIGH findings R4-1 and R4-2 and two blockers: 0a2 (Docker VM space) and 08-o2 (`caddy:2` absent). They wait for an owner decision (queue row 08.1). When the owner decides, move them into their own phase folder and renumber them there.
