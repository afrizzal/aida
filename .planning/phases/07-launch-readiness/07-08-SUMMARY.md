---
phase: 07-launch-readiness
plan: 08
subsystem: infra
tags: [playwright, testcontainers, ffmpeg, demo-mode, screenshots, hero-gif, ollama-stub, rag]

# Dependency graph
requires:
  - phase: 07-launch-readiness (07-02)
    provides: "src/lib/demo/fixtures.ts + seedDemoData() — the 30-ticket demo dataset this script seeds and captures"
  - phase: 07-launch-readiness (07-07)
    provides: "src/lib/demo/identities.ts (ensureDemoIdentities) + DEMO_ADMIN_EMAIL/DEMO_ADMIN_PASSWORD env contract that prisma/seed.ts now uses instead of ADMIN_EMAIL/ADMIN_PASSWORD"
provides:
  - "scripts/capture-demo-assets.ts + `pnpm demo:capture` / `pnpm demo:capture -- --record`: a reproducible, disposable-Testcontainer capture pipeline against the REAL production build"
  - "docs/assets/: ten retina screenshots (5 pages x light/dark) + docs/assets/aida-demo.gif (20.25s hero animation, post-second-correction) — CORRECTED TWICE: 61e4d00 fixed two maintainer-flagged defects (insights clipping + a re-capture after the SLA chip display fix), and this round (432d41f/1e7efef/6ab9240) fixed the dataset's SLA-timestamp/intent mismatch and the GIF's blank+skeleton pre-roll (see 'Correction Round 2' section)"
  - "src/lib/demo/fixtures.ts's ageHours/slaState/reply-offset values are now internally consistent with SLA due-timestamp math (DEFAULT_SLA_TARGETS) — every ticket's rendered SlaDueChip agrees with its declared on-track/at-risk/breached intent, verified by a throwaway tsx script mirroring getActiveDue()/SlaDueChip exactly"
  - "fix(tickets): TicketListRow shrink-0 — a real pre-existing layout bug (rows could visually shrink below content height and bleed into the next row) discovered and fixed via this capture"
  - "fix(tickets): SlaDueChip renders Overdue for past-due tickets instead of a signed negative countdown — a real pre-existing display bug discovered via maintainer review of this capture's assets, fixed at commit 80aee33"
affects: [07-10-readme]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "capture-build-marker.json (.next/capture-build-marker.json) records which BASE_URL a cached `next build` was produced for — NEXT_PUBLIC_APP_URL is inlined into the client bundle at build time, so a stale cached build silently breaks browser-driven sign-in (net::ERR_CONNECTION_REFUSED to the wrong origin) if the port ever changes; the marker makes the build cache self-correcting"
    - "Local Ollama-protocol HTTP stub (mirrors tests/e2e/phase5-rag.spec.ts) reused outside the test runner, inside a plain tsx script, to drive AIDA's real embed()/complete() code paths for a recording without a real LLM"
    - "Deterministic keyword-proximity 'embedding' stub (topicEmbedding/wordsNear) for capture-only use: buckets dims of a 768-vector by real keyword co-occurrence in the actual seeded text, never a hardcoded ticket-to-article lookup"
    - "pollUrl() — a plain page.url() polling loop — for asserting on Next.js App Router client-side (History API) transitions; Playwright's own event-based page.waitForURL was intermittently flaky against them on this machine"

key-files:
  created:
    - scripts/capture-demo-assets.ts
    - docs/assets/inbox.png
    - docs/assets/inbox-dark.png
    - docs/assets/ticket-detail.png
    - docs/assets/ticket-detail-dark.png
    - docs/assets/insights.png
    - docs/assets/insights-dark.png
    - docs/assets/knowledge-base.png
    - docs/assets/knowledge-base-dark.png
    - docs/assets/settings-ai.png
    - docs/assets/settings-ai-dark.png
    - docs/assets/aida-demo.gif
  modified:
    - package.json
    - .gitignore
    - src/app/(app)/tickets/ticket-list-row.tsx

key-decisions:
  - "Standalone server mode chosen over `next start`, unconditionally, when a `.next/standalone/server.js` build exists: empirically, `next start` boots and even passes /api/health, but Next.js itself logs a warning that `next start` doesn't work with `output: standalone`, and real browser-driven sign-in silently hung — the standalone path is used first, `next start` kept only as a fallback for an environment without output:standalone."
  - "The ticket used for inbox.png/ticket-detail.png AND the GIF is #11 'Cannot reset password – reset email never arrives' (Sofia Marquez): OPEN, at-risk SLA, exactly two tags (password-reset, bug), and the seed's own DRAFT_GENERATED->DRAFT_APPROVED trail — the single richest ticket in the 07-02 dataset."
  - "GIF variant A (live stub draft) shipped, not variant B — see 'Caption obligation for 07-10' below. Chosen because the underlying pieces (Ollama-protocol stub, kbEmbedArticleHandler direct-call, retrieval/groundedness/citation pipeline) were all already proven by tests/e2e/phase5-rag.spec.ts, and it exercises the genuine RAG code path rather than only replaying stored data."
  - "The step-1 'and back' filter interaction uses a fresh full navigation back to /tickets rather than clicking the 'All' pill a second time: clicking 'All' immediately after 'Unassigned' was observed to sometimes leave the URL on the stale `view=unassigned` state (Next.js router-push race), and a full reload is equally convincing on video."
  - "CORRECTION ROUND: `SlaDueChip` fixed to render red 'Overdue' when `isBreached || isPastDue` (a locally-computed `dueAt < now`) instead of only `isBreached` — the demo dataset's `sla-flag` worker job only sets `isBreached`/`isAtRisk` on its recurring run, so seeded tickets with old `dueAt` values were rendering a signed negative countdown ('Due in -22h') in production, not just in the capture. This was a real, previously-shipped display bug, found via the maintainer's asset review, not a capture-only artifact. Fixed in `80aee33`, prior to this correction round; this round's job was purely to re-capture so every asset reflects it."
  - "CORRECTION ROUND: `insights.png`/`insights-dark.png` switched to `fullPage:true, scale:\"css\"` (identical pattern to `ticket-detail.png`) after the maintainer flagged the Volume Drivers and SLA & CSAT cards as clipped at the fixed 900px viewport. Using CSS-pixel scale instead of the context's 2x device pixels kept the fullPage capture well under the 500KB ceiling (221,983 / 227,309 bytes) despite the taller page — no cropping, no capture-only CSS."
  - "CORRECTION ROUND 2 (defect A): `fixtures.ts`'s `ageHours` values (and the `firstResponseAfterHours`/reply `offsetHours` that interact with them) disagreed with each ticket's declared `slaState` once the chip's display was made honest (80aee33) — 14 of 18 non-resolved tickets rendered 'Overdue' despite being declared on-track or at-risk. Fixed by tuning `ageHours` per ticket against its priority's SLA target (`DEFAULT_SLA_TARGETS`) and the actual due timestamp the UI renders (`getActiveDue()`: first-response due until responded, then resolution due) — reclassifying a handful of very-old, never-responded tickets (T5/T7/T8/T10/T12, using this SUMMARY's T-numbering = fixture array position) from on-track to breached instead of forcing them under an SLA window that didn't fit; this is more honest than an artificial age shrink and the plan explicitly permits adjusting the declared `slaState` distribution. T12's age was also brought in line with its own body text (\"...CSV list yesterday...\"), a byproduct data-quality fix."
  - "CORRECTION ROUND 2 (defect B): the hero GIF opened on a blank frame then the `/tickets` loading skeleton for ~0.8s (fps=12) because Playwright's `recordVideo` starts accumulating frames the instant the recorded page is created, before the first `/tickets` navigation settles. Fixed by measuring the real wall-clock time from page creation to the end of the first `settle()` call (the same interval that produces the blank+skeleton frames) and passing it to the ffmpeg conversion as an `-ss` input-seek offset (plus a small buffer), applied identically to both the palettegen and paletteuse passes — a trim, not a re-render of any frame's content."

requirements-completed: []  # AIDA-22 already fully closed by 07-07; AIDA-23 spans multiple plans and is intentionally left Pending until 07-10 lands (STATE.md precedent). Task 3 approved 2026-08-01 ("Approved all") — see the Task 3 section.

# Metrics
duration: unrecorded (long session — extensive live debugging of a real CSS bug and two script-timing flakes; see Issues Encountered). Correction round 1 (defect fixes + full re-capture): ~25 min wall-clock. Correction round 2 (SLA data reconciliation + GIF pre-roll trim + full re-capture + rigorous frame-by-frame re-verification including a full sequential GIF decode): ~45 min wall-clock, single session.
completed: 2026-08-01 (all 3 tasks; Task 3 human-verify approved after two correction rounds)
---

# Phase 7 Plan 8: Demo Asset Capture Script + Launch Visuals Summary

**A reproducible `pnpm demo:capture` script boots a disposable, seeded, PRODUCTION AIDA instance and captures ten retina screenshots (light+dark) plus a ~20s hero GIF with a live cited-draft segment against a local Ollama-protocol stub — in the process found and fixed a real pre-existing ticket-list layout bug and a real SLA-chip display bug, then went through TWO maintainer-driven correction rounds: the first fixed a clipped insights screenshot, the second reconciled the demo dataset's SLA timestamps with its declared on-track/at-risk/breached intent and trimmed the GIF's blank+loading-skeleton pre-roll.**

## Performance

- **Duration:** Not precisely tracked for Tasks 1-2 (session ran long due to live debugging — see Issues Encountered). Task 1 committed 2026-07-31 22:57:48+07:00, Task 2 committed 2026-07-31 23:27:05+07:00. Defect-1 product fix committed as `80aee33` (SLA chip display fix). Correction round 1 (defect-2 fullPage fix + full re-capture + frame-by-frame review) completed in a single follow-up session, committed as `61e4d00`. Correction round 2 (SLA data reconciliation + GIF pre-roll trim + full re-capture + rigorous frame-by-frame re-verification) committed as `432d41f` / `1e7efef` / `6ab9240`.
- **Tasks:** 3 of 3 complete. Task 3 was a blocking human-verify checkpoint — never auto-completed; approved by the maintainer on 2026-08-01 ("Approved all"). Three correction commits/rounds (`80aee33`, `61e4d00`, then `432d41f`/`1e7efef`/`6ab9240`) landed between Task 2 and that approval, addressing defects the maintainer found across two rounds of reviewing the capture before signing off.
- **Files modified:** 14 (Task 1) + 2 (Task 2) + 1 (`80aee33`) + 10 (`61e4d00`, correction round 1 — 1 script file + 9 regenerated assets) + 1 (`432d41f`, `src/lib/demo/fixtures.ts`) + 1 (`1e7efef`, `scripts/capture-demo-assets.ts`) + 10 (`6ab9240`, correction round 2 re-capture — 9 regenerated PNGs + the GIF, plus `deferred-items.md`; `settings-ai(.png/-dark.png)` remained byte-identical across BOTH correction rounds and were never re-committed) = 39 total touches across seven commits

## Accomplishments

- `scripts/capture-demo-assets.ts` — a single script, two modes:
  - **Default (screenshots):** boots `pgvector/pgvector:pg16` in a throwaway Testcontainer, runs `prisma migrate deploy` + the real demo seed (`DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD`), builds the app once (cached across reruns, keyed to the capture port), serves it via the real standalone production server, logs in through the real `/login` form, and captures `inbox`, `ticket-detail`, `insights`, `knowledge-base`, `settings-ai` at `1440x900`/`deviceScaleFactor:2` in both `light` and `dark` — ten PNGs, all 10KB-500KB.
  - **`--record`:** additionally starts a local HTTP server that speaks the Ollama wire protocol, points AIDA's real LLM/embedding settings at it, embeds all six seeded KB articles by calling `kbEmbedArticleHandler` directly (no worker process), then drives and video-records the D-07 golden path — including a **live** "Generate draft" click that exercises the real retrieval → groundedness-gate → citation pipeline — and converts the recording to `docs/assets/aida-demo.gif` via ffmpeg's two-pass palette technique.
- Found and fixed a **real, pre-existing product bug** while inspecting `inbox.png`: `TicketListRow`'s `<Link>` was missing `shrink-0`. Inside `TicketListPanel`'s flex-column `<aside overflow-y-auto>`, once the panel's cumulative row content exceeded available height, flexbox's default shrink behavior could compress a row below its own content's height — `min-h-[80px]` alone does not protect a flex item from shrinking. A ticket with enough chips to wrap onto a second line (a real 07-02 fixture: 5 chips) then had that second line visually bleed into the next row. Confirmed via `getBoundingClientRect`/`scrollHeight` before and after the fix, then applied at the source (`src/app/(app)/tickets/ticket-list-row.tsx`).
- Found and fixed two issues in my own capture-script logic while getting the recording reliable (not product bugs): a NEXT_PUBLIC_APP_URL build-time-inlining trap that broke browser sign-in against a stale cached build, and an intermittent Next.js App Router client-transition race against Playwright's `page.waitForURL`.

## Task Commits

1. **Task 1: Capture script + the five screenshots in light and dark** - `c64ead3` (feat)
2. **Task 2: Golden-path recording and hero GIF** - `b306245` (feat)
3. **Product fix found via asset review: `SlaDueChip` Overdue-vs-negative-countdown** - `80aee33` (fix)
4. **Correction round 1: `fullPage` insights fix + full re-capture of all ten PNGs and the GIF** - `61e4d00` (fix)
5. **Correction round 2: reconcile demo dataset SLA timestamps with declared slaState** - `432d41f` (fix)
6. **Correction round 2: trim the hero GIF's blank + loading-skeleton pre-roll** - `1e7efef` (fix)
7. **Correction round 2: re-capture launch assets against reconciled SLA data + trimmed GIF** - `6ab9240` (fix)

## Files Created/Modified

- `scripts/capture-demo-assets.ts` — the capture script (both modes); correction round 2 added `preRollSeconds` measurement + ffmpeg `-ss` trim
- `package.json` — `"demo:capture": "tsx scripts/capture-demo-assets.ts"`
- `.gitignore` — `docs/assets/*.webm`
- `src/app/(app)/tickets/ticket-list-row.tsx` — added `shrink-0` (bug fix, see above)
- `src/lib/demo/fixtures.ts` — correction round 2: `ageHours`/`slaState`/reply `offsetHours` reconciliation (14 tickets touched; see Correction Round 2 section)
- `.planning/phases/07-launch-readiness/deferred-items.md` — correction round 2: logged one new out-of-scope finding (see Correction Round 2 section)
- `docs/assets/inbox.png`, `inbox-dark.png`, `ticket-detail.png`, `ticket-detail-dark.png`, `insights.png`, `insights-dark.png`, `knowledge-base.png`, `knowledge-base-dark.png`, `settings-ai.png`, `settings-ai-dark.png`, `aida-demo.gif`

## Asset Manifest (exact byte sizes, current on disk — POST-CORRECTION-ROUND-2, as of commit `6ab9240`)

| Asset | Bytes (round 1) | Bytes (round 2, current) | Budget | Status |
|---|---:|---:|---|---|
| `docs/assets/inbox.png` | 439,871 | 437,306 | 10KB–500KB | OK |
| `docs/assets/inbox-dark.png` | 446,735 | 444,295 | 10KB–500KB | OK |
| `docs/assets/ticket-detail.png` | 202,973 | 204,523 | 10KB–500KB | OK |
| `docs/assets/ticket-detail-dark.png` | 206,867 | 208,131 | 10KB–500KB | OK |
| `docs/assets/insights.png` | 221,983 | 222,650 | 10KB–500KB | OK |
| `docs/assets/insights-dark.png` | 227,309 | 227,792 | 10KB–500KB | OK |
| `docs/assets/knowledge-base.png` | 165,228 | 166,451 | 10KB–500KB | OK |
| `docs/assets/knowledge-base-dark.png` | 166,741 | 169,057 | 10KB–500KB | OK |
| `docs/assets/settings-ai.png` | 162,258 | 162,258 (byte-identical — page unaffected by either round's defects) | 10KB–500KB | OK |
| `docs/assets/settings-ai-dark.png` | 164,226 | 164,226 (byte-identical) | 10KB–500KB | OK |
| `docs/assets/aida-demo.gif` | 4,956,876 (~4.73MB, 26.4s) | 5,001,474 (~4.77MB, 20.25s) | < 8MB | OK |

`inbox.png`/`inbox-dark.png` sit closest to the 500KB ceiling (~55-62KB of headroom) — the script's own `validateManifest()` throws non-zero if a future rerun ever crosses it, so this is self-enforcing, not just documented. Byte-size deltas round 1 -> round 2 for the other PNGs are all normal run-to-run noise (timestamp text rendering, e.g. "1m ago" vs "just now", anti-aliasing variance) — no capture-mode changes were made to those pages this round. The GIF is both smaller in *duration* (20.25s vs 26.4s, after trimming the ~2.13s pre-roll) and very slightly larger in *bytes* (normal palette/frame-content variance from a fresh recording run, not a settings change) — still comfortably under the 8MB budget.

## Server mode used

**Standalone** (`node .next/standalone/server.js`, after copying `public/` and `.next/static` into it — mirrors the Dockerfile's `COPY --from=builder` layout), used unconditionally whenever `.next/standalone/server.js` exists. `next start` is kept as a coded fallback only. Reason: `next start` against this repo's `output: "standalone"` config boots and even passes `/api/health`, but Next.js itself logs `"next start" does not work with "output: standalone" configuration`, and a real browser-driven sign-in hung indefinitely under it (see Issues Encountered).

## GIF details (Task 2)

**Variant shipped: A (live stub draft).** The recording's step 4b performs a REAL "Generate draft" click against a local HTTP server speaking the Ollama wire protocol (same pattern as `tests/e2e/phase5-rag.spec.ts`), after the script embeds all six seeded KB articles by calling `kbEmbedArticleHandler` directly. This exercises AIDA's genuine retrieval → pgvector KNN → groundedness gate → citation-resolution → `complete()` pipeline — not a fabricated UI state. The AI Activity trail visibly grows from 3 to 5 entries during the recording, with the new two entries correctly stamped `provider: ollama, model: llama3.1` (distinct from the seeded `provider: demo, model: demo-seed` entries below them) — verified frame-by-frame.

**Caption obligation for Plan 07-10 (per the plan's own instruction):** the README caption under the hero GIF MUST state that the model behind the recorded live draft is a **local Ollama-protocol stub used only for this recording**, and that AIDA itself works with OpenAI, Anthropic, or a real local Ollama model. This is a hard requirement carried forward from 07-08-PLAN.md's honesty constraint.

**Five recorded steps, in order:**
1. Landed on `/tickets` (shared inbox, 30 tickets, SLA chips + filters visible); clicked the "Unassigned" view filter, then a fresh navigation back to the unfiltered list.
2. Opened ticket #11 (a real click on its list row, not a deep link): status/priority/assignee controls, triage chips (category/sentiment/language), tags.
3. Scrolled the thread: inbound message, agent public reply, amber internal note.
4. Revealed AI Activity: the stored `Draft generated` → `Draft approved` sequence with its citation. Then (4b) clicked "Generate draft" for real, waited for the DraftCard with a **correct** citation to "Resetting your password", clicked "Insert into reply", then "Send Reply" (asserted the POST response was 200).
5. Navigated to `/insights` (real sidebar Link click): the four populated cards (recurring issues, KB gaps, volume drivers, SLA & CSAT).

**Total runtime (original round):** 24.1 seconds. **Total runtime (correction round 1, `61e4d00`):** 26.4 seconds. **Total runtime (correction round 2, `6ab9240`, post pre-roll trim):** 20.25 seconds (recorded raw runtime 23.3s, minus the measured 2.13s pre-roll trim) — all within the plan's 20-35s target; the recording-length differences across rounds are normal run-to-run timing noise in the same recorded steps (plus, in round 2, the deliberate pre-roll trim), not a choreography change.

**Recording mechanics:** `browser.newContext({ viewport: {width:1280,height:800}, deviceScaleFactor: 1, recordVideo: { dir: <tmp>, size: {width:1280,height:800} } })`, forced `theme=light` via an init script.

**Exact ffmpeg commands (two-pass palette, first attempt succeeded — no retry needed — all three rounds; correction round 2 added the `-ss` pre-roll trim, identical on both passes):**
```
ffmpeg -y -ss <preRollSeconds> -i <input.webm> -vf "fps=12,scale=1000:-1:flags=lanczos,palettegen=stats_mode=diff" <palette.png>
ffmpeg -y -ss <preRollSeconds> -i <input.webm> -i <palette.png> -lavfi "fps=12,scale=1000:-1:flags=lanczos,paletteuse=dither=bayer:bayer_scale=3" docs/assets/aida-demo.gif
```
Final settings: `fps=12, scale=1000:-1`, `-ss 2.13` (correction round 2's measured value — see Correction Round 2 section for how it's derived) → **5,001,474 bytes**, comfortably under the 8MB budget.

**No `.webm` intermediate is committed** — it lives only in an `os.tmpdir()` directory that's removed in the script's `finally` block (with retry to survive a Windows EBUSY race right after `context.close()` flushes the file). Confirmed absent from `git status --porcelain` after all three rounds.

**Correction-round-1 frame-by-frame verification:** extracted all frames of the corrected GIF at `fps=2` (51 frames covering the full 25.25s) via `ffmpeg -y -i docs/assets/aida-demo.gif -vf "fps=2" frame-%03d.png` and read a representative sample (roughly every 3rd-4th frame, plus the key transition points: filter click, ticket open, thread scroll, AI Activity reveal, live Generate-draft click, DraftCard-with-citation, Insert-into-reply, Send, and the final `/insights` landing). Confirmed: no frame anywhere shows `Due in -` text; every SLA chip visible in the recording (the header chip on ticket #11, "Overdue" badges in the list) is the correct red "Overdue" badge; the AI Activity trail visibly grows from 3 to 5 entries with the two new entries stamped `ollama · llama3.1` (distinct from the seeded `demo · demo-seed` entries), and the DraftCard's citation resolves to "Resetting your password" exactly as before.

**Correction-round-2 frame-by-frame verification (more rigorous — see Correction Round 2 section below for the full writeup):** fully sequentially decoded ALL 243 frames of the final GIF (`ffmpeg -y -i aida-demo.gif f-%03d.png`, no `select` filter, to rule out GIF disposal/diff-mode compositing artifacts a frame-selecting filter could introduce) and read frame 1 plus samples every ~2.5s across the full timeline, plus a denser cluster of frames around ticket #11's header (see deferred-items.md finding). Frame 1 is the fully-painted, unfiltered `/tickets` inbox — no blank frame, no loading skeleton, no error toast anywhere in the sampled set.

## Decisions Made

See `key-decisions` in the frontmatter. Most notable beyond that list:
- The embedding "model" behind the stub is a deterministic keyword-proximity function (`topicEmbedding`/`wordsNear`), not a real neural embedding — documented extensively in code comments and disclosed here. It buckets a 768-dim vector by literal keyword co-occurrence in the REAL seeded text (never a hardcoded ticket→article lookup), giving genuine, non-trivial pgvector cosine-distance discrimination across the six KB articles.
- This stub is capture-tooling only — it is never imported by, or reachable from, the shipped application. It lives entirely inside `scripts/capture-demo-assets.ts` and only runs inside this script's own throwaway container.

## Correction Round (defects found in the maintainer's review of the first capture)

Tasks 1 and 2 were originally committed (`c64ead3`, `b306245`) and this SUMMARY was drafted, but before the Task 3 human-verify checkpoint could run, the maintainer reviewed the first capture directly and found two defects. This section documents that correction round; Task 3 (human sign-off) ran later against the twice-corrected asset set and was approved — see the Task 3 section below.

### Defect 1 — `Due in -Nh` negative countdowns instead of "Overdue" (a real product bug, not a capture artifact)

Four inbox rows in the first capture read `Due in -1h` / `Due in -22h` / `Due in -1d` / `Due in -3d`. Root cause: `formatDueDuration` (`src/lib/tickets/format-duration.ts`) returns a **signed** value, and `SlaDueChip`'s on-track branch printed it unconditionally. `isBreached`/`isAtRisk` are set only by the recurring sla-flag worker job (decision 02-05) — between its runs, a ticket can be genuinely past its due time with both flags still `false`. That means this was a **production-visible defect**: any real deployment with a ticket whose due time has passed but the flag-refresh job hasn't run yet would show the same negative countdown to a real agent.

Fixed in `80aee33` (committed before this correction round began, NOT part of this round's work, and NOT re-touched or reverted by it): `src/components/tickets/sla-due-chip.tsx` now renders the red "Overdue" badge when `isBreached || isPastDue`, where `isPastDue = new Date(dueAt).getTime() < Date.now()`. DB flags still drive filtering/reporting — this only corrects the chip's *display*. `tsc --noEmit` and biome were clean on that fix; `tests/e2e/sla.spec.ts` was unaffected (it asserts against a freshly created future-due ticket, never a stale one).

This round's job re: defect 1 was purely to **re-capture every asset** so the fix is visible everywhere a due-date chip appears — confirmed via personal frame-by-frame / image-by-image review (see per-image observations below and the GIF verification note above): no `Due in -` text survives in any of the ten PNGs or any sampled GIF frame.

### Defect 2 — `insights.png`/`insights-dark.png` viewport-clipped (fixed in this round)

The original `insights.png`/`insights-dark.png` captured `/insights` at the fixed `1440x900` viewport with `fullPage: false`, which cut the **Volume Drivers** and **SLA & CSAT** cards off mid-content (both cards run taller than 900px once the `/insights?period=30` data — By Category / By Tag / By Company breakdowns, and the CSAT star histogram + AI Summary box — are populated).

Fix (`scripts/capture-demo-assets.ts`, this round's only script change): switched the insights capture to `fullPage: true, scale: "css"` — the exact same pattern the script already used for `ticket-detail.png`. `scale:"css"` (1x CSS pixels instead of the browser context's 2x device-pixel-ratio) was necessary to stay under the 500KB PNG ceiling once the page height roughly doubled; verified the result is still sharp enough for a launch screenshot (read both images at full resolution below). No cropping, no capture-only CSS, no change to the actual `/insights` page — purely a capture-script change.

### Per-image observations, correction round 1 (superseded byte sizes below; content pattern unchanged in round 2 except the SLA mix)

- **`ticket-detail.png` / `ticket-detail-dark.png`**: full-page capture (unchanged capture mode from the original round) showing the thread, the internal note, and the AI Activity trail expanded (Triage → Draft generated → Draft approved, "1 citation"). Header "Overdue" badge red, correct. Dark variant matches.
- **`insights.png` / `insights-dark.png`** (the defect-2 fix): full-page capture now shows all four cards complete and uncut — Recurring Issues (five theme groups down to "Password reset failures"), Knowledge-Base Gaps (both Gap-tagged themes with their nearest-article match), Volume Drivers (By Category / By Tag, all the way through By Company / Driftwood Media at the bottom), and SLA & CSAT (breach rate, at-risk count, avg first response/resolution, the full 1-5 star CSAT histogram, and the AI Summary paragraph). Nothing is clipped in either theme.
- **`knowledge-base.png` / `knowledge-base-dark.png`**: unchanged capture mode; byte sizes shifted by <2KB (normal run-to-run noise from `1m ago` vs `1m ago` timestamp rendering, not a content change). All six seeded articles listed, "Embedding..." status shown for all six — this is the correct, honest state for screenshot mode (AI off, KB chunks intentionally unembedded in the seeded demo dataset per the plan's own honesty contract), not a regression or defect.

### Per-image observations, correction round 2 (this round — every asset personally re-read with the Read tool at full resolution)

- **`inbox.png` / `inbox-dark.png`** (437,306 / 444,295 bytes): two-pane list + ticket #11 open in the reading pane. First screenful reads, top to bottom: Owen Castillo "Due in 2h" (on-track), Derek Voss "At risk", Maya Chen "Due in 6h" (on-track), Priya Natarajan #1 "Overdue" (breached, correctly red), Tomas Reyes "Due in 9h" (on-track), Priya Natarajan #2 "Due in 8h" (on-track), Lena Brandt "At risk" — a believable mix (4 on-track / 2 at-risk / 1 breached), not a wall of red. Ticket #11's own header chip reads "At risk" (amber), matching its declared state. No `Due in -` text anywhere. Dark variant: identical content, correct contrast, all three chip colors (muted gray on-track, amber at-risk, red breached) legible against the dark background.
- **`ticket-detail.png` / `ticket-detail-dark.png`** (204,523 / 208,131 bytes): same full-page capture pattern as round 1. Header now correctly reads "At risk" (amber, was previously correct too since ticket #11 was already `at-risk`-declared pre-round-2 — what changed is that the *chip itself* is now honestly at-risk rather than coincidentally rendering the same text while the underlying age/due data was actually wrong). Thread, internal note, and AI Activity trail (Triage → Draft generated → Draft approved, "1 citation") all present and correct in both themes.
- **`insights.png` / `insights-dark.png`** (222,650 / 227,792 bytes): all four cards still complete and uncut post-recapture. SLA & CSAT card now reads "Breach rate 38%, At risk 4, Avg first response 5h 6m, Avg resolution 15h 40m" and the AI Summary narrative ("...8 tickets breached its SLA target and 4 are currently at risk...") is exactly consistent with the reconciled dataset (8 breached / 4 at-risk overall) — not contradicted by, and directly explained by, what the inbox screenshot shows.
- **`knowledge-base.png` / `knowledge-base-dark.png`** (166,451 / 169,057 bytes) and **`settings-ai.png` / `settings-ai-dark.png`** (162,258 / 164,226 bytes, byte-identical to round 1): unaffected by either of this round's defects; re-read anyway per the plan's "read every regenerated PNG yourself" instruction — unchanged from round 1's description.

### Environment note for future re-captures on this machine

Running `pnpm demo:capture` from a Bash tool background shell resolved a standalone pnpm/Node 20.20.2 install first on PATH (three pnpm installs exist on this Windows machine — see project memory `aida-e2e-node-path`), which crashed immediately (`undici`'s `webidl.util.markAsUncloneable is not a function`) before the script did anything (no container was started, so no cleanup was needed). Worked around by prefixing PATH with the pinned Volta Node 22.23.1 image and invoking `tsx` directly via `node node_modules/tsx/dist/cli.mjs scripts/capture-demo-assets.ts [flags]` instead of through the `pnpm demo:capture` wrapper. Not a script bug — purely a background-shell PATH-resolution quirk on this machine, already documented in project memory. In this second correction round, the foreground Bash tool's own PATH already resolved Volta's Node 22.23.1 correctly (`which node` -> `/c/Program Files/Volta/node`), so both `pnpm demo:capture` runs executed via `node node_modules/tsx/dist/cli.mjs scripts/capture-demo-assets.ts [--record]` directly with no PATH workaround needed this time.

## Correction Round 2 (defects found in the maintainer's review of the first-corrected capture)

Commits `61e4d00` (correction round 1) closed two defects, but before Task 3 could run, the maintainer found two more issues in that (still uncommitted-to-Task-3) asset set: the demo dataset's SLA data disagreed with its own declared intent (a direct consequence of the `80aee33` chip-honesty fix exposing stale fixture timestamps), and the hero GIF opened on a blank frame then a loading skeleton. This section documents that second correction round.

### Defect A — SLA timestamps disagreed with declared `slaState` (dataset bug, not a display bug — `80aee33` is correct and was not touched)

**Root cause (confirmed, matching the diagnosis handed to this round):** `src/lib/demo/fixtures.ts` gives each ticket BOTH a declared `slaState` ("on-track"/"at-risk"/"breached") AND an `ageHours`, set independently by hand during 07-02. `seed-demo-data.ts` derives `createdAt = now - ageHours*HOUR`, and computes `firstResponseDueAt`/`resolutionDueAt` from `computeDueTimestamps(createdAt, targets)` — i.e. purely from `ageHours` and the priority's SLA target — while `isBreached`/`isAtRisk` are set directly from the declared `slaState`. Once `SlaDueChip` was fixed (`80aee33`) to trust the clock (`isBreached || isPastDue`) rather than only the `isBreached` flag, any ticket whose `ageHours` already exceeded its priority's relevant SLA target rendered "Overdue" regardless of what it was declared as. 14 of 18 non-resolved tickets were affected.

**Which due timestamp the UI actually renders (confirmed by reading the code, not re-derived from scratch):** both `ticket-list-row.tsx`'s and `ticket-meta-header.tsx`'s identical `getActiveDue()` helper returns `firstResponseDueAt` while `firstRespondedAt` is still null, else `resolutionDueAt` while `resolvedAt` is still null, else `null` (no chip at all — this is why all 12 RESOLVED/CLOSED tickets never show an SLA chip, regardless of their `ageHours`). For tickets that already carry a `firstResponseAfterHours` (i.e. an agent/admin already replied), the RESOLUTION target (24h-72h) governs, not the much smaller first-response target (1h-24h) — several of the 14 mismatches were tickets whose fixture already had a real reply, so the fix path for those was "shrink `ageHours` under the resolution target," not the first-response one.

**Fix:** tuned `ageHours` per mismatched ticket against whichever due timestamp actually governs it, keeping the fix as small as it could honestly be:
- Tickets close to their target already (T2, T4 — this SUMMARY's T-numbers are fixture array position): small `ageHours` reduction, comfortable margin (2h+) against real capture-run drift.
- Tickets with a real prior reply, at-risk/on-track by design (T6, T11 [the star ticket used for every screenshot/GIF], T13, T14, T15, T17, T18): `ageHours` reduced to land within the RESOLUTION target with a real margin (4h-32h depending on priority), keeping `firstResponseAfterHours` unchanged and always `< ageHours` (a reply can never postdate "now").
- Tickets whose original `ageHours` was so far past even the larger resolution target that shrinking it would have been dishonest re-imagining of the whole ticket's story (T5, T7, T8, T10, T12): reclassified `slaState` from "on-track" to "breached", `ageHours` left unchanged — a ticket unresponded-to for 30-200 hours against an 8h-24h target genuinely IS breached; this is more honest than forcing it under an artificial window. T12 additionally had its `ageHours` corrected from 300 to 24 to match its own body text ("...CSV list yesterday..."), a byproduct fix.
- Every reply's `offsetHours` and every `firstResponseAfterHours`/`resolvedAfterHours` that could have postdated a shrunk `ageHours` was checked and adjusted down (T6's and T12's and T17's reply offsets) so no message is ever timestamped after "now".

**Verification (throwaway tsx script, deleted before commit — output captured here and in the executor's report):**

Before (baseline, matching the maintainer's diagnosis exactly): **14/30 mismatches** — every ticket declared on-track or at-risk whose `ageHours` already exceeded its governing SLA target rendered "Overdue" instead.

After: **0/30 mismatches.** Final SLA-state tally across all 30 tickets: **8 breached, 4 at-risk, 18 on-track** (up from the original 3/4/23 — the plan explicitly permits adjusting this distribution "if it produces a better mix," which it does: the previous distribution rendered false because of the timestamp bug, not because it was a deliberately-chosen mix).

**07-02 invariant re-verification (identical before/after the fix, confirmed by the same script):**
- `byStatus`: `{ NEW: 4, OPEN: 9, PENDING: 5, RESOLVED: 8, CLOSED: 4 }` — unchanged.
- `byPriority`: `{ NORMAL: 14, HIGH: 8, URGENT: 3, LOW: 5 }` — unchanged.
- `byAssignee`: `{ unassigned: 8, admin: 11, agent: 11 }` — unchanged.
- Triage distribution: 26 COMPLETED / 1 FAILED / 3 null — unchanged (the `triage` field was never touched).
- Total messages: 80 (30 initial inbound + 50 replies) — unchanged; only existing replies' `offsetHours` were retimed, none added/removed.
- Reply/response timing sanity: 0 problems (every reply `offsetHours` and every `firstResponseAfterHours`/`resolvedAfterHours` is strictly less than its ticket's `ageHours`).
- Re-ran the REAL `pnpm db:seed` against a disposable container (via the capture script) and confirmed the printed summary matches exactly: `tickets: 30, contacts: 12, kbArticles: 6, csatResponses: 8, auditEvents: 37, insightRuns: 3, breached: 8, atRiskOnly: 4` — the 07-07 cold-boot assertions (Ticket 30, Contact 12, KbArticle 6, CsatResponse 8, InsightRun 3 COMPLETED) all hold.
- Period-window population (coupling risk #1): 7-day window went from 11 to 16 tickets (more populated, not less — several tickets that needed shrinking to become honestly on-track/at-risk landed inside 7 days), 30-day window unchanged at 21, 90-day window unchanged at all 30 (all three tabs verified populated with cluster-eligible tags via the live `/insights` screenshots below, not just the static script).
- Insights/inbox consistency (coupling risk #2): the live `/insights?period=30` screenshot's SLA & CSAT card reads "Breach rate 38%, At risk 4" for 21 tickets in that window — arithmetically exactly `8/21`, i.e. every breached ticket in the 30-day window is one of the 8 correctly-reclassified breached tickets; not contradicted by the inbox (which visibly shows one "Overdue" row and several "At risk"/"Due in Xh" rows in its first screenful — see per-image observations). 38% is a real, non-alarming-but-not-flattering number for a demo dataset with several long-neglected backlog tickets; flagged here for the human's awareness rather than further tuned, since tuning it down further would mean either breaking an invariant or reintroducing a timestamp/declared-state mismatch.

**First-screenful mix (the plan's stated goal) — confirmed via both the throwaway script's age-sorted preview AND the actual `inbox.png`/`inbox-dark.png` screenshots:** the seven visible rows (Owen Castillo "Due in 2h", Derek Voss "At risk", Maya Chen "Due in 6h", Priya Natarajan #1 "Overdue", Tomas Reyes "Due in 9h", Priya Natarajan #2 "Due in 8h", Lena Brandt "At risk") are **4 on-track, 2 at-risk, 1 breached** — a believable working mix, not a wall of red and not a wall of green.

### Defect B — hero GIF opened on a blank frame then a loading skeleton (capture-script bug)

**Root cause:** Playwright's `context.newPage()` with `recordVideo` configured starts accumulating video frames the instant the page object is created — before `gotoWarm(page, "/tickets")` even issues its first request. The recorded page's first ~0.8s (at fps=12, roughly 10 frames) was therefore Chromium's blank initial paint followed by `/tickets`'s Suspense loading skeleton while the RSC payload streamed in, exactly the kind of frame the plan's own Task 2 acceptance criteria reject.

**Fix (a trim, not a content edit, per the plan's explicit instruction):** `recordGoldenPath` now records `pageCreatedAt = Date.now()` immediately before `context.newPage()`, then — after the very first `gotoWarm(page, "/tickets") + settle(page)` (the same wait that was already proven to clear the skeleton) — computes `preRollSeconds = (Date.now() - pageCreatedAt) / 1000 + 0.25` (a small safety buffer, since `-ss` before `-i` is a fast/approximate input seek rather than a frame-exact output seek). This measured value (this run: **2.13s**) is passed to `convertToGif`, which applies it as `-ss <preRollSeconds>` BEFORE `-i` on both the `palettegen` and `paletteuse` ffmpeg passes — the palette is generated from the same trimmed range as the final GIF, and the trim reflects the actual measured settle time on THIS run rather than a guessed constant, so it self-adjusts if timing varies on a future machine/run.

**Verification:** rejected the temptation to trust a `select`-filtered frame extraction at face value — first fully sequentially decoded ALL 243 frames of the resulting GIF (no frame skipping, ruling out a GIF disposal/diff-mode compositing artifact a `select` filter could introduce) and read frame 1: the fully-painted, unfiltered `/tickets` inbox with the corrected SLA mix, no blank pixels, no skeleton placeholder shapes. Sampled roughly every 2.5s across the full 20.25s runtime (8 additional samples) plus a denser cluster around the ticket-open moment (see deferred-items.md finding below) — no frame anywhere shows a loading skeleton, an error toast, or a mid-navigation blank screen, satisfying the plan's explicit Task 2 GIF-reject criteria.

### New out-of-scope finding, logged not fixed (see `deferred-items.md`)

While doing the rigorous frame-by-frame GIF check above, found that ticket #11's header `SlaDueChip` ("At risk") is not visible for roughly 4-5 seconds early in the recording (1280px recording viewport) before appearing and staying visible for the rest of the clip. Confirmed this is NOT a rendering-logic bug — the fully-settled static `ticket-detail.png` (1440px viewport, same ticket, same data) shows the chip correctly. Does not match any of the plan's explicit GIF-reject criteria (not a skeleton, not an error, not a blank screen — the page is fully rendered throughout, just missing one badge for a few seconds at a narrower viewport than the screenshot capture uses). Not caused by this round's changes (neither `ticket-meta-header.tsx`/`sla-due-chip.tsx` nor the recording's viewport/choreography were touched by defect A or defect B) — logged to `deferred-items.md` per the SCOPE BOUNDARY rule rather than chased further or silently shipped unmentioned. Flagged for the maintainer's awareness at the Task 3 checkpoint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `TicketListRow` missing `shrink-0`, causing rows to shrink below content height and visually bleed into the next row**
- **Found during:** Task 1, while personally inspecting `inbox.png` with the Read tool per the plan's mandatory visual-inspection requirement
- **Issue:** A ticket with 5 chips (status + priority + SLA + 2 tags) wraps its chip row onto two lines. `TicketListRow`'s `<Link>` (`min-h-[80px]`, no `shrink-0`) is a flex item inside `TicketListPanel`'s flex-column `<aside overflow-y-auto>`. Once the panel's 30 rows' cumulative natural height exceeded the aside's available space, flexbox's default shrink behavior compressed this row back down to exactly `min-h-[80px]` — `min-height` alone does not protect a flex item from shrinking below its content (a CSS flexbox nuance: an explicit `min-height` removes the implicit "don't shrink below content" floor flex items get from `min-height: auto`). The wrapped second line (a tag chip + the assignee avatar) then rendered outside the row's box, visually overlapping the next row's name/timestamp.
- **Fix:** Added `shrink-0` to the row's className.
- **Files modified:** `src/app/(app)/tickets/ticket-list-row.tsx`
- **Verification:** Reproduced live via `getBoundingClientRect`/`scrollHeight` (`offsetHeight: 80` vs `scrollHeight: 111` before; `offsetHeight: 124` vs `scrollHeight: 123` after — content-height and box-height converged), then re-ran the full capture and re-inspected `inbox.png`/`inbox-dark.png` with the Read tool: clean, no overlap.
- **Committed in:** `c64ead3` (Task 1 commit)

---

**2. [Rule 1 - Bug, found via a subsequent maintainer review, not by this executor] `SlaDueChip` printed a signed negative countdown ("Due in -22h") instead of "Overdue" for past-due tickets**
- **Found during:** the maintainer's own review of the first capture (between Task 2 committing and Task 3 running) — see "Correction Round" section above for the full writeup
- **Issue:** `isBreached`/`isAtRisk` are only refreshed by a recurring worker job; between runs a ticket can be genuinely past due with both flags `false`, and the on-track chip branch printed `formatDueDuration`'s signed output unconditionally
- **Fix:** `SlaDueChip` now renders "Overdue" when `isBreached || isPastDue` (a locally-computed `dueAt < now`); DB flags still drive filtering/reporting
- **Files modified:** `src/components/tickets/sla-due-chip.tsx`
- **Verification:** `tsc --noEmit` and biome clean; `tests/e2e/sla.spec.ts` unaffected (asserts against a future-due ticket); full asset re-capture in this round confirms no `Due in -` text survives in any PNG or GIF frame
- **Committed in:** `80aee33` (prior to this correction round; not re-touched by it)

**3. [Rule 1 - Bug fix applied by this executor] `insights.png`/`insights-dark.png` viewport-clipped Volume Drivers and SLA & CSAT cards**
- **Found during:** maintainer review, delegated to this executor as "defect 2" to fix
- **Issue:** insights capture used the fixed `1440x900` viewport with `fullPage:false`; the two bottom cards run taller than 900px once populated
- **Fix:** switched to `fullPage:true, scale:"css"` (identical pattern to `ticket-detail.png`) — full cards render, PNG stays under the 500KB ceiling
- **Files modified:** `scripts/capture-demo-assets.ts`; regenerated `docs/assets/insights.png`, `insights-dark.png` (and, as a side effect of the required full re-capture, all other screenshots + the GIF)
- **Verification:** read both corrected images in full; confirmed all four cards (Recurring Issues, KB Gaps, Volume Drivers, SLA & CSAT) render completely with no clipping
- **Committed in:** `61e4d00`

**4. [Rule 1 - Bug, correction round 2] Demo dataset's `ageHours`/`slaState` fixture values disagreed with the SLA due-timestamp math, once the chip started trusting the clock**
- **Found during:** maintainer review, delegated to this executor as "defect A" to fix
- **Issue:** 14 of 18 non-resolved tickets rendered "Overdue" despite being declared `on-track`/`at-risk` — the fixture's `ageHours` for those tickets already exceeded the governing SLA target (first-response or resolution, whichever `getActiveDue()` selects), independent of the declared `slaState`
- **Fix:** tuned `ageHours` (and the interacting reply `offsetHours`/`firstResponseAfterHours`) for 9 tickets to genuinely fit their declared on-track/at-risk intent with a real margin; reclassified 5 tickets (T5/T7/T8/T10/T12) from on-track to breached rather than forcing an artificial age shrink, since they were genuinely, honestly past due
- **Files modified:** `src/lib/demo/fixtures.ts`
- **Verification:** throwaway tsx script mirroring `getActiveDue()`/`SlaDueChip` exactly — 0/30 mismatches (was 14/30); every 07-02 invariant re-checked and unchanged (status/priority/assignee distributions, 26/1/3 triage split, 80 total messages, 0 reply-timing problems); real `pnpm db:seed` run against a disposable container confirmed the exact same counts; all three Insight period tabs confirmed populated
- **Committed in:** `432d41f`

**5. [Rule 1 - Bug, correction round 2] Hero GIF opened on a blank frame then the `/tickets` loading skeleton**
- **Found during:** maintainer review, delegated to this executor as "defect B" to fix
- **Issue:** Playwright's `recordVideo` starts accumulating frames at `context.newPage()`, before the first navigation settles — the first ~0.8s of the GIF (at fps=12) was Chromium's blank paint + the loading skeleton
- **Fix:** measure the real elapsed time from page creation to the end of the first `settle()` call, pass it to `convertToGif` as an ffmpeg `-ss` input-seek offset (plus a 0.25s buffer) applied identically to both the palettegen and paletteuse passes — a trim, not a re-render
- **Files modified:** `scripts/capture-demo-assets.ts`
- **Verification:** fully sequentially decoded all 243 frames of the resulting GIF (not a `select`-filtered extraction, to rule out a GIF disposal-compositing artifact) and confirmed frame 1 is the fully-painted `/tickets` inbox; sampled across the full 20.25s timeline with no skeleton/blank/error frame found anywhere
- **Committed in:** `1e7efef` (script fix), `6ab9240` (re-capture)

**Total deviations:** 5 (1 auto-fixed by the original Task 1 execution; 1 fixed by the maintainer/a prior session between Task 2 and Task 3; 1 fixed in correction round 1; 2 fixed in this correction round 2)
**Impact on plan:** Two real, previously-undiscovered product/tooling issues (the ticket-list shrink bug, and the SLA chip's signed-countdown display bug) surfaced specifically because this plan's asset-capture and review process exercises real seeded data and demands personal visual inspection — exactly what the plan's honesty constraint is designed to catch. Both are fixed at the source, not worked around in the capture script. The insights clipping (round 1) and the SLA-data/GIF-pre-roll defects (round 2) were capture-script/fixture-data issues, not product bugs, and are now fixed at their respective sources. One new out-of-scope finding (ticket #11's SLA chip briefly not visible early in the GIF at the 1280px recording viewport) was found during round 2's rigorous frame-by-frame verification and logged to `deferred-items.md` rather than fixed, per the SCOPE BOUNDARY rule (not caused by either of this round's changes).

## Known Stubs

None in shipped product code. The one stub that exists — a local HTTP server speaking the Ollama protocol, used by `scripts/capture-demo-assets.ts --record` to drive a live "Generate draft" click for the hero GIF — is capture-tooling only, lives entirely inside the script, and never ships. See "Caption obligation for Plan 07-10" above for the disclosure requirement this creates.

## Issues Encountered

Several real issues surfaced and were fixed live during this plan (all documented in code comments in `scripts/capture-demo-assets.ts`):

1. **`next start` incompatible with `output: "standalone"`.** Passed its own `/api/health` check, but Next.js itself warned it doesn't work with standalone output, and real sign-in hung. Switched to always preferring the standalone `server.js` path when a standalone build exists.
2. **Stale build cache broke browser sign-in.** `NEXT_PUBLIC_APP_URL` is inlined into the client bundle at `next build` time, not read at server runtime. A `.next/BUILD_ID`-only cache check reused an old build inlined for a different origin, causing `authClient`'s sign-in POST to target the wrong port (`net::ERR_CONNECTION_REFUSED`). Fixed with a `capture-build-marker.json` that records which `BASE_URL` the cached build was produced for, forcing a rebuild on mismatch.
3. **Chromium screenshot "ghosting" investigation.** Initially suspected a headless-Chromium/Windows GPU-compositing artifact (identical byte-for-byte output across reruns, reproduced at both `deviceScaleFactor:1` and `:2`, survived a hard reload). Traced it to the real DOM via `getBoundingClientRect`/`scrollHeight` — confirmed it was issue #1 above (the `shrink-0` bug), not a rendering artifact. Documented as a lesson: always verify against real DOM geometry before assuming a browser bug.
4. **Embedding-stub citation precision.** The first version of the deterministic keyword-bucket "embedding" stub used simple `OR`-keyword substring matching per chunk; this caused a real false-positive (the recorded draft, about password reset, initially cited "Setting up two-factor authentication" because that article's chunk happened to mention "password" once, in an unrelated sentence). Fixed with proximity-based matching (`wordsNear`, requires the words within 80 characters of each other) — verified the fix by extracting and reading individual GIF frames at the exact moment the DraftCard renders, three times, until the citation was correct.
5. **Next.js App Router client-transition flake against `page.waitForURL`.** The identical filter-click code path succeeded in one run and timed out in the next with no code change — traced to `waitForURL`'s event-based (not purely polling-based) semantics not reliably catching same-document History API transitions. Replaced with a plain `page.url()` polling loop (`pollUrl`).
6. **A `finally`-block exception masked the real error.** `teardown()`'s temp-dir `fs.rmSync` calls initially weren't wrapped in try/catch; a Windows `EBUSY` (file still locked immediately after `context.close()` flushed the video) replaced the actual `recordGoldenPath` error in the thrown exception (standard JS semantics: a `finally` throw overrides the `try` block's throw). Fixed by wrapping cleanup in try/catch with `maxRetries`/`retryDelay`, which also surfaced issue #5 above.

None of these blocked completion; all are fixed and verified in the committed script/product code.

## User Setup Required

None — this plan's tooling requires no external service configuration. `ffmpeg` and Docker were already verified available in the execution environment per this plan's `<execution_environment>` block.

## Task 3 — Human sign-off: APPROVED (2026-08-01)

**Verdict (verbatim): "Approved all".**

Presented to the maintainer against the twice-corrected asset set (commits `80aee33`, `61e4d00`, `432d41f`, `1e7efef`, `6ab9240`), together with the full manifest, per-image observations, and both honestly-disclosed imperfections below. The maintainer approved the complete set — including, explicitly, the two flagged items, neither of which they asked to change.

**Lead screenshot: not named in the reply.** The verdict was a blanket approval rather than a selection. **Default for Plan 07-10: `docs/assets/inbox.png`**, on the rationale presented at sign-off — the shared inbox is the product's core surface, it now shows a believable SLA mix (`Due in 2h` / `At risk` / `Due in 6h` / `Overdue` / `Due in 9h` / `Due in 8h`) rather than a wall of red, and it carries the two-pane reading view in the same frame. 07-10 may substitute `insights.png` (leads with the AI differentiator) or `ticket-detail.png` (leads with human-in-the-loop AI) without re-opening this checkpoint — this is a copywriting choice, not an asset-quality one.

**Dark-mode review: CLOSED.** This sign-off discharges the `DESIGN-SYSTEM.md` §9 "Dark mode diuji" item that had been carried forward as an open human-verification item since Phases 4, 5 and 6. All five dark variants were reviewed at full resolution — correct token usage, legible contrast, amber internal-note accent and indigo brand preserved.

**Approved-as-is, explicitly flagged before approval (both remain logged in `deferred-items.md`):**
1. **GIF only — ticket #11's "At risk" chip is not visible for ~4-5s** after the ticket opens, at the 1280px recording viewport. Confirmed correct in the 1440px static `ticket-detail.png`, so this is a recording-viewport layout shift, not a rendering-logic bug. Matches none of the plan's explicit GIF-reject criteria (no skeleton, no error, no blank screen).
2. **30-day breach rate reads 38%** on the SLA & CSAT card. Real and arithmetically exact (`8/21` in that window), consistent with the inbox's visible Overdue rows, and honest — accepted rather than tuned, since tuning it further would mean breaking a 07-02 invariant or reintroducing a timestamp/declared-state mismatch.

**Caption obligation carried to Plan 07-10 (unchanged by this approval):** the README caption under the hero GIF MUST state that the model behind the recorded live "Generate draft" segment is a **local Ollama-protocol stub used only for this recording**, and that AIDA works with OpenAI, Anthropic, or a real local Ollama model.

## Next Phase Readiness

Task 3 is resolved; this plan is complete. Wave 3 (07-07 + 07-08) is done.

- 07-10 (README) can now treat `docs/assets/` as final and embed these exact paths, subject to the caption obligation above.
- 07-09 (security pass) should pick up the three `deferred-items.md` entries logged during this wave: the `POSTGRES_PASSWORD` URL-encoding trap, the pre-existing third `signUpEmail` call site in the `/setup` wizard, and the GIF viewport item.
- AIDA-23 remains intentionally `Pending` in REQUIREMENTS.md — it spans seven Phase-7 plans and 07-10 is the plan that finishes its substance (README + docs site). This mirrors the AIDA-05/AIDA-09 split-requirement precedent.

---

## Addendum (2026-08-01): assets re-captured for the WCAG AA contrast fix

`tests/e2e/a11y-contrast.spec.ts` (added in 07-09.1) found 5 genuine color-contrast bugs across `--primary`/`--success`/`--muted-foreground` (full writeup and before/after ratios in `deferred-items.md`'s "From 07-09.1" entry and `07-09.1-SUMMARY.md`'s addendum). Fixing them shifted several token lightness values and a hover mechanism — a real, if subtle, visual change to badges, buttons, and some text colors in both themes.

**Every asset in this plan's manifest was re-captured** against the corrected tokens: all 10 original screenshots (`inbox`, `ticket-detail`, `insights`, `knowledge-base`, `settings-ai` × light/dark), the hero GIF, and the two 07-09.1-added surfaces (`kb-new`, `kb-article` × light/dark) plus the in-flight draft-card stills. All were re-run through `pnpm demo:capture` and `pnpm demo:capture -- --record` against a live Testcontainer + the real production build, then read and visually reviewed image-by-image (not just size-diffed):

- Content, copy, layout, and the demo dataset's SLA mix are **byte-for-byte unchanged in substance** — same tickets, same believable Due-in/At-risk/Overdue spread, same golden-path steps, same 21% CSAT/38% breach-rate numbers this plan's Task 3 sign-off already reviewed.
- Only colors shifted, and only where the contrast fix required it: badges/buttons render with very slightly different indigo/violet and green tones (imperceptible at a glance, confirmed by direct comparison), and previously low-contrast text (the dark-theme "AI Draft" label, KB citation links, sidebar avatar initials, the AI Activity event count) is now more legible than before — a visual improvement, not a regression.
- The hero GIF's first frame is still a fully-painted inbox (verified by extracting frame 0 with ffmpeg) — no blank frame, no loading skeleton, matching this plan's own GIF-reject criteria from the Correction Round 2 section above. Total recording runtime 24.4s, pre-roll trim 2.05s — consistent with the already-approved timing.
- `/insights` is still full-page and complete in both themes (no clipping — the defect this plan's Correction Round 1 originally fixed).

**The maintainer's Task 3 approval above stands on content.** Nothing about the approved dataset, golden path, or page composition changed — only the token-level color correction from 07-09.1's follow-up. No new sign-off round is needed for this plan's own scope; this addendum exists so the asset provenance stays honest (these exact PNG/GIF bytes are the corrected-color set, not the ones originally approved).

---
*Phase: 07-launch-readiness*
*Completed: 2026-08-01 — all 3 tasks, Task 3 approved by the maintainer*
