---
title: Connect your support mailbox
description: Wire IMAP/SMTP into Settings > Email so tickets can be created and replied to over email.
---

By the end of this page your support mailbox will create tickets from inbound mail and send agent
replies back out, with both directions verified from the Settings UI.

## Prerequisite

`APP_ENCRYPTION_KEY` must be set in `.env` before you save email credentials — IMAP and SMTP
passwords are encrypted at rest and the Setting write fails without it. See
[Environment variables](/aida/configuration/environment/).

## The Settings > Email form

The email channel is one form with two halves — inbound (IMAP) and outbound (SMTP) — plus a
shared from-address and a channel toggle:

- **IMAP (Inbound):** Host, Port, Use SSL/TLS, Username, Password, and a **Test Connection**
  button.
- **SMTP (Outbound):** Host, Port, Use SSL/TLS, Username, Password, and its own **Test
  Connection** button.
- **From address:** the address customers see and reply to. It must match your SMTP account or an
  address it's authorized to send as.
- A channel on/off toggle, so you can configure the channel before switching it live.

Password fields always start blank in the form — leaving a password field blank on save keeps the
currently stored value, so you never have to re-enter it just to change the host or port.

## A worked example

A generic IMAP/SMTP provider typically looks like this:

| Field | Value |
|---|---|
| IMAP host | `imap.yourprovider.com` |
| IMAP port | `993` |
| IMAP TLS | on |
| SMTP host | `smtp.yourprovider.com` |
| SMTP port | `587` |
| SMTP TLS | on (STARTTLS) |

Some providers (Gmail, Microsoft 365, and others with 2FA enabled) require an **app-specific
password** rather than your normal account password — check your provider's account security
settings if authentication fails with credentials you know are correct.

## How inbound threading works

An inbound message is matched to an existing ticket by, in order: the `In-Reply-To`/`References`
email headers, then a `[#N]` ticket-number token in the subject line, and otherwise a new ticket
is created. A requester replying to a ticket that's already `RESOLVED` or `CLOSED` automatically
reopens it. Auto-replies and bounce messages are detected and ignored rather than turned into
tickets.

## How outbound works

When an agent sends a public reply, it's queued as a background job and sent by the worker rather
than blocking the request. If a send fails, the message shows a **Failed to send** state with a
retry affordance — it never fails silently.

## Troubleshooting

The Email tab shows a health line driven by the last inbound poll: when it last succeeded, and
the error text if the most recent poll failed. A repeated poll failure (IMAP auth error, connection
refused, TLS error) in `docker compose logs worker` means the channel is broken even though the
app itself is healthy.

Credentials are never written to logs — IMAP/SMTP passwords are decrypted only in-process,
immediately before use.
