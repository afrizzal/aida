# Phase 8.1 plans, deferred (Part B of the Phase 8 split)

These seven plans are Phase 8.1 "Docker test tooling and runtime proofs":
- 08-05b: the `egress` CI job (plan 08-05's former Task 3, moved verbatim in 08-05 Revision 5). It carries the open HIGH finding R4-2: classification must come from the structured result of the whole suite, with mixed cases across files
- 08-14: container harness
- 08-15: `docs/SECURITY.md` reconciliation
- 08-16: full gate and evidence matrix
- 08-21: production-mode host E2E
- 08-22: real Caddy
- 08-23: root-owned volume and non-root backup

Phase 8 was split after Codex plan review cycle 4. The owner's decision of 2026-11-11, item 4, is in `../08-SPLIT.md` and `../08-REVIEWS.md` (Cycle 4).

They sit in this subfolder so `/gsd-execute-phase 8` does not run them. GSD reads plans only from the phase folder itself. The file names are unchanged so every cross-reference stays valid. 08-05b is new; its name keeps the link to plan 08-05.

The plans carry the open HIGH findings R4-1 and R4-2 and two blockers: 0a2 (Docker VM space) and 08-o2 (`caddy:2` absent). They wait for an owner decision (queue row 08.1). When the owner decides, move them into their own phase folder and renumber them there.
