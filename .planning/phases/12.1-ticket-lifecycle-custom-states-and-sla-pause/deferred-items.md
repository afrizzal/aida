# Phase 12.1 deferred items

| Item | Source | Why deferred |
|------|--------|--------------|
| A breach or at-risk flag set before a pause stays after resume when a priority change or triage extended the deadlines during the pause, so the ticket can show "Overdue" with a deadline still ahead | Codex diff round 3, R3-D1 (`12.1-REVIEW.md`); run decision K47 | Flags stay one-directional and conservative. Correct reconciliation needs a marker column for "deadlines recomputed during this pause" (a migration); not changed after the last review round. |
