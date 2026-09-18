# Fase 12 Siklus tiket (relasi, merge, snooze, feed): review plan (siklus 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan siklus 1

Di siklus 1 (`.planning/run-loop/codex/fase12-plan-jawab.md`) kamu memberi 10 temuan (4 HIGH, 6 MEDIUM). Semuanya dicek ke plan dan kode dan diterima (`.planning/phases/12-ticket-lifecycle/12-REVIEWS.md`, `### Cycle 1` dan `### Required properties for the replan`). Replan: plan 12-01 sampai 12-07 dan 12-09 berubah, plan baru 12-10 (wave 4, hanya test), masing-masing dengan ledger `### Round 1 — aec7bf8`. Provenance merge kini memakai `Message.seq` dari sequence database yang diisi saat insert di bawah row lock tiket; merge mengambil `Ticket.mergeMessageSeq` dari sequence yang sama sambil memegang kedua lock; token sumber hanya melihat pesan target dengan `seq > mergeMessageSeq`. D-09 di `12-CONTEXT.md` mendapat amandemen bertanggal (visibilitas tiap token tidak berubah). UI-SPEC mendapat baris copy "Link error: hierarchy too deep".

## Fakta yang sudah saya verifikasi

- Plan-checker GSD (dipecah dua karena ukuran): tanpa blocker; lima catatan kecil diperbaiki (sequence `OWNED BY` agar `pg_get_serial_sequence` tidak NULL; `snoozeWakeHandler` meneruskan `afterWakeLock`; `MERGED_SOURCE` dicek sebelum `TICKET_CLOSED`; satu aturan hitung kedalaman hierarki; `TICKET_UNAVAILABLE` di follow-up menjawab 404 dengan fixture lewat hook `onResolveStart`). Commit `2e5fcf3`.
- Checker juga mencatat bahwa setiap jalur yang menyisipkan pesan ke tiket lama memegang row lock tiket itu: ingest email lewat `reopenOnCustomerReply`; route agen dan follow-up lewat 12-03 dan 12-04; create-ticket, create-article, dan seed hanya ke tiket baru.

## Pertanyaan

1. Untuk C1 sampai C10, apakah properti wajibnya benar-benar ada di isi plan yang dieksekusi, bukan hanya di ledger?
2. Apakah revisi membuka masalah baru, terutama kontradiksi internal: mekanisme `Message.seq` dan `mergeMessageSeq` (apakah ada insert pesan ke tiket lama yang tidak memegang lock, termasuk pesan sistem atau AI, dan apakah sequence dapat dibandingkan dengan benar), savepoint dan relock, hook test baru, urutan cek error, dan test di 12-10.
3. HIGH yang tersisa: apakah ada plan yang pasti gagal mencapai acceptance-nya, melanggar piagam, atau membuka kebocoran antar link?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (file dan baris), dampak, dan perbaikan konkret; lalu satu paragraf: apakah plan siap dieksekusi. Tandai klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.300 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
