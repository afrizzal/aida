# Fase 09 Operasional: kritik diff fase (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

Seluruh kode Fase 9 (AIDA-33 sampai AIDA-41): 13 plan ditambah empat batch perbaikan code review F1 sampai F4. Kamu tidak punya riwayat git, jadi bacalah bentuk akhir berkas berikut beserta dokumennya:

- Ringkasan per plan: `.planning/phases/09-operations/09-*-SUMMARY.md`. Keputusan: `09-CONTEXT.md` bagian "Update 2026-11-12" (U-01 sampai U-18). Review dan disposisi: `09-REVIEW.md` (di akhir, K141 sampai K147), `09-REVIEW-b.md`, `-c.md`, `-d.md`. Perbaikan: `09-REVIEW-FIX.md` (F1 sampai F4). Gerbang: `09-GATE.md`. Bukti stack yang belum dijalankan: `09-STACK-PROOFS.md`.
- Kode utama:
  - backup dan restore: `scripts/backup/*.sh`, `scripts/backup.sh`, `scripts/restore.sh`, service `backup` dan `backup-init` di `docker-compose.yml`;
  - penahan hapus: `src/lib/storage/file-fence.ts`, `src/lib/storage/uploads-volume.ts`, `src/lib/projects/file-cleanup.ts`, `src/lib/attachments/staged-files.ts`;
  - seed dan bootstrap: `src/lib/demo/*.ts`, `src/lib/tenant-seed-lock.ts`, `src/lib/bootstrap.ts`, `src/instrumentation.ts`, `prisma/seed.ts`, `src/app/(auth)/setup/actions.ts`;
  - URL database: `src/lib/db-url.ts`, `scripts/database-url.sh`, `scripts/check-database-url.ts`;
  - logo dan otorisasi: `src/lib/authz.ts` (`getActiveOrgAccess`), `src/app/api/settings/branding/logo/route.ts`, `src/app/api/public/logo/[orgId]/[version]/route.ts`, `src/lib/branding/*.ts`;
  - lain-lain: `scripts/install.sh`, `scripts/check-version.mjs`, `.github/workflows/check-version.yml`, `src/lib/testing/e2e-fault.ts`, `src/app/(app)/error.tsx`.

## Keputusan owner (mengikat)

- "Fase 9: b. Seed menolak, tidak pernah menghapus data demo."
- "Versi 1.0.0 saat rilis v1.0.0. CODEOWNERS berisi @afrizzal Widget README: tidak."
- Aturan I (biaya GitHub) dan J (resource Docker test) di `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Gerbang sebelum perbaikan review (di `2c75680`): lint, typecheck, unit 1646, integration 1500, build, dan E2E penuh 260 exit 0. `pnpm audit --prod` exit 1 dengan 10 high, sama dengan Fase 8. `test:egress` `blocked (space)` karena VM 13,2 GiB, di bawah 20 GiB.
- Sesudah F1 sampai F4: unit 1683 exit 0, lint dan typecheck exit 0, dan semua berkas integration yang disentuh exit 0. Integration penuh dan E2E penuh belum diulang sesudah perbaikan.
- Bukti tingkat stack SP-1 sampai SP-3 (service `backup` sungguhan, restore ke stack terisolasi, boot dengan password berkarakter khusus) `not run` sampai harness Fase 8.1 dan keputusan owner.
- Batas yang sudah tertulis:
  - L1: fence terlepas bila backup dijeda, sesinya putus, dan lease-nya kedaluwarsa sekaligus;
  - installer tanpa checksum arsip;
  - K143 berlaku per proses dan restore tanpa deadline;
  - restore memeriksa arah "target lebih baru dari set", tetapi tidak sebaliknya.

## Pertanyaan

1. Masih adakah HIGH yang belum tercatat? Yang saya maksud:
   - berkas yang dirujuk hilang dari set yang terpublikasi, atau terhapus saat backup;
   - restore yang menimpa data live di luar kontrak;
   - jalur yang menghapus data demo atau tenant;
   - celah otorisasi, terutama apakah `getActiveOrgAccess` benar-benar menutup c-CR-01 di ke-20 pemanggil, dan apakah ada pemanggil yang terlewat;
   - rahasia bocor ke log;
   - installer yang bisa disuntik;
   - hook galat E2E yang bisa aktif di produksi.
2. Apakah perbaikan F1 sampai F4 benar dan lengkap? Khususnya:
   - K142: perbandingan nama migrasi, dan jalur rollback di `docs/OPERATIONS.md` yang memakai `dropdb --force` dan `createdb` sesudah backup. Apakah langkah itu aman dan jujur bagi operator?
   - K143 dan K144: deadline, renewer, dan satu koneksi fence per provider.
   - K145 dan K146: lock seed di `/setup` dan batas tunggu boot 40 detik.
3. Restore "set lebih baru ke database kosong atau lebih tua" belum diperiksa. Apakah ini HIGH? Apa perbaikan terkecil?
4. Apakah ada test kunci yang tidak bisa gagal untuk cacat yang diklaimnya?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan berkas dan baris. Lalu satu paragraf: apakah Fase 9 siap ke gerbang ulang dan verifier. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 900 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
