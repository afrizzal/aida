---
title: The public portal
description: The unauthenticated intake form and tokenised status page your customers use.
---

By the end of this page you'll understand the two pages your customers interact with directly,
and what's protecting them.

## The intake form (`/request`)

An unauthenticated web form: name, email, subject, message, and optional file attachments. On
submit, it creates a new ticket and returns a link to the status page for that ticket.

Because this page accepts input from the open internet, it carries several protections:

- A honeypot field invisible to real users, used to silently reject bot submissions
- Per-IP rate limiting on submissions
- Attachment size and file-type limits, enforced server-side with byte-sniffed detection — not
  just trusting the browser's reported content type

These are described here as protections rather than exact thresholds, since publishing exact
limits would only help someone probing them.

## The status page (`/status/<token>`)

The link returned after a successful submission — and the one a requester receives by email —
points to a **tokenised** status page. The token is a dedicated random secret generated for that
ticket, not the ticket's own ID, so it can't be guessed by iterating ticket numbers.

This page only ever shows **public messages** — internal notes are excluded **server-side**, in
the database query itself, never filtered after the fact in the browser. A requester can:

- See the ticket's thread of public replies
- Send a **follow-up reply**, which automatically **reopens** the ticket if it was already
  resolved or closed
- Leave a **1–5 CSAT rating** once the ticket is resolved

## Your workspace name here

The workspace name set in [Settings → Branding](/aida/configuration/branding/) appears on both of
these pages, so customers see your organization's name rather than a generic "AIDA" label.
