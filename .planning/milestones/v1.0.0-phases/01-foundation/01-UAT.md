---
status: complete
phase: 01-foundation
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md, 01-07-SUMMARY.md, 01-08-SUMMARY.md]
started: 2026-07-01T13:01:22Z
updated: 2026-07-01T13:36:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running stack (`docker compose down`), then `docker compose up -d` from scratch. Postgres+pgvector becomes healthy, migrate applies the init migration, app shows (healthy), worker logs "[worker] started", Caddy serves. `curl http://localhost/api/health` returns 200 with `{"status":"ok","db":"connected"}`. Nothing stuck restarting.
result: pass

### 2. First-Run Setup Wizard
expected: Open http://localhost → redirected to /setup. Fill workspace name + admin name/email/password (slug auto-derives). Click "Create workspace" → redirected to /login with a success toast ("Workspace created. Sign in to continue.").
result: pass

### 3. Setup Self-Disable + No Public Register
expected: Navigate to http://localhost/setup again after setup completed → redirected to /login. There is NO "Create account" / public register / social-login / "Forgot password" link anywhere on the auth pages.
result: pass

### 4. Login — Wrong Then Correct Credentials
expected: On /login, enter a wrong password → inline error "Invalid email or password…" (inline text, not a toast). Then sign in with correct credentials → lands on /tickets.
result: pass

### 5. App Shell — Sidebar, Top Bar, Navigation
expected: Sidebar (~240px) shows AIDA wordmark + Tickets / Knowledge Base / Settings with icons and an active highlight on the current page. Top bar (~56px) shows the page title on the left and theme toggle + avatar on the right. Navigating Tickets ↔ KB updates the title, active highlight, and shows a polished empty state ("Your inbox is empty" / "No articles yet").
result: pass

### 6. Dark Mode Toggle
expected: Click the Sun/Moon toggle in the top bar → the entire UI switches light ↔ dark cleanly (no unstyled flashes). The choice persists after a full page reload. Both modes look polished.
result: pass

### 7. Settings AI Toggle Persistence
expected: Go to Settings → AI Features. The toggle is OFF by default. Turn it ON and reload → still ON. Turn it OFF and reload → still OFF. State persists across reloads (stored per-workspace).
result: pass

### 8. Server-Side Auth Guard
expected: Sign out via the user menu. Then manually visit http://localhost/tickets while signed out → redirected to /login (enforced server-side, not just hidden in the UI).
result: pass

### 9. Worker Heartbeat Liveness
expected: `GET http://localhost/api/health` returns 200 JSON where `worker.lastRunAt` is a recent ISO-8601 timestamp. Wait ~60s and re-check → `lastRunAt` has advanced (the pg-boss heartbeat job runs every minute).
result: pass
note: "Verified live via curl -sSL -k https://localhost/api/health → {\"status\":\"ok\",\"db\":\"connected\",\"worker\":{\"lastRunAt\":\"2026-07-01T13:35:13.861Z\"}}"

## Summary

total: 9
passed: 9
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
