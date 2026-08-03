---
title: Security model
description: A summary of AIDA's data residency, credential handling, authorization, and public-surface controls, with pointers to the full engineering detail.
---

By the end of this page you'll know where AIDA's data goes, how credentials and untrusted input
are handled, and where to report a vulnerability.

This is a summary capped at what AIDA's security pass has actually verified — for the full
engineering detail, see [`docs/SECURITY.md`](https://github.com/afrizzal/aida/blob/master/docs/SECURITY.md)
in the repository.

## Data residency

Ticket data stays in the operator's own PostgreSQL. The only outbound connections AIDA's
application runtime makes are to the LLM endpoint you configured in Settings → AI Features and to
your own configured SMTP/IMAP host — nothing else.

## Credentials at rest

LLM provider API keys and email (IMAP/SMTP) credentials are encrypted with AES-256-GCM and
require `APP_ENCRYPTION_KEY` to decrypt. See [Environment
variables](/aida/configuration/environment/).

## Authorization

Mutating actions are authorized **server-side**, not just hidden in the UI — an admin-only action
rejects a non-admin request even if the request bypasses the client entirely. Every workspace
query is scoped to that workspace; cross-tenant reads are not possible through the normal data
access layer.

## Untrusted input

Ticket text is fenced as data before it reaches a model — never treated as instructions — and
obvious secrets are redacted before that request leaves AIDA. Every AI action is written to an
append-only audit log.

## Public surfaces

The intake form (`/request`) and the tokenised status page (`/status/<token>`) are rate-limited
and honeypot-protected. The status page shows only public messages — internal notes are excluded
server-side.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.** Report privately via GitHub's
[Report a vulnerability](https://github.com/afrizzal/aida/security/advisories/new) flow — see
[`.github/SECURITY.md`](https://github.com/afrizzal/aida/blob/master/.github/SECURITY.md) for the
full disclosure process and scope.

For the complete, evidence-backed engineering security model — threat model, dependency audit
results, and known accepted issues — see
[`docs/SECURITY.md`](https://github.com/afrizzal/aida/blob/master/docs/SECURITY.md).
