# Phase 4: AI Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 04-ai-foundation
**Areas discussed:** LLM Provider Configuration, Auto-Triage Behavior & Surfacing, Untrusted-Input Safeguards & Prompt-Injection Defense, Audit Log — Model & Visibility, AI Toggle gating (follow-up)

---

## LLM Provider Configuration

| Question | Options | Selected |
|---|---|---|
| Model selection UX | Curated dropdown + custom fallback / Plain free-text field / You decide | **Curated dropdown + custom fallback** |
| Provider scope | One active provider globally / Multiple configured, per-feature selection | **One active provider globally** |
| Ollama hosting | Base URL only, external Ollama / Bundle Ollama as optional compose service | **Base URL only, external Ollama** |
| Test Connection | Mirror email's Test Connection exactly / Skip for v1 | **Mirror email's Test Connection exactly** |

**Notes:** No follow-up questions requested; moved to next area.

---

## Auto-Triage Behavior & Surfacing

| Question | Options | Selected |
|---|---|---|
| Trigger | Creation only + manual re-run button / Creation only, no re-run | **Creation only + manual re-run button** |
| Category taxonomy | Fixed enum, predefined set / Free-text open vocabulary | **Fixed enum, predefined set** |
| Field auto-populate | Auto-set real fields, agent edits after / Separate AI-suggested chip + manual Apply | **Auto-set real fields, agent edits after** |
| Failure handling | pg-boss retry then visible failure badge / Silent, no indicator | **pg-boss retry then visible failure badge** |
| Category values (follow-up) | Billing/Technical/Account/General/Other / You decide | User free-text: **Billing, Technical, Account, Feature Request, Other** — rejected "General" as a second catch-all alongside "Other" (inconsistent LLM classification, dirty reporting data); "Feature Request" is a real recurring category in both support and ITSM contexts. |

**Notes:** User's category-taxonomy reasoning captured verbatim in CONTEXT.md D-08/specifics.

---

## Untrusted-Input Safeguards & Prompt-Injection Defense

| Question | Options | Selected |
|---|---|---|
| Prompt fencing | Structured delimiter tags + system instruction / Simple prefix warning | **Structured delimiter tags**, with a mandatory addition: escape/strip any literal closing-delimiter sequence found inside the ticket text before wrapping, to prevent tag-breakout (attacker closing the fence early and appending fake instructions). User's framing: "without this, structured delimiter is just decoration." |
| Redaction scope | Redact only what's sent to LLM + audit log / Also redact stored ticket text | **Redact only what's sent to LLM + audit log** |
| Automated injection test | Yes, automated integration test with injection fixture / Manual QA only | **Yes — automated integration test** |
| Redaction location | Baked into lib/llm provider port / Each feature calls redaction manually | **Baked into lib/llm provider port** |

**Notes:** The tag-breakout requirement (now D-12 in CONTEXT.md) is the single most safety-critical detail raised this session — flagged as non-discretionary.

---

## Audit Log — Model & Visibility

| Question | Options | Selected |
|---|---|---|
| Content stored | Full redacted input+output copy / Reference-only (ticket/message ID) | **Full redacted input + output stored in the row** |
| Append-only enforcement | Code convention only / DB-level rule or trigger | **DB-level enforcement** |
| Viewer UI | Minimal "AI Activity" section on ticket / DB-only, no UI | **Minimal viewer — "AI Activity" section on ticket** |

**Notes:** No further questions; user raised one additional follow-up (AI toggle gating, below) before finishing.

---

## AI Toggle Gating (user-raised follow-up)

**Context:** CLAUDE.md requires "AI must be fully toggleable off." The `aiEnabled` toggle already exists from Phase 1 (defaults off) — question was whether Phase 4 should gate turning it ON.

| Question | Options | Selected |
|---|---|---|
| Gate toggle on provider readiness? | Gated on Test Connection success / Independent, freely switchable | User proposed a **middle ground**: gate the Switch on provider **configuration existing** (disabled + "Configure a provider first" hint if none saved), but explicitly **do not** gate on the last Test Connection result — a persisted test result goes stale immediately (key revoked, Ollama down) and would be a false guarantee requiring extra state. Runtime failures remain handled by the earlier pg-boss-retry + failure-badge decision. Test Connection stays a manual verification tool, not a toggle prerequisite. |

---

## Claude's Discretion

- Sentiment scale and language-detection output format.
- `lib/llm` provider port's exact TypeScript interface/adapter shape.
- Curated model dropdown's exact model-ID list per provider.
- Postgres append-only enforcement's exact implementation (rule/trigger/REVOKE).
- "Re-run AI triage" button placement.
- "AI Activity" viewer's exact placement on the ticket detail page.

## Deferred Ideas

- Bundling Ollama as an optional compose service.
- Per-feature provider selection (different providers for triage vs. RAG vs. Insight).
- "AI-suggested chip + manual Apply" UI (more conservative alternative to auto-populate).
- KB/RAG/citations (Phase 5) and AIDA Insight (Phase 6) — out of Phase 4's domain boundary, not new ideas from this session but reconfirmed as out of scope.
