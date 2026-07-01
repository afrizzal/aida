# Phase 2: Core Ticketing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 02-core-ticketing
**Areas discussed:** Inbox & ticket workflow, Contacts & conversation, SLA/tags/custom fields, Web intake & attachments

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Inbox & ticket workflow | Layout, views, lifecycle, priority, ticket numbering | ✓ |
| Contacts & conversation | Contact dedup, thread, reply vs note, composer format | ✓ |
| SLA, tags & custom fields | SLA clock/breach, tag model, custom-field types | ✓ |
| Web intake & attachments | Public form, spam guard, status lookup, file storage | ✓ |

**User's choice:** All four areas.

---

## Area 1 — Inbox & ticket workflow

### Inbox layout
| Option | Description | Selected |
|--------|-------------|----------|
| 2-pane (list + reading pane) | List column + detail pane; views as filter chips | ✓ |
| 3-pane (views rail + list + detail) | Zendesk-agent-workspace-like; busiest | |
| List → full detail page | Simplest/mobile-friendly; extra nav hop | |

**User's choice:** 2-pane shared inbox — scrollable list left, detail/reading pane right, within existing content area. Saved views (Unassigned/Mine/Status) as filter chips/tabs above the list; flat, clean navigation.

### Lifecycle
| Option | Description | Selected |
|--------|-------------|----------|
| Flexible — set any status | Any transition via dropdown; requester reply auto-reopens resolved/closed | ✓ |
| Guided linear flow | Enforce new→open→pending→resolved→closed order | |

**User's choice:** Flexible model (New/Open/Pending/Resolved/Closed), any transition via dropdown, no enforced order. New requester message on Resolved/Closed → auto-reset to Open.

### Priority
| Option | Description | Selected |
|--------|-------------|----------|
| Low / Normal / High / Urgent | 4 levels; Zendesk/Freshdesk standard | ✓ |
| Low / Medium / High | 3 levels; fewer SLA rows | |
| Numeric (P1–P4) | ITSM style | |

**User's choice:** Low / Normal / High / Urgent — primary driver of SLA policy targets.

### Ticket IDs
| Option | Description | Selected |
|--------|-------------|----------|
| Sequential per-workspace (#1042) | Human-friendly number + internal cuid | ✓ |
| Internal ID only | cuid everywhere | |

**User's choice:** Human-friendly sequential number (#1001…) auto-incrementing per workspace; primary reference in UI/search/future email subjects. Internal cuid for DB relations + secure status links.

---

## Area 2 — Contacts & conversation

### Contacts
| Option | Description | Selected |
|--------|-------------|----------|
| Auto-create & link by email | Normalized-email match/create at intake | ✓ |
| Agent manually selects/creates | Explicit per-ticket | |

**User's choice:** Auto-match/create by normalized (lowercase) email within the workspace; link if exists, create otherwise. Unified per-contact history, no manual intervention.

### Composer format
| Option | Description | Selected |
|--------|-------------|----------|
| Markdown | Written as Markdown, rendered to sanitized HTML | ✓ |
| Rich text (WYSIWYG) | Toolbar editor; heavier | |
| Plain text | No formatting | |

**User's choice:** Markdown for both replies and notes → sanitized HTML in the thread; email-ready for Phase 3.

### Reply vs note
| Option | Description | Selected |
|--------|-------------|----------|
| One composer with Reply/Note toggle | Amber-tinted notes + lock icon + label | ✓ |
| Two separate composer tabs | Distinct areas | |

**User's choice:** Single composer with a segmented Public Reply / Internal Note toggle. Public = neutral/system colors; Internal = amber-tinted background + lock icon + "Internal Note" label.

### Contact record
| Option | Description | Selected |
|--------|-------------|----------|
| Name, email, phone, company, notes — merge deferred | Searchable list + detail page w/ history | ✓ |
| Minimal: name + email | Bare identity | |
| Richer now, with merge tooling | Scope creep | |

**User's choice:** name + email (dedup key) + phone + company + free-form Notes; searchable Contacts list + dedicated detail page showing per-contact ticket history. Advanced dedup/merge deferred.

---

## Area 3 — SLA, tags & custom fields

### SLA clock
| Option | Description | Selected |
|--------|-------------|----------|
| 24/7 calendar clock | Elapsed wall-clock; per-priority targets in Settings; schema-ready for business hours | ✓ |
| Business-hours calendar | Pauses off-hours/weekends/holidays; large build | |

**User's choice:** 24/7 calendar clock from ticket creation; per-priority targets in Settings (AIDA-12); compute/display at-risk and breached live in the inbox.

### Breach display
| Option | Description | Selected |
|--------|-------------|----------|
| Due badge + background flag job | Color chip + pg-boss stamps isAtRisk/isBreached | ✓ |
| Computed badge only (no job) | Render-time only | |
| Live ticking countdown | Real-time JS timer | |

**User's choice:** Color-coded status chip in inbox; recurring pg-boss job evaluates timestamps and updates isAtRisk/isBreached flags for performant filtering + future notification hook.

### Tags
| Option | Description | Selected |
|--------|-------------|----------|
| Free-form create + reuse | Type-to-create + autocomplete; admin manage in Settings | ✓ |
| Admin-curated list only | Fixed vocabulary | |

**User's choice:** Free-form tagging with autocomplete of existing tags; admin rename/delete management in Settings (AIDA-12).

### Custom fields
| Option | Description | Selected |
|--------|-------------|----------|
| Admin-defined: text/select/number/checkbox/date | 5 core types, filterable | ✓ |
| Text + select only | Two types | |
| Minimal / hardcoded set | Not configurable | |

**User's choice:** Admin-defined in Settings; five types — Short Text, Dropdown (Select), Number, Checkbox, Date. Rendered on ticket detail; integrated into inbox filtering.

---

## Area 4 — Web intake & attachments

### Form fields
| Option | Description | Selected |
|--------|-------------|----------|
| Name, email, subject, message, attachments | Minimal set → Contact + Ticket | ✓ |
| + Category / request-type dropdown | Needs admin config; overlaps custom fields | |

**User's choice:** Name, Email, Subject, Message, Attachments.

### Spam guard
| Option | Description | Selected |
|--------|-------------|----------|
| Honeypot + server-side rate limit | Self-contained, no external calls | ✓ |
| Add a CAPTCHA (Turnstile/hCaptcha) | Third-party egress | |
| No protection in v1 | Bare endpoint | |

**User's choice:** Hidden honeypot field + strict per-IP server-side rate limiting on the submit route; entirely self-contained, no external API calls/scripts.

### Status lookup
| Option | Description | Selected |
|--------|-------------|----------|
| Tokenized link: status + public thread + follow-up box | Unauthenticated; follow-up reopens ticket | ✓ |
| Status label only | No thread/reply | |
| Account-based portal (login) | Out of scope | |

**User's choice:** Unique unguessable `/status/[secure-token]` page — shows current status + public conversation (internal notes excluded) + follow-up composer; follow-up appends and resets to Open if previously Resolved/Closed. No login.

### Attachments
| Option | Description | Selected |
|--------|-------------|----------|
| Local volume, pluggable interface | /data/uploads + FileStorage interface; 10MB + MIME allowlist | ✓ |
| S3-compatible object storage now | External dependency | |
| Store in Postgres (bytea) | Anti-pattern | |

**User's choice:** Dedicated local Docker volume (/data/uploads) served via an authenticated workspace-scoped route; lightweight FileStorage interface for future S3; 10MB per-file limit + strict MIME allowlist.

---

## Claude's Discretion

- Full-text search via **PostgreSQL FTS** (tsvector); indexed-field scope Claude's discretion (default subject + message bodies + ticket number).
- **Individual-agent assignment only** (AIDA-04); no teams/groups/auto-assign in v1.
- **Bulk inbox actions deferred** — not in Phase 2.
- Fixed (not user-savable) view set for v1.
- Seeded SLA default numbers, job cadence, loading/empty/error states, pagination/virtualization, `scopedDb` allowlist extension.

## Deferred Ideas

- Email intake/SMTP (Phase 3); business-hours SLA calendars; contact merge tooling; bulk actions; savable custom views; category picker on public form; optional CAPTCHA toggle; S3 attachment storage; teams/auto-assignment; all AI on tickets (Phases 4–6).
