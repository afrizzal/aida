# Phase 12 deferred items

| Item | Source | Why deferred |
|------|--------|--------------|
| Public status page brands with the first organization (`prisma.organization.findFirst()`), not the token's organization | Code review IN-05 (`12-REVIEW-b.md`) | Predates Phase 12 and follows the single-org v1 precedent of the public intake route. Fix together with multi-org public routes: return `organizationId` from `loadStatusPageData` and read branding with it. |
| Reopen markers on a merged source's public page sit under a CLOSED header | Code review IN-06 (`12-REVIEW-b.md`) | Copy decision for the visual pass (UI-SPEC Surface 7). Provenance is correct. |
| A QUEUED outbound reply moved by a merge is sent with the target's subject, number and thread headers | Codex diff round 1, D3 (`12-REVIEW.md`) | Run decision K36: the recipient is the same contact (merge refuses different contacts), and after a merge the conversation lives on the target. Revisit in the email pass if a customer-facing thread split matters. |
