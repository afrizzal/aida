# Fase 14 Fondasi Projects: kritik diff fase (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Clean-room: produk rujukan tanpa lisensi; yang boleh hanya `.planning/run-loop/FITUR-PROJECTS.md`. Jangan menyebut, menebak, atau meniru kode, nama tabel, teks UI, atau tata letak produk rujukan.

## Yang dikritik

Kode Fase 14 (AIDA-64 sampai 71, AIDA-100 sampai 105, tanpa UI) sudah dieksekusi (13 plan), di-review tiga bagian, dan diperbaiki dalam dua batch. Berkas produk: migrasi `prisma/migrations/20261113100000_projects_foundation`, bagian Fase 14 `prisma/schema.prisma`, `src/lib/projects/` (semua modul), `src/lib/markdown/render.ts` (`renderTaskMarkdown`), `src/lib/attachments/validate-upload.ts`, `src/lib/worker/index.ts` dan `src/lib/worker/jobs/project-file-cleanup.ts`, kedua berkas compose, README dan `docs/OPERATIONS.md`; test di `tests/`.

Konteks: `.planning/phases/14-projects-foundation/` (`14-CONTEXT.md` dengan amandemen K69, `14-CONTRACT.md`, `14-REVIEWS.md`, SUMMARY tiap plan, `14-GATE.md`, `14-REVIEW*.md` dengan bagian "Orchestrator dispositions" dan K71, `14-REVIEW-FIX.md`), `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Code review tiga bagian: 1 Critical (posisi proyek se-organisasi membocorkan keberadaan dan jumlah proyek privat; diperbaiki dengan K71), 16 Warning, 20 Info; tidak ada reviewer yang menemukan jalur baca atau tulis ke proyek privat bagi non-anggota, anggota tim, admin organisasi, atau organisasi lain. Butir owner baru 14-o3 (prefix unik se-organisasi dan kunci lama sesudah pindah keluar dari proyek privat).
- Perbaikan F1 (16 commit) dan F2 (8 commit) dengan bukti merah dulu; sesudahnya unit 838, integrasi tanpa egress 1216, typecheck, lint exit 0. Gerbang plan 14-13 di `4d6a498` hijau kecuali E2E; E2E merah didiagnosis sebagai dua race timing di spec lama dan diperbaiki (E2E penuh 209 lolos). Gerbang final belum diulang sesudah perbaikan review.

## Pertanyaan

Untuk setiap temuan: berkas dan baris, bukti, dampak, dan perbaikan konkret. Severity HIGH (proyek privat bocor atau bisa diubah lewat jalur apa pun, oracle keberadaan, kebocoran antar organisasi, data hilang, deadlock, melanggar piagam), MEDIUM, atau LOW.

1. Proyek privat dan oracle keberadaan sesudah K69 dan K71: apakah masih ada jalur (daftar, hitungan, kursor, aktivitas, feed tim, alias kunci, favorit, pindah, duplikat, bulk, recurrence, lampiran, galat) yang membedakan proyek yang ada tetapi tak terbaca dari yang tidak ada?
2. Konkurensi: urutan lock kontrak, `requireTask` sesudah pindah, hapus enam langkah, sweep outbox, recurrence tepat sekali.
3. Integritas data: hapus keras, tombstone kunci, aktivitas append-only, migrasi.
4. Test yang tidak bisa gagal atau bergantung pada data spec lain.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah fase siap ke gerbang dan verifier. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.000 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
