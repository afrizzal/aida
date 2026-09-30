# Fase 12.1 Status kustom dan jeda SLA: kritik diff fase (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang dikritik

Kode Fase 12.1 (AIDA-56, AIDA-97, AIDA-57) sudah dieksekusi (17 plan), di-review, dan diperbaiki. Berkas produk yang berubah: dua migrasi `prisma/migrations/20261110100000_ticket_states` dan `20261110110000_ticket_state_fk_on_update_restrict`, `prisma/schema.prisma`; `src/lib/tickets/` (`ticket-states.ts`, `state-transition.ts`, `ticket-state-admin.ts`, `mutations.ts`, `create-ticket.ts`, `merge.ts`, `snooze.ts`, `reopen-on-reply.ts`, `status-page-data.ts`, `ticket-picker.ts`, `palette-search.ts`, `search.ts`, `list-filters.ts`, `list-query.ts`, `list-panel-data.ts`, `activity-feed.ts`, `activity-copy.ts`, `ticket-detail-data.ts`, `state-colors.ts`, `state-copy.ts`), `src/lib/worker/jobs/sla-flag.ts`, `auto-close.ts`, `src/lib/saved-views/service.ts`, `src/lib/demo/seed-demo-data.ts`, `src/lib/channels/email/`, `src/lib/scoped-db.ts`; route dan halaman di `src/app/(app)/settings/statuses/`, `src/app/(app)/tickets/`, `src/app/(app)/contacts/[id]/`, `src/app/(public)/status/[token]/`, `src/app/api/`; komponen di `src/components/tickets/` dan `src/components/command-palette.tsx`; `src/app/globals.css`; test di `tests/`.

Konteks: `.planning/phases/12.1-ticket-lifecycle-custom-states-and-sla-pause/` (`12.1-CONTEXT.md` dengan amandemen K40 sampai K43, `12.1-UI-SPEC.md`, `12.1-REVIEWS.md`, SUMMARY tiap plan, `12.1-GATE.md`, `12.1-REVIEW*.md` dan `12.1-REVIEW-FIX.md`), `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Code review GSD empat bagian: 0 critical, 10 warning, semuanya diperbaiki (pass F1 server, F2 UI) dengan test yang terlihat gagal lebih dulu kecuali dua yang tidak teramati; disposisi di `12.1-REVIEW.md`; keputusan K44 (loader halaman kontak memeriksa keanggotaan).
- Gerbang ulang di `414966d`: `lint` 0, `typecheck` 0, `test` 383, integration tanpa egress 490, E2E penuh 192 lolos (1 skip lama), `build` 0; `audit --prod` 1 baseline; egress blocked (O-1).
- Jalur deploy sungguhan Prisma 7.8.0 (plan 03): migrasi yang gagal di-rollback penuh tetapi meninggalkan baris `_prisma_migrations` gagal; pemulihan `migrate resolve --rolled-back` lalu deploy, tercatat di README.

## Pertanyaan

Untuk setiap temuan: berkas dan baris, bukti, dampak, dan perbaikan konkret. Severity HIGH (kebocoran tenancy atau nama state ke publik, data salah atau hilang, deadlock, filter yang melebar, melanggar piagam), MEDIUM, atau LOW.

1. Tenancy, privasi publik (D-13), dan cek keanggotaan di setiap jalur baru.
2. Konkurensi: urutan lock config, state, tiket; soft delete melawan penulis; worker `sla-flag` dengan `SKIP LOCKED`; jeda dan resume; merge sumber pending; reopen; auto-close.
3. Akuntansi jeda SLA (AIDA-57) dan migrasi data (AIDA-56) termasuk saved view dan URL lama yang gagal tertutup.
4. Pengelolaan state (AIDA-97): K40, K41, K42, penghapusan berbasis set, dan UI admin (fokus, copy).
5. Test yang tidak bisa gagal atau lolos karena timing; acceptance yang hanya lolos lewat grep.
6. Piagam: egress baru, sesuatu sampai ke pelanggan tanpa manusia, warna hardcode, `.env`, rahasia, nama orang atau path rumah, klaim lulus untuk hasil merah.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah fase ini layak lanjut ke verifikasi. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.300 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
