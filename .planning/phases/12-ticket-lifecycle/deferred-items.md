# Phase 12 deferred items

| Item | Source | Why deferred |
|------|--------|--------------|
| Public status page brands with the first organization (`prisma.organization.findFirst()`), not the token's organization | Code review IN-05 (`12-REVIEW-b.md`) | Predates Phase 12 and follows the single-org v1 precedent of the public intake route. Fix together with multi-org public routes: return `organizationId` from `loadStatusPageData` and read branding with it. |
| Reopen markers on a merged source's public page sit under a CLOSED header | Code review IN-06 (`12-REVIEW-b.md`) | Copy decision for the visual pass (UI-SPEC Surface 7). Provenance is correct. |
| A merged source shows in assignee-based views as a plain CLOSED row, without a merged marker | Codex diff round 2, R2-3 (`12-REVIEW.md`) | Views already show closed tickets and nothing reopens. A marker on list rows is a copy and layout decision for the visual pass. |
| The outbound send job ends without sending or marking the message failed when the origin ticket is missing | Codex diff round 3, R3-2 (`12-REVIEW.md`) | `mergedFromTicketId` has no foreign key, but no application path deletes tickets (AIDA-53: no hard delete). Mark the message FAILED if hard delete is ever added. |
| No index serves the `mergedFromTicketId = origin` history read, and the job loads the whole thread before the 10-entry `References` cap | Codex diff round 3, R3-3 (`12-REVIEW.md`) | Needs a migration and a measured query plan on representative data; revisit with performance work. |
| The parent-chain lookup checks Message-IDs against the whole organization, so a reply tells its recipient which ids they supplied exist there | Review of fix pass F8, F8-IN-09 (`12-REVIEW-F6.md`) | Low value; ingest already reveals more. Narrow the lookup to the parent's ticket if it ever matters. |
