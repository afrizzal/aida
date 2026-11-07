# Fase 09 Operasional: kritik diff fase (putaran 3 dari maksimal 3, terakhir)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan putaran 1 dan 2

- **Putaran 1** (`codex/fase09-diff-jawab.md`): 4 HIGH, 3 MEDIUM. Semua diterima, menjadi K148 sampai K151, dan diperbaiki di batch F5.
- **Putaran 2** (`codex/fase09-diff-r2-jawab.md`): 4 HIGH, 2 MEDIUM. Semua diterima, menjadi K152 sampai K155, dan diperbaiki di batch F6.

Keputusannya ada di `.planning/phases/09-operations/09-REVIEW.md`, bagian "Codex diff critique round 1 dispositions" dan "round 2 dispositions":

- **K152:** cek skema dan `--validate-only` berjalan sebelum tulis apa pun, dan target kosong tidak diberi lease.
- **K153:** rollback memulihkan database dan uploads berpasangan dari set yang sama.
- **K154:** lock dan lease dipegang sampai `migrate deploy` kembali.
- **K155:** `idle_in_transaction_session_timeout` 30 detik pada transaksi upload. Jeda antrean 15 menit, jadi marginnya 870 detik.

## Yang direview

Batch F6. Laporannya ada di `.planning/phases/09-operations/09-REVIEW-FIX.md`, bagian F6. Berkas utama:
- `scripts/restore.sh`, `scripts/backup/aida-restore-set.sh`, `scripts/backup/lib.sh`;
- `src/lib/attachments/uncertain-commit.ts` dan keempat jalur upload yang memakainya;
- `docs/OPERATIONS.md` (rollback, `--validate-only`, perbaikan baris keanggotaan ganda);
- test: `tests/unit/restore-script.test.ts`, `tests/integration/backup-restore-roundtrip.test.ts`, `tests/integration/support/restore-bridge/docker`, `tests/integration/upload-commit-bound.test.ts`, `tests/unit/upload-commit-bound.test.ts`, `tests/unit/operations-rollback-docs.test.ts`.

## Fakta yang sudah saya verifikasi

- Sesudah F6: lint, typecheck, unit 1716, dan `pnpm test:integration` penuh (116 berkas, 1547 test) semuanya exit 0. E2E penuh belum diulang sesudah F1 sampai F6.
- Batas yang dilaporkan eksekutor:
  - COMMIT yang sudah dimulai server tidak bisa dibatasi pengaturan PostgreSQL 16. `statement_timeout` terbukti tidak membatasi kerja COMMIT. Skema tidak punya constraint atau trigger deferred (sudah dites).
  - Jembatan `restore-bridge/docker` mengganti `compose run` dengan `docker exec`, jadi perilaku Compose sungguhan tetap SP-2.
  - Langkah migrate K154 di round trip hanya mencatat lock dan lease, tidak menjalankan `prisma migrate deploy`.

## Pertanyaan

1. Apakah K152 sampai K155 dan kedua MEDIUM benar-benar tertutup? Apakah perbaikannya membuka masalah baru? Contoh:
   - target kosong tanpa lease berlomba dengan backup;
   - lease yang diambil ulang sesudah restore gagal diambil;
   - trap meninggalkan lock;
   - batas 30 detik memutus upload sah yang lambat.
2. Apakah batas K155 yang tersisa (COMMIT yang sudah dimulai server) cukup kecil untuk diterima sebagai batas tertulis, atau tetap HIGH?
3. Ini putaran terakhir. Masih adakah HIGH di Fase 9 yang belum tercatat?

Tinjau hanya diff F6 dan dampaknya. Jangan membuka review menyeluruh ulang.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, masing-masing dengan berkas dan baris. Lalu satu paragraf: apakah Fase 9 siap ke gerbang ulang dan verifier. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 700 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
