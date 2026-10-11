# Fase 14 Fondasi Projects: review plan (siklus 3 dari maksimal 3, terakhir)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Clean-room: produk rujukan tanpa lisensi; yang boleh hanya `.planning/run-loop/FITUR-PROJECTS.md`. Jangan menyebut, menebak, atau meniru kode, nama tabel, teks UI, atau tata letak produk rujukan.

## Ringkasan siklus 2

Di siklus 2 (`.planning/run-loop/codex/fase14-plan-r2-jawab.md`) kamu memberi 1 HIGH (kolom tingkat atas aktivitas dua proyek membocorkan sisi privat) dan 2 MEDIUM (favorit task melanggar aturan lock subtask; urutan hapus melanggar urutan lock global). Semua diterima (`.planning/phases/14-projects-foundation/14-REVIEWS.md`, tabel "Cycle 2"). Replan putaran 2 (`3dfeead`) mengubah 14-01, 14-04, 14-10, 14-11, 14-13 dengan `### Round 2 — 34e0c8d`:

- R2-1: `ACTIVITY_FEED_ROW_KEYS` (14 kunci, tanpa organizationId); sisi yang tak terbaca, privat, atau terhapus membuat id proyeknya dan `REDACTED_ROW_NULLED_KEYS` (entityId, taskId, teamId, batchId) null; `id` baris aktivitas dipertahankan untuk kursor halaman; delapan kasus test termasuk sesudah salah satu proyek dihapus (helper `tests/support/project-hard-delete.ts`).
- R2-2: `favoriteTask` dan `unfavoriteTask` memakai lock PROJECT_SHARE (task `FOR SHARE`, parent dulu untuk subtask), pengecualian arsip yang eksplisit; empat race dua arah lawan `deleteTask`.
- R2-3: hapus enam langkah: semua lock, kumpulkan storage key, tombstone kunci, outbox, hapus baris dalam urutan FK, aktivitas terakhir; `deleteProject` mengunci task (urut id) dan counter di langkah 1.

## Fakta yang sudah saya verifikasi

- Plan checker atas replan putaran 2: ketiga butir terbawa konsisten; satu warning yang sudah diketahui (akan dibawa ke replan terakhir, tidak perlu dilaporkan ulang kecuali ada akibat lain): P4 `favoriteProject` dan `unfavoriteProject` memakai lock NONE terhadap `deleteProject`, sehingga insert bisa gagal FK RESTRICT sebagai exception, bukan NOT_FOUND; perbaikan yang direncanakan: lock PROJECT_SHARE pada READ, tetap boleh di proyek terarsip, race dua arah.
- Probe deterministik: 38 perintah verifikasi, semua punya arah gagal.

## Pertanyaan

1. Apakah R2-1 sampai R2-3 benar-benar tertutup di plan, dan adakah perbaikan yang membuka masalah baru (misalnya kursor halaman dengan `id` yang dipertahankan, `deleteProject` yang mengunci task urut id bukan parent dulu, atau helper test yang menghapus baris secara langsung)?
2. Ini siklus terakhir. Masih adakah HIGH yang membuat plan tidak siap dieksekusi: proyek privat bocor lewat jalur mana pun, data hilang, deadlock, kontradiksi antar plan, atau verifikasi yang lolos sebelum kodenya ada?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (berkas dan baris), dampak, dan perbaikan konkret; lalu satu paragraf: apakah plan siap dieksekusi. Tandai klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
