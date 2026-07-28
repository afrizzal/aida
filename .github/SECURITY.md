# Security Policy

## Supported Versions

AIDA is pre-1.0. Only the **latest released version** (and `master`) receives
security fixes. Once we ship 1.0, this section will move to a standard
supported-version-line table.

| Version        | Supported          |
| -------------- | ------------------- |
| latest release | ✅                   |
| `master`       | ✅ (best effort)     |
| older releases | ❌                   |

## Reporting a Vulnerability

**Please do not open a public issue for a security vulnerability.**

Report privately using one of these channels:

1. **Preferred:** GitHub's [Report a vulnerability](https://github.com/afrizzal/aida/security/advisories/new) (Security tab → Advisories → "Report a vulnerability"). This opens a private advisory only the maintainer can see.
2. **Alternative:** email <!-- maintainer: set before launch -->`security@aida-helpdesk.example`<!-- /maintainer --> with a description of the issue.

A public GitHub issue is visible to everyone, including anyone who might exploit the report before a fix ships — please keep the initial report private.

## What to include

To help us triage and fix quickly, please include:

- AIDA version or commit hash
- Environment: self-hosted `docker compose` stack, or local dev (`pnpm dev`)
- Steps to reproduce (as concrete as possible)
- Impact: what an attacker could do, and any data/tenant boundary crossed

## Our commitment

- We will acknowledge your report within **5 business days**.
- We will keep you informed as we investigate and work on a fix.
- We will credit reporters who want to be credited, once a fix ships.

## Scope

In scope:

- The AIDA application (ticketing core, AI triage/draft/Insight pipeline, auth & tenant isolation)
- The shipped Dockerfile and `docker-compose.yml` stack
- Public intake/status endpoints (unauthenticated routes: web form intake, public status page)
- Tenant isolation (`scopedDb` / cross-organization data leaks)
- Credential-at-rest handling (encrypted LLM/email provider keys)

## Out of scope

- Vulnerabilities in a user's own LLM provider (OpenAI/Anthropic) or SMTP/IMAP host — those are third-party services the operator configures
- Issues that require a pre-compromised server or a self-signed/misconfigured deployment to exploit
- Findings against a fork that has diverged from this repository

## Security model

For the engineering-level security model — data residency & egress, secrets handling, untrusted-input/prompt-injection defenses, PII redaction, and auditability — see [`docs/SECURITY.md`](../docs/SECURITY.md). This document is the disclosure *process*; that document is the *design*.
