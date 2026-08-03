---
title: AI provider setup
description: Wire AIDA to OpenAI, Anthropic, or a fully local Ollama — and understand exactly what leaves your server when you do.
---

By the end of this page you'll have a chat provider and (optionally) an embedding provider
configured in Settings → AI Features, verified with Test Connection, and you'll know exactly what
ticket data AIDA sends to the model you chose.

## AI is optional

AIDA is a complete helpdesk with AI turned off. Ticketing, email and web intake, SLA tracking, the
knowledge base, and the public portal all work with zero LLM configured. AI adds triage, drafted
replies, and AIDA Insight on top — it is never a requirement to run the product.

## Prerequisite

`APP_ENCRYPTION_KEY` must be set in `.env` before you save a provider API key — see
[Environment variables](/aida/configuration/environment/). Provider keys are encrypted at rest
and the save fails without it.

## Two providers, configured separately

Settings → AI Features has two independent provider configs:

- **AI Provider** — the chat/completion model used for triage, drafted replies, and AIDA Insight
  narratives.
- **Embedding Provider** — the model used for knowledge-base retrieval and ticket clustering.

These can be different vendors. A common setup is a local Ollama for embeddings (so ticket text
never leaves the machine for retrieval) paired with a hosted model for the chat/drafting side, or
vice versa. Anthropic has no embeddings API, so an Anthropic chat setup always needs OpenAI or
Ollama configured separately for embeddings.

## OpenAI

1. Get an API key from your OpenAI account (`platform.openai.com` → API keys).
2. In Settings → AI Features → AI Provider, select **OpenAI**, paste the key into **API key**,
   and pick a model from the dropdown (or choose **Custom…** to enter any model ID your account
   has access to).
3. Click **Test Connection**. A failure surfaces the provider's own error text — most commonly an
   invalid key or a model your account can't access.

## Anthropic

Same shape as OpenAI: get a key from your Anthropic console, select **Anthropic** as the
provider, paste the key, pick a model (or **Custom…**), and Test Connection. Anthropic keys are
only used for the chat/completion provider — there's no Anthropic option in the Embedding
Provider dropdown, because Anthropic doesn't offer an embeddings API.

## Ollama (fully local)

Ollama runs on hardware you control, so this is the configuration where **no ticket data leaves
the operator's machine at all**.

**Reaching Ollama from inside Docker.** AIDA's containers can't reach an Ollama instance running
directly on your host via `localhost` — `localhost` inside a container means the container itself,
not the host. The pattern:

- On Docker Desktop (macOS/Windows), containers can reach the host at
  `http://host.docker.internal:11434` — this resolves out of the box.
- On Linux, Docker's default bridge network doesn't proxy that hostname automatically. Add
  `extra_hosts: ["host.docker.internal:host-gateway"]` to the `app` and `worker` services in your
  `docker-compose.yml` (Docker Engine 20.10+), or point the Base URL field directly at the host's
  bridge IP (`ip addr show docker0`, commonly `172.17.0.1`).
- Either way, start Ollama with `OLLAMA_HOST=0.0.0.0` so it accepts connections from outside
  `localhost`, and make sure your firewall allows traffic from the Docker network.

Pull a chat model and an embedding model on the Ollama host:

```bash
ollama pull llama3.1
ollama pull nomic-embed-text
```

In Settings → AI Features, select **Ollama** for either provider, set the **Base URL** to the
address you worked out above, pick a model, and Test Connection.

## Embeddings

AIDA's vector store is fixed at **768 dimensions**. Every embedding model configured — OpenAI or
Ollama — must produce 768-dimension vectors; this is enforced when embeddings are generated, not
just documented. Changing the embedding provider or model requires re-embedding every knowledge-base
article, because vectors from different models aren't comparable — see
[Knowledge base & RAG](/aida/guides/knowledge-base-and-rag/) for the **Re-embed all** action.

## Turning AI off

The **Enable AI** switch in Settings → AI Features is a global kill switch, gated on having a
chat provider configured. Turning it off immediately stops: automatic triage on new tickets,
Generate draft, and Generate insights. Everything else keeps working exactly as before — tickets,
email and web intake, SLA tracking, the shared inbox, contacts, and manually authoring knowledge-base
articles.

## What AIDA sends to the model

- Ticket text is treated as **untrusted input**: it's fenced as data to analyze, never as
  instructions, so embedded text can't hijack the model into taking an action.
- Obvious secrets (API keys, passwords, tokens, card-like numbers) are redacted before the
  request leaves AIDA.
- Every AI action — triage, a generated draft, an Insight run — is recorded in an append-only
  audit log with the provider and model that produced it.
- Nothing is sent anywhere except the single endpoint you configured above: your OpenAI/Anthropic
  account, or your own Ollama instance. AIDA orchestrates these models via their API — it does not
  train or fine-tune anything.

See the [security model](/aida/security/security-model/) for the full picture.
