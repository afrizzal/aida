# Fase 12.2 Usulan artikel KB dari tiket yang selesai: review plan (siklus 3 dari maksimal 3, terakhir)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan siklus 2

Di siklus 2 (`.planning/run-loop/codex/fase12-2-plan-r2-jawab.md`) kamu memberi 5 temuan: R2-1 HIGH, R2-2 sampai R2-4 MEDIUM, R2-5 LOW. Semua dicek dan diterima; disposisinya ada di `.planning/phases/12.2-ticket-lifecycle-knowledge-from-resolved-work/12.2-REVIEWS.md` (tabel "Cycle 2" dan paragraf penutupnya). Replan `--reviews` putaran 2 (`c10077a`) mengubah plan 01 sampai 09, 11, dan 12, masing-masing dengan `### Round 2 — 8cd59bb` di ledger. Ringkas:

- R2-1: task 3 baru di plan 03. Transaksi swap di `src/lib/worker/jobs/kb-embed-article.ts` mengunci baris artikel `FOR UPDATE`, membaca ulang `bodyMarkdown`, dan melewati swap dan update status bila teks berubah; COMPLETED ditulis di transaksi yang sama; tulisan FAILED bersyarat teks tidak berubah; seam observer khusus test; test race terikat PID. Plan 05 kini bergantung pada 03.
- R2-2: keputusan run K51 (penanda `[T<n>]` dan tautan ke halaman tiket di judul dan body; cek teks mentah dan `href` hasil `renderMarkdown` lewat `rehype-parse`; escape persen rusak ditolak; "#123" dalam prosa boleh). K52: tautan tiket di judul memakai baris copy "Title citation marker error".
- R2-3: `generationEpoch Int @default(1)` dengan CHECK `>= 1` (plan 01); payload `{ proposalId, epoch }` (D-13 diamandemen); klaim, pelepasan lease, setiap FAILED, dan store mensyaratkan epoch cocok; restart menaikkan epoch.
- P3/R2-4: loader review memakai select eksplisit tanpa `include:`; test menelusuri hasil review dan list tanpa kunci `snapshotSeq` dan tanpa nilai `bigint`.
- R2-5: dua E2E baru di plan 11 (petunjuk PENDING dan "Retry indexing"; panggilan server action yang dibatalkan dengan `page.route`); toast `indexingQueued: false` dan baris restart `queued: false` dicatat terbuka di plan 12.

## Fakta yang sudah saya verifikasi

- Plan checker atas replan putaran 2, dua irisan: semua butir putaran 2 terbawa sesuai kolom "Orchestrator check". Temuan baru yang belum masuk plan (akan dibawa bersama temuanmu di replan putaran 3, jadi tidak perlu dilaporkan ulang kecuali ada akibat lain):
  - P5 (warning, plan 09 dan 11): plan 09 tidak menyatakan apakah retry indexing yang sukses memanggil `router.refresh()`; tombol dan baris statusnya hanya tampil selama artikel belum COMPLETED, dan worker sungguhan dengan stub embed bisa selesai sebelum assertion E2E "Indexing restarted.", jadi E2E bisa flaky.
  - P6 (warning, plan 03 task 3): pemeriksaan kesegaran hanya membandingkan `bodyMarkdown`; re-embed-all sesudah ganti model embedding (`enqueueReembed`, `src/lib/kb/create-article.ts:115-117`) tidak mengubah teks, jadi job lama dengan vektor model lama bisa menimpa vektor model baru dan menulis COMPLETED dengan `embeddingModel` lama; komentar header plan mengklaim re-embed-all ikut terlindungi.
  - P7 (info, plan 01): database sementara `aida_p122_kb` di `aida-dev-db` tidak di-drop.
  - P8 (info, plan 02): cek hasil render hanya membaca `a[href]`; destinasi gambar yang di-escape seperti `![x](\/tickets\/abc)` lolos kedua cek.
- Pemeriksa menegaskan: di READ COMMITTED, `SELECT … FOR UPDATE` kedua menunggu commit pertama lalu membaca versi terbaru, dan `deleteMany` sesudahnya melihat chunk yang sudah di-commit; `route.abort()` pada POST ber-header `next-action` membuat promise server action ditolak di klien (pola yang sama ada di `tests/e2e/ticket-statuses.spec.ts:594-598`); worker tidak punya jadwal penyapu artikel PENDING.

## Pertanyaan

1. Apakah R2-1 sampai R2-5 benar-benar tertutup di plan, dan adakah perbaikan putaran 2 yang membuka masalah baru? Perhatikan khususnya: kunci `FOR UPDATE` artikel di job embed melawan `updateKbArticle`, publish (plan 05, yang menyisipkan artikel di transaksi yang mengunci member lalu proposal), dan jalur lain yang mengunci artikel (urutan lock, deadlock); epoch melawan retry pg-boss, restart, dan lease kedaluwarsa; cek tautan K51 (negatif palsu yang penting, dan apakah cek di `href` hasil render benar-benar memakai keluaran yang sama dengan yang disimpan ke `bodyHtml`).
2. Masih adakah kontradiksi antar plan, test yang lolos karena kode yang belum ada, atau acceptance yang menunjuk berkas lain dari tempat aksi menaruh kodenya?
3. Ini siklus terakhir. Adakah HIGH yang membuat plan tidak siap dieksekusi sesudah P5 sampai P8 diperbaiki?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (berkas dan baris), dampak, dan perbaikan konkret; lalu satu paragraf: apakah plan siap dieksekusi. Tandai klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 900 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
