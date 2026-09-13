---
id: SEED-006
status: dormant
planted: 2026-09-13
planted_during: v1.0.0 — after Phase 07 close-out (milestone code-complete, not yet archived)
trigger_when: new milestone scope mentions agent productivity, keyboard shortcuts, command palette, "Linear-like" UX, or delight/polish
scope: M (1 phase, ~4 plans)
---

# SEED-006: Command palette (⌘K) + keyboard-driven inbox

## Why This Matters

Keyboard-first triage is what makes Linear, Superhuman and Front feel fast; it is also a visible "quality signal" in a hero GIF. AIDA has zero shortcuts. Plane's "Power K" is a good behavioural spec: a central command *registry* (navigation / creation / preferences / help), a *context detector* so commands change with the current page, chorded shortcuts (`g` then `i`) with a timeout, keystrokes ignored while typing in inputs or the editor, and a shortcuts help modal (`?`). AIDA already ships shadcn's `command` (cmdk) primitive from 02-02, so the UI half is nearly free.

## When to Surface

**Trigger:** new milestone scope mentions agent productivity, keyboard shortcuts, command palette, "Linear-like" UX, or delight/polish.

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**M** — `useShortcuts` hook (registry + chords + input-guard), `CommandPalette` component wired into the app shell (`⌘K`: go to tickets/contacts/KB/insights/settings, search tickets via existing FTS, create ticket, switch saved view), ticket-detail shortcuts (`a` assign, `s` status, `t` tag, `r` reply, `n` note, `j/k` next/prev in list), `?` help modal, E2E, docs page "Keyboard shortcuts".

## Breadcrumbs

- Behaviour reference: `.planning/research/plane-inspiration.md` §4 row 6 (Plane `apps/web/core/components/power-k/core/{registry,shortcut-handler,context-detector}.ts`).
- Existing primitive: `src/components/ui/command.tsx` (shadcn cmdk, installed 02-02).
- FTS search to reuse: `src/lib/tickets/search.ts` (org-safe `$queryRaw`, 02-04).
- App shell / top bar (sticky, backdrop-blur per DESIGN-SYSTEM): `src/app/(app)/` layout from 01-06.

## Notes

Do not copy Plane's UI or key map verbatim — pick a helpdesk-sensible map and document it. Keep it token-only per DESIGN-SYSTEM.md.
