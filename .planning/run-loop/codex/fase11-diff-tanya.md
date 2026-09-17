# Fase 11 Inbox: kritik diff fase (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang dikritik

Kode Fase 11 sudah dieksekusi. Karena ekspor tidak punya riwayat git, ini daftar berkas produk yang berubah di fase ini:

- Skema dan migrasi: `prisma/schema.prisma`, `prisma/migrations/*_inbox/migration.sql`.
- Inti: `src/lib/membership.ts`, `src/lib/session.ts`, `src/lib/tickets/mutations.ts`, `src/lib/tickets/list-filters.ts`, `src/lib/tickets/list-query.ts`, `src/lib/tickets/auto-close-days.ts`, `src/lib/tickets/auto-close-settings.ts`, `src/lib/tickets/reopen-on-reply.ts`, `src/lib/worker/jobs/auto-close.ts`, `src/lib/worker/index.ts`, `src/lib/saved-views/` (service dan `ui-state.ts`), `src/lib/commands/`, `src/lib/keyboard/`, `src/lib/authz.ts`.
- Jalur yang diubah: `src/app/(app)/tickets/[id]/actions.ts`, `src/lib/channels/email/ingest-message.ts`, `src/app/api/public/status/[token]/follow-up/route.ts`, route pencarian palette, `src/app/(app)/contacts/contact-search.tsx`, dan worker triage AI.
- UI: `src/app/(app)/tickets/` (panel daftar, baris, strip, dialog view, bar aksi massal, `list-panel-focus.tsx`), `src/components/` (sidebar views, palette, modal bantuan), `src/app/(app)/settings/sla/` (kartu auto-close), `docs/KEYBOARD.md`, `README.md`.
- Test: `tests/unit/`, `tests/integration/` (inbox-schema, ticket-mutations, saved-views, palette-search, auto-close, reply-reopen-race, triage-priority-race), `tests/e2e/` (mutations, saved-views, bulk-actions, command-palette, keyboard, auto-close), `tests/support/lock-wait.ts`.

Konteks: `.planning/phases/11-inbox/11-CONTEXT.md` (D-01 sampai D-24, dengan amandemen D-16 dan D-17), `11-UI-SPEC.md`, `11-0*-SUMMARY.md`, `11-GATE.md`, `11-REVIEW.md` (code review GSD dan status perbaikannya), `deferred-items.md`, dan `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Gerbang fase di commit `9523eac`: `lint`, `typecheck`, `test` (222), integration tanpa berkas egress (129), E2E penuh (111 lolos, 1 skip lama), dan `build` semuanya exit 0; `audit --prod` exit 1 dengan angka yang sama dengan baseline; integration penuh dan `test:egress` blocked (O-1).
- Code review GSD: 0 critical, 2 warning, 7 info. Tujuh diperbaiki dengan test; IN-02 dan IN-03 tidak diubah, dengan alasan. Sesudahnya saya mengubah aturan admin menjadi pencocokan persis (`owner` atau `admin`), karena perbaikan IN-05 sempat melonggarkan gerbang v1 dengan menerima peran gabungan.
- Tiga perbaikan selama eksekusi: fokus sesudah hapus view; flake test bulk-tag (animasi popover); dan bug lama v1 di `contact-search.tsx` yang memanggil `router.replace` 300 ms sesudah halaman dimuat.
- Password container dev tidak ada di berkas tracked.

## Pertanyaan

Untuk setiap temuan: berkas dan baris, bukti, dampak, dan perbaikan konkret. Severity HIGH (celah keamanan atau tenancy, data salah, melanggar piagam, atau acceptance yang sebenarnya tidak terpenuhi), MEDIUM, atau LOW.

1. **Tenancy dan otorisasi.** Apakah setiap baca dan tulis baru ter-scope ke organisasi aktor, termasuk SQL mentah? Apakah ada jalur di mana view privat, tiket organisasi lain, atau hasil pencarian palette bisa bocor? Apakah cek keanggotaan D-01 benar di keempat jalur, dan apakah aturan admin yang persis konsisten di semua tempat?
2. **Konkurensi.** Lock-dulu di kedua jalur balasan, `UPDATE` bersyarat di job auto-close, lock baris setting, transaksi aksi massal, dan race prioritas triage AI. Apakah ada urutan yang masih salah atau deadlock?
3. **Paritas dan regresi.** Apakah action satu tiket berperilaku sama dengan sebelum fase (SLA, `resolvedAt`, flag, `triggeredReopen`)? Apakah perbaikan `contact-search.tsx` dan dispatcher keyboard merusak alur lain?
4. **Test.** Adakah test yang tidak bisa gagal, menguji hal yang salah, atau hanya lolos karena timing?
5. **Piagam.** Egress baru, sesuatu yang sampai ke pelanggan saat auto-close, inline script, warna yang di-hardcode, `.env`, rahasia, nama orang atau path rumah, atau klaim lulus untuk hasil merah.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah fase ini layak lanjut ke verifikasi. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.400 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
