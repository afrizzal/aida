# AIDA — Architecture (reference)

*High-level reference; phase plans refine specifics. Single server, minimal moving parts.*

## Topology (one `docker compose`)

```
                 Caddy (TLS, reverse proxy)
                          │
                 ┌────────┴─────────┐
                 │  Next.js (app)   │  UI + API routes + auth
                 └───┬─────────┬────┘
        enqueue jobs │         │ reads/writes
                     ▼         ▼
              ┌───────────┐  ┌──────────────────────────┐
              │ pg-boss   │  │ PostgreSQL 16 + pgvector  │
              │ worker(s) │◄─┤  system of record +       │
              │ (Node)    │  │  job queue + vector store │
              └─────┬─────┘  └──────────────────────────┘
                    │ LLM calls via provider port
                    ▼
        OpenAI │ Anthropic │ Ollama (local)   ← operator-configured, the ONLY external egress
```

- **app** and **worker** share one TypeScript codebase, two entrypoints (`next start` and a pg-boss worker process). Async/AI work runs in the worker, never blocking request handlers.
- **pg-boss** uses PostgreSQL for the queue — no Redis. **pgvector** lives in the same Postgres — no separate vector DB.
- Email (IMAP/SMTP) is reached by the worker for inbound polling / outbound send.

## Core modules

- `lib/db` — Prisma client + `scopedDb(workspaceId)` wrapper enforcing tenant isolation.
- `lib/auth` — sessions, roles (admin/agent), server-side guards.
- `lib/llm` — **provider abstraction**: a single `complete()/embed()` port with adapters `openai`, `anthropic`, `ollama`; model + keys from settings; AI globally toggleable.
- `lib/triage` — classify(category, priority, sentiment, language) as a worker job.
- `lib/kb` — article ingest → chunk → embed (pgvector); retrieval (`search(query, k)`).
- `lib/reply` — RAG draft generation with citations; returns a draft for human approval (never auto-sends in v1).
- `lib/insight` — analytics jobs: recurring-issue clustering, KB-gap detection, volume drivers, SLA/CSAT.
- `lib/audit` — append-only AI-action log.
- `lib/channels` — pluggable intake: `web-form`, `email`; interface allows future channels.

## Data model (sketch)

`Workspace` · `User`(role) · `Contact` · `Ticket`(state, priority, slaFirstResponseAt, slaResolveAt, category, sentiment, language) · `Message`(direction, public|note, attachments) · `Tag` · `CustomField` · `KbArticle` → `KbChunk`(embedding vector) · `TriageResult` · `ReplyDraft`(citations[], approvedBy) · `InsightRun` · `AuditEvent`(append-only) · `Setting`(per-workspace, encrypted secrets) · `LlmProviderConfig`(provider, encrypted key/endpoint).

Every queryable row carries `workspaceId` (indexed). v1 may run a single workspace but the scoping is enforced from day one.

## AI request flow (triage + drafted reply)

1. Ticket created (web/email) → `triage` job → category/priority/sentiment/language attached (advisory).
2. Agent opens ticket → `reply` retrieves top-k KB/past-ticket chunks (pgvector) → LLM drafts a reply **with citations** → draft shown to agent.
3. Agent edits/approves → reply sent via channel; triage, draft, and send are written to `AuditEvent`.
4. If retrieval is empty/low-confidence, the draft says so instead of inventing a citation.

## Why this stack

- **Single server / `docker compose up`** is the #1 self-host star-driver; pg-boss + pgvector collapse the infra to Postgres + Node.
- **Provider port** makes "evaluate/select platforms" and BYO/local-LLM real, and keeps data on the operator's box.
- Next.js monolith keeps the codebase legible for contributors (a star-retention factor).
