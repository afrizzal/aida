# Phase 12.2 deferred items

| Item | Source | Why deferred |
|------|--------|--------------|
| A provider call that answered but whose answer could not be used (unparseable, schema failure), or that timed out, writes no `AuditEvent`; only calls that return output are audited | Codex plan review cycle 1, C8 (`12.2-REVIEWS.md`); run decision K49 | Same rule as drafted replies and triage today (`src/lib/rag/generate-draft.ts`, `src/lib/triage/run-triage.ts`). Auditing failed calls needs a structured failure from `complete()` carrying provider, model and the redacted prompt for every AI path; changing only proposals would make the audit log inconsistent. |
| Embedding after publish is sent after commit without a transactional outbox; a lost send leaves the article PENDING until an admin uses "Retry indexing" | Codex plan review cycle 1, C2; run decision K50 | The manual KB create path has the same shape (`src/lib/kb/create-article.ts`). The retry for PENDING articles is the visible recovery in this phase. |
