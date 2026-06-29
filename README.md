<div align="center">

# AIDA

### The open-source, AI-native helpdesk you can self-host.

Bring your own LLM — OpenAI, Anthropic, or a local model via Ollama.
Your tickets never leave your server. No per-resolution fees.

<!-- badges (add once CI/release exist) -->
`Apache-2.0` · `Self-hosted` · `Next.js + PostgreSQL` · `Bring-your-own-LLM`

<!-- TODO: hero demo GIF here — single highest-leverage asset for stars -->

</div>

---

## Why AIDA

Most helpdesk software treats AI as a paywalled add-on with per-resolution fees, while your ticket data lives on someone else's servers.

**AIDA is different:** AI is the *core*, not an afterthought. Self-host it on your own server, point it at any LLM (including a fully local one via Ollama), and keep every ticket on your own infrastructure — no per-resolution fees, no data leaving your control.

## Features

| | |
|---|---|
| 🎟️ **Modern ticketing** | Shared inbox, ticket lifecycle, contacts, tags, internal notes, assignment, SLA timers. Web form + email intake. |
| 🧠 **AI auto-triage** | Every incoming ticket is classified — category, priority, sentiment, language — and routed. Small/local models are enough. |
| ✍️ **RAG drafted replies** | Suggested replies grounded in your knowledge base and past tickets, **with citations** and a human-approval gate (no silent AI sends). |
| 📊 **AIDA Insight** | AI-driven analytics, not just dashboards: recurring-issue clustering, knowledge-gap detection, ticket-volume drivers, SLA/CSAT insight. |
| 🔌 **Bring your own LLM** | OpenAI, Anthropic, or local via Ollama. Your keys, your models, your data. Turn AI fully off anytime. |
| 🐳 **One-command self-host** | `docker compose up` — everything (app, Postgres + pgvector, queue) on a single server. |

## Quick start

```bash
git clone https://github.com/<you>/aida.git
cd aida
cp .env.example .env     # set your LLM provider key (or point at local Ollama)
docker compose up
```

Open `http://localhost:3000`. That's it — one server, no managed cloud required.

## Tech stack

Next.js (App Router) · TypeScript · PostgreSQL + pgvector · pg-boss · Prisma · Docker. Single-server by design — easy to run, easy to read.

## Status

🚧 **Early development.** Built in the open with a phased roadmap — see [`.planning/ROADMAP.md`](.planning/ROADMAP.md). Star and watch to follow along.

## Contributing

Contributions welcome once the foundation lands. See [`CONTRIBUTING.md`](CONTRIBUTING.md) (coming soon).

## License

[Apache-2.0](LICENSE).
