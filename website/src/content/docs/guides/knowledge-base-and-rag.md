---
title: Knowledge base & RAG
description: Author knowledge-base articles, understand embedding status, and see how cited drafted replies are grounded in your content.
---

By the end of this page you'll know how to author knowledge-base content, what embedding status
means for an article, and exactly how a drafted reply gets — and can fail to get — grounded
citations.

## Authoring articles

Knowledge-base articles are authored directly in the AIDA UI. On save, an article is chunked and
queued for embedding — chunking splits the article into retrieval-sized pieces, and embedding
converts each chunk into a vector stored in pgvector.

Each article shows an embedding status:

| Status | Meaning |
|---|---|
| **Pending** | Queued or waiting on a configured embedding provider — not yet searchable by RAG |
| **Completed** | Chunked, embedded, and available to retrieval |
| **Failed** | The embed job errored — check that your embedding provider is configured and reachable |

Without an embedding provider configured, articles stay in **Pending** indefinitely. This is
expected, not a bug — see [AI provider setup](/aida/configuration/ai-providers/).

## Re-embed all

The **Re-embed all** action in Settings → AI Features re-queues every knowledge-base article for
embedding. Use it after changing the embedding provider or model — vectors from different models
aren't comparable, so switching models without re-embedding leaves retrieval silently comparing
incompatible vectors.

## How drafted replies work

When an agent opens a ticket and requests a draft, AIDA retrieves the knowledge-base (and past
ticket) chunks most relevant to that ticket, then asks the configured chat model to draft a reply
grounded in those chunks. The draft carries **inline citations** back to the source articles.

The draft is shown to the agent, who must **approve or edit it before anything is sent** — AIDA
never sends a drafted reply to a customer autonomously.

## When retrieval finds nothing

If nothing relevant is found in the knowledge base, the draft says so directly rather than
inventing a citation or answering from the model's general knowledge. This is a code-level check,
not just a prompted instruction: with zero relevant chunks retrieved, AIDA never calls the model
at all for that draft.

## The audit trail

Every draft is recorded in the append-only audit log: `DRAFT_GENERATED` when a draft is produced
(with the provider, model, and a redacted version of what was sent), and `DRAFT_APPROVED` when an
agent sends it.
