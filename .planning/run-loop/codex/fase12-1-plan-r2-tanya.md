# Fase 12.1 Status kustom dan jeda SLA: review plan (siklus 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan siklus 1

Di siklus 1 (`.planning/run-loop/codex/fase12-1-plan-jawab.md`) kamu memberi 9 temuan: C1 sampai C3 HIGH, C4 sampai C8 MEDIUM, C9 LOW. Semua dicek ke plan dan kode dan diterima; disposisinya ada di `.planning/phases/12.1-ticket-lifecycle-custom-states-and-sla-pause/12.1-REVIEWS.md`. Replan `--reviews` memasukkan semuanya ke plan 01 sampai 15, masing-masing dengan `## Review Dispositions Ledger` / `### Round 1`. Ringkas:

- C1: hanya parameter `state` yang tidak ada berarti tanpa filter; parameter yang ada tetapi kosong atau rusak menjadi sentinel yang tidak cocok dengan apa pun; fallback mempertahankan sentinel; mapper `status=` lama mengikuti aturan yang sama (plan 10).
- C2: test baru `tests/integration/ticket-states-deploy.test.ts` (plan 03) menjalankan `pnpm prisma migrate deploy` sungguhan (Prisma 7.8.0) dengan config khusus test pada database pra-12.1 berisi di container Testcontainers milik plan 03: kasus gagal (saved view rusak; skema, baris, dan `_prisma_migrations` tidak berubah), pemulihan (termasuk `migrate resolve --rolled-back` bila Prisma menolak dengan P3009), dan deploy sukses. Plan 01 tidak lagi mengklaim atomisitas.
- C3: plan 10 Task 1 memigrasi `list-panel-data.test.ts` sebelum verifikasinya.
- C4: pola `; ! grep` dibuang; plan 02 membuat pemeriksa `tests/support/red-window-tsc.mjs` (log baru, satu baris `TSC_EXIT`, baris tanpa path gagal, kepemilikan berkas dibaca dari plan); plan 15 menghapusnya.
- C5: kasus snooze pindah ke plan 07 sesudah `snooze.ts` dimigrasi, dengan state OPEN dan state CLOSED kustom.
- C6: tiap pass worker `sla-flag` mengunci kandidat dengan `ORDER BY t.id FOR UPDATE OF t SKIP LOCKED` lalu memperbarui hanya baris itu; tiga race dua tiket melawan `runTicketMutation` massal.
- C7: `createTicket` mengunci config lalu state default `FOR SHARE`; lima race terikat PID.
- C8: snapshot setiap kolom setiap tabel yang ada sebelum migrasi, dengan nilai bukan default.
- C9: `sla-pause-migrated.test.ts` (plan 06) me-resume tiket PENDING hasil migrasi pada waktu terkontrol.

## Fakta yang sudah saya verifikasi

- Plan checker GSD atas replan (`189e5d7`) lolos di ketiga irisan tanpa temuan; probe deterministik: 50 perintah verifikasi, semua path resolve, semua punya `<fails_when>`; tidak ada `rm -rf`.
- Wave tidak berubah: 1: 01, 02; 2: 03, 04, 05, 10, 11; 3: 06, 08, 09, 13, 14; 4: 07, 12; 5: 15; 6: 16; 7: 17.

## Pertanyaan

1. Apakah C1 sampai C9 benar-benar tertutup di plan, dan adakah perbaikan yang membuka masalah baru? Perhatikan khususnya: pemeriksa jendela merah (apakah terlalu rumit untuk dipercaya, bisa lolos hampa, atau bisa gagal karena hal di luar kendali plan); test deploy sungguhan (apakah benar-benar mengamati jalur produksi, dan apakah ia menyentuh sesuatu di luar container Testcontainers); `SKIP LOCKED` di worker (tiket yang terlewat hanya sampai run berikutnya?); urutan lock `createTicket` terhadap protokol hapus state.
2. Masih adakah kontradiksi antar plan, test yang lolos karena kode yang belum dimigrasi, atau acceptance yang menunjuk berkas lain dari tempat aksi menaruh kodenya?
3. HIGH yang tersisa: adakah yang membuat plan tidak siap dieksekusi?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (berkas dan baris), dampak, dan perbaikan konkret; lalu satu paragraf: apakah plan siap dieksekusi. Tandai klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.000 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
