# Fase 13 Integrasi: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Konteks

- Keputusan fase D-01 sampai D-26: `.planning/phases/13-integrations/13-CONTEXT.md` (sesudah brainstorm-mu, `.planning/run-loop/codex/fase13-jawab.md`).
- UI: `.planning/phases/13-integrations/13-UI-SPEC.md` (draft, asumsi bertanda `[RL]`).
- Plan yang direview: `.planning/phases/13-integrations/13-01-PLAN.md` sampai `13-18-PLAN.md` (8 wave, satu migrasi `20261117100000_integrations`).
- Requirement: `.planning/REQUIREMENTS.md` AIDA-58 sampai AIDA-63; ROADMAP Fase 13.
- Batas mengikat: piagam `.planning/run-loop/PIAGAM.md` (Larangan, aturan J, "Aturan teknis AIDA": egress baru wajib terdaftar di `tests/integration/egress-isolation.test.ts`; payload webhook adalah input tidak tepercaya; adapter hanya diuji dengan server tiruan; tanpa kredensial asli), `CLAUDE.md`, `.planning/DESIGN-SYSTEM.md`. `docs/SECURITY.md` diblokir butir owner 08-o4. Butir owner 13-o1: semua egress mati secara default.

## Penyimpangan planner yang perlu dinilai

- Aksi audit tambahan `API_TICKET_CREATED`, `API_NOTE_ADDED`, `WEBHOOK_DELETED`.
- Pelindung produksi selalu menolak loopback; server tiruan E2E mendengarkan di IPv4 privat mesin dan server E2E meng-allowlist satu /32 itu lewat `AIDA_EGRESS_ALLOW_PRIVATE_CIDRS` (blocked bila mesin tanpa alamat privat).
- Gerbang compose `not run` sampai harness Fase 8.1.
- PATCH satu field per permintaan; ditambah GET /states dan /members.
- `retryDelayMax` pg-boss 12.23.0 dipakai.
- Beberapa task tracer menyentuh lebih dari 5 berkas.

## Pertanyaan

1. Apakah ke-18 plan menerapkan D-01 sampai D-26 dengan benar dan lengkap, dan apakah AIDA-58 sampai AIDA-63 benar-benar tercakup? Sebut task yang salah, kurang, atau bertentangan.
2. Keamanan: apakah ada celah pada token (penyimpanan, scope, pencabutan, pembuat yang diturunkan), jalur proxy `/api/v1/` dan gerbang inventaris, isolasi tenant setiap route API, tanda tangan dan replay webhook, SSRF (DNS rebinding, redirect, IPv6, IP terenkode), sinkron masuk (replay, loop, payload tidak tepercaya), dan audit?
3. Ketepatan dan operasi: outbox dan retry, nonaktivasi otomatis, retensi, race dengan perubahan tiket, urutan wave, migrasi lewat aturan J, test (isolasi tanpa mock, inventaris, paritas OpenAPI, E2E lewat UI nyata).
4. Apakah penyimpangan planner di atas dapat diterima?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan, task, dan baris. Lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1000 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
