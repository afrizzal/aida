# Fase 12.2 Usulan artikel KB dari tiket yang selesai: review plan (siklus 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan siklus 1

Di siklus 1 (`.planning/run-loop/codex/fase12-2-plan-jawab.md`) kamu memberi 8 temuan: C1 sampai C3 HIGH, C4 sampai C8 MEDIUM. Semua dicek ke plan dan kode; disposisinya ada di `.planning/phases/12.2-ticket-lifecycle-knowledge-from-resolved-work/12.2-REVIEWS.md`. C1 sampai C7 diterima; C8 ditolak (keputusan run K49: `AuditEvent` hanya untuk panggilan yang mengembalikan output, sama seperti draf balasan dan triage; dicatat di `deferred-items.md`); outbox transaksional untuk C2 ditolak (K50: jalur buat KB manual punya bentuk yang sama; retry untuk artikel PENDING menjadi pemulihan yang terlihat). Dua warning plan checker (P1 `snapshotSeq` bertipe `BigInt`, P2 definisinya) juga diterima. UI-SPEC diamandemen orkestrator (A1 sampai A4 di akhir `12.2-UI-SPEC.md`). Replan `--reviews` putaran 1 (`d235919`) mengubah plan 01 sampai 09 dan 12, masing-masing dengan `## Review Dispositions Ledger` / `### Round 1 — 5d9e64a`. Ringkas:

- C1: `shareLockActiveMembership` di `src/lib/membership.ts` mengunci baris `member` `FOR SHARE` sebagai pernyataan pertama publish; race terikat PID melawan demosi dan hapus member di kedua urutan (plan 05).
- C2: retry indexing menerima FAILED atau PENDING; `INDEXED` diganti `COMPLETED`; toast peringatan saat `indexingQueued: false` (plan 05, 06, 08, 09).
- C3: README plan 12 di-commit sebelum commit yang diuji dicatat; sesudah gate hanya `.planning` yang berubah, atau gate diulang.
- C4: `withDeadline` di plan 03: satu controller dan satu timer meliputi seluruh `client.chat()`, termasuk body; test dengan body yang tidak pernah selesai.
- C5: kolom `generationQueuedAt` (diisi saat request, restart, dan saat klaim dilepas karena kegagalan sementara); `isStuck` memakai klaim, lalu waktu antre, tidak pernah `createdAt`.
- C6: `revalidatePath` sesudah hasil service dalam try sendiri; modul murni `proposal-outcome.ts` membuat `UNKNOWN` sama dengan panggilan yang ditolak.
- C7: penanda sumber ditolak di judul; tautan ke halaman tiket ditolak di body (`containsTicketLink`); "#123" dalam prosa tetap boleh.

## Fakta yang sudah saya verifikasi

- Plan checker atas replan, dua irisan: 01 sampai 06 lolos tanpa temuan (termasuk: tabel `member` tanpa `@@map`; UPDATE dan DELETE bentrok dengan `FOR SHARE`; urutan "demosi dulu" membaca ulang baris di READ COMMITTED). 07 sampai 12: satu warning dan dua info, belum masuk plan, akan dibawa bersama temuanmu:
  - P3 (warning, terverifikasi di plan 08 baris 114): acceptance hanya memeriksa bahwa token `snapshotSeq` tidak muncul di `proposal-queries.ts`; loader dengan `include: { sources: true }` lolos grep itu tetapi mengirim `bigint` ke komponen klien plan 09, dan serialisasi React akan gagal saat runtime.
  - P4 (info): perilaku A1, A3, dan A4 di halaman review hanya dibuktikan statis (typecheck dan grep di plan 09); E2E plan 11 tidak menjalankannya.
- Repo tidak punya setup test komponen; unit test berjalan di node untuk berkas `.ts`.
- Probe deterministik: semua perintah verifikasi punya `<fails_when>`; tidak ada `rm -rf`.

## Pertanyaan

1. Apakah C1 sampai C7 benar-benar tertutup di plan, dan adakah perbaikan yang membuka masalah baru? Perhatikan khususnya: kunci `FOR SHARE` pada `member` (deadlock dengan jalur lain yang mengunci member atau proposal dalam urutan berbeda, dan apakah Better Auth mengubah peran lewat UPDATE biasa); `withDeadline` dengan klien `ollama` sungguhan dan fetch tiruan (apakah test bisa lolos hampa); `generationQueuedAt` saat klaim dilepas melawan retry pg-boss dan restart; penolakan tautan tiket (positif palsu dan negatif palsu yang penting).
2. Apakah penolakan C8 (K49) dan outbox (K50) dapat diterima untuk AIDA-18, atau ada akibat yang membuatnya tidak aman?
3. Masih adakah kontradiksi antar plan, test yang lolos karena kode yang belum ada, atau acceptance yang menunjuk berkas lain dari tempat aksi menaruh kodenya?
4. HIGH yang tersisa: adakah yang membuat plan tidak siap dieksekusi?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (berkas dan baris), dampak, dan perbaikan konkret; lalu satu paragraf: apakah plan siap dieksekusi. Tandai klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.000 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
