# Fase 09 Operasional: kritik diff fase (putaran 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan putaran 1

Jawabanmu ada di `.planning/run-loop/codex/fase09-diff-jawab.md`: 4 HIGH dan 3 MEDIUM, dengan penilaian "belum siap". Semua klaim HIGH saya cek ke kode, dan semua temuan saya terima. Keputusannya ada di `.planning/phases/09-operations/09-REVIEW.md`, bagian "Codex diff critique round 1 dispositions":

- **K148:** kalau hasil COMMIT tidak pasti, berkas staged masuk antrean, tidak langsung dibuang. Sweep hanya menghapus kunci yang tidak dirujuk.
- **K149:** runbook rollback menghentikan penulis lebih dulu dan memakai `--validate-only`. Database lama di-rename, tidak pernah `dropdb`.
- **K150:** restore hanya ke target yang benar-benar kosong, atau yang riwayat migrasinya identik dengan set. Set yang lebih baru dari rilis ditolak. Sesudah restore set lama, `migrate deploy` dijalankan.
- **K151:** `getActiveOrgAccess` memakai pembacaan keanggotaan konservatif.
- **Tiga MEDIUM:** volume uploads disiapkan saat restore ke server baru; log hanya mencatat kelas dan kode galat; test commit-ambigu dan batas boot diperkuat.

## Yang direview

Batch F5: laporannya ada di `.planning/phases/09-operations/09-REVIEW-FIX.md`, bagian F5. Berkas yang paling penting:

- `src/lib/authz.ts` dan `src/lib/membership.ts`;
- `src/lib/error-shape.ts`, `src/lib/demo/bootstrap-demo.ts`, `prisma/seed.ts`;
- jalur upload di `src/app/api/public/intake/route.ts`, `src/app/api/public/status/[token]/follow-up/route.ts`, `src/app/api/tickets/[id]/messages/route.ts`, `src/lib/projects/attachments.ts`, `src/lib/attachments/staged-files.ts`, dan sweep di `src/lib/projects/file-cleanup.ts`;
- restore: `scripts/backup/aida-restore-set.sh`, `scripts/backup/lib.sh`, `scripts/restore.sh`;
- runbook `docs/OPERATIONS.md` (Upgrading rollback, restore ke server baru);
- test: `tests/support/lost-commit-proxy.ts`, `tests/integration/file-delete-inventory.test.ts`, `authz-conservative-membership.test.ts`, `tenant-seed-lock-bounds.test.ts`, `backup-restore-roundtrip.test.ts`, `tests/unit/restore-script.test.ts`.

## Fakta yang sudah saya verifikasi

- Sesudah F5: lint, typecheck, unit 1693, dan `pnpm test:integration` penuh (115 berkas, 1538 test) semuanya exit 0. E2E penuh belum diulang sesudah F1 sampai F5.
- Batas yang dilaporkan eksekutor:
  - proxy hanya mensimulasikan balasan COMMIT yang hilang, bukan COMMIT yang tidak pernah sampai;
  - jeda antrean K148 adalah 15 menit, dan itu bukan lock;
  - "kosong" di K150 dihitung atas semua skema non-sistem, sehingga database yang hanya berisi skema pgboss ditolak;
  - daftar migrasi rilis dibaca dari checkout;
  - bukti stack SP-1 sampai SP-3 belum dijalankan, termasuk skenario "new server".

## Pertanyaan

1. Apakah K148 sampai K151 dan ketiga MEDIUM benar-benar tertutup? Apakah perbaikannya membuka masalah baru? Contoh yang saya pikirkan:
   - jeda 15 menit masih kalah balapan dengan COMMIT yang sangat lambat;
   - pengecekan referensi sweep melewatkan sebuah tabel;
   - K150 menolak instalasi sah;
   - `migrate deploy` sesudah restore berjalan di urutan yang salah;
   - pembacaan konservatif mengunci owner yang sah.
2. Apakah runbook rollback sekarang aman dan jujur bagi operator?
3. Masih adakah HIGH di Fase 9 yang belum tercatat?

Tinjau hanya diff F5 dan dampaknya. Jangan membuka review menyeluruh ulang.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, masing-masing dengan berkas dan baris. Lalu satu paragraf: apakah Fase 9 siap ke gerbang ulang dan verifier. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
