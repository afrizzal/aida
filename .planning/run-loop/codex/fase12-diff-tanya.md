# Fase 12 Siklus tiket: kritik diff fase (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang dikritik

Kode Fase 12 (AIDA-52 sampai AIDA-55: relasi, merge, snooze, feed aktivitas) sudah dieksekusi (10 plan), di-review, dan diperbaiki. Karena ekspor tidak punya riwayat git, ini daftar berkas produk yang berubah di fase ini:

- Skema dan migrasi: `prisma/schema.prisma`, `prisma/migrations/20261109100000_ticket_lifecycle/migration.sql`.
- Inti: `src/lib/tickets/` (`merge.ts`, `relations.ts`, `relation-pairs.ts`, `snooze.ts`, `status-visibility.ts`, `status-page-data.ts`, `ticket-picker.ts`, `activity-feed.ts`, `activity-copy.ts`, `lifecycle-copy.ts`, `ticket-detail-data.ts`, `list-filters.ts`, `list-query.ts`, `reopen-on-reply.ts`), `src/lib/worker/jobs/snooze-wake.ts`, `src/lib/worker/jobs/auto-close.ts`, `src/lib/worker/index.ts`, `src/lib/scoped-db.ts`, `src/lib/attachments/staged-files.ts`, `src/lib/channels/email/ingest-message.ts`, `src/lib/demo/seed-demo-data.ts`.
- Jalur: `src/app/(app)/tickets/[id]/` (`merge-actions.ts`, `relation-actions.ts`, `snooze-actions.ts`, `page.tsx`), `src/app/api/tickets/[id]/messages/route.ts`, `src/app/api/tickets/picker/route.ts`, `src/app/(public)/status/[token]/page.tsx`, `src/app/api/public/status/[token]/attachments/[id]/route.ts`, `src/app/api/public/status/[token]/follow-up/route.ts`.
- UI: `src/components/tickets/` (dialog link dan merge, picker, chip relasi, kontrol snooze, banner sumber merge, feed, baris event, `local-date-time.tsx`, `thread-message.tsx`, menu aksi, header meta), `src/app/(app)/tickets/` (baris filter, dialog simpan view, panel daftar, baris daftar), `README.md`.
- Test: `tests/integration/` (lifecycle-schema, ticket-relations, ticket-picker, ticket-merge, merge-provenance, merge-reply-race, merge-race-coverage, snooze, snooze-race, activity-feed, email-ingest, reply-reopen-race), `tests/unit/` (activity-feed, lifecycle-helpers, snooze-filters, staged-files), `tests/e2e/` (ticket-relations, ticket-merge, snooze, activity-feed), `tests/support/lifecycle-fixtures.ts`, `tests/support/lock-wait.ts`.

Konteks: `.planning/phases/12-ticket-lifecycle/12-CONTEXT.md` (D-01 sampai D-23, D-09 diamandemen), `12-UI-SPEC.md`, `12-0*-SUMMARY.md`, `12-GATE.md`, `12-REVIEW.md` (bagian a dan disposisi untuk ketiga bagian), `12-REVIEW-b.md`, `12-REVIEW-c.md`, `12-REVIEW-FIX.md`, `deferred-items.md`, `.planning/run-loop/codex/fase12-plan-jawab*.md` (review plan-mu), dan `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Code review GSD atas 47 berkas, dalam tiga bagian: 0 critical, 13 warning, 12 info. Semua warning dicek ke kode dan diperbaiki dalam tiga pass, satu commit per temuan, dengan test yang terlihat gagal sebelum perbaikan untuk setiap perubahan perilaku. IN-05 (branding halaman status memakai organisasi pertama, sejak v1) dan IN-06 (penanda reopen di bawah header CLOSED pada sumber merge) ditunda di `deferred-items.md`.
- Keputusan run K34: menambah link ditolak bila salah satu tiket adalah sumber merge (`TICKET_UNAVAILABLE`); UI menandai sumber merge di picker link dan menonaktifkan "Link a ticket…" di halaman sumber merge.
- Provenance: `Message.seq` dan `Ticket.mergeMessageSeq` diambil di bawah kedua row lock; token sumber melihat pesan target hanya bila `mergedFromTicketId = self`, atau `mergedFromTicketId IS NULL AND seq > mergeMessageSeq`. Semua insert pesan ke tiket yang sudah ada memegang row lock lewat `lockTicketsInIdOrder`.
- Gerbang ulang sesudah perbaikan, di commit `06279f9` (`12-GATE.md`, bagian "Rerun after the code review fixes"): `lint`, `typecheck`, `test` (273), integration tanpa egress (32 berkas, 278), E2E penuh (158 lolos, 1 skip lama, 0 gagal), dan `build` semuanya exit 0; `audit --prod` exit 1 dengan angka baseline (7 critical, 52 high). Integration penuh dan `test:egress` blocked (owner O-1).

## Pertanyaan

Untuk setiap temuan: berkas dan baris, bukti, dampak, dan perbaikan konkret. Severity HIGH (celah keamanan atau tenancy, kebocoran pesan antar link status, data salah, melanggar piagam, atau acceptance yang sebenarnya tidak terpenuhi), MEDIUM, atau LOW.

1. **Provenance link status.** Apakah ada jalur (halaman, route lampiran, follow-up, email masuk, CSAT, seed demo, unmerge atau unlink) yang membuat pemegang token melihat pesan atau lampiran yang tidak diizinkan D-09? Apakah ada insert pesan ke tiket yang sudah ada tanpa row lock?
2. **Konkurensi.** Merge melawan balasan, follow-up, merge ulang, snooze, wake, dan auto-close; savepoint dan relock; urutan lock; update bersyarat. Adakah urutan dengan hasil tidak terdefinisi, deadlock, atau test race yang lolos karena timing dan bukan karena lock?
3. **Tenancy dan otorisasi.** Apakah setiap baca dan tulis baru ter-scope ke organisasi aktor, termasuk SQL mentah, dan apakah setiap jalur baru atau yang ditulis ulang memeriksa keanggotaan aktif?
4. **Perbaikan review.** Apakah perbaikan di `12-REVIEW-FIX.md` benar-benar menutup temuannya, dan apakah ada yang membuka masalah baru (misalnya fokus, state picker yang diangkat ke alur merge, label link dari picker, test zona waktu yang memilih zona viewer dari zona host)?
5. **Test.** Adakah test yang tidak bisa gagal, menguji hal yang salah, atau hanya lolos karena jam atau timing?
6. **Piagam.** Egress baru, sesuatu yang sampai ke pelanggan tanpa persetujuan manusia, inline script, warna yang di-hardcode, `.env`, rahasia, nama orang atau path rumah, atau klaim lulus untuk hasil merah.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah fase ini layak lanjut ke verifikasi. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.400 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
