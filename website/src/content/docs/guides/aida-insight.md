---
title: AIDA Insight
description: What a background Insight run computes, what it requires, and why every output is checkable against the tickets it came from.
---

By the end of this page you'll know what an AIDA Insight run produces, what it needs to run, and
how to verify its output is grounded rather than free-floating prose.

## What a run produces

An Insight run for a given period computes:

- **Recurring-issue clusters** — groups of similar tickets, each citing the specific tickets it
  was built from
- **Knowledge-base gaps** — clusters of tickets with no well-matching KB article, flagged as gaps
  worth writing content for
- **Ticket-volume drivers** — with period-over-period deltas, so you can see what's trending
- **An SLA/CSAT summary** — with an AI-written narrative describing the period

## Periods and execution

Runs are generated for **7, 30, or 90-day** periods. A run is a **background job**, not a blocking
request — you trigger it from `/insights` and it completes asynchronously.

## Requirements

- **Both a chat and an embedding provider** must be configured — clustering needs embeddings, and
  the narrative and cluster labels need the chat model.
- Enough ticket history in the selected window to form clusters. A very quiet period may produce
  few or no clusters, which is an honest result, not a failure.

## Reproducibility

The parameters used to produce a run are stored with that run, and every cluster and KB gap cites
the specific tickets it was built from. The output is checkable against your own ticket data — not
prose you have to take on faith.

## Where CSAT comes from

CSAT scores come from the 1–5 rating a requester can leave on the public status page
(`/status/<token>`) once their ticket is resolved. See [The public
portal](/aida/guides/public-portal/).
