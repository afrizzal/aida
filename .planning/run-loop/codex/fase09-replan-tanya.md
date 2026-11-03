# Fase 09 Operasional: brainstorm sebelum replan (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Latar

Fase 9 (AIDA-33 sampai AIDA-41) diparkir 2026-11-08 sesudah review plan siklus 3 (`.planning/phases/09-operations/09-REVIEWS.md`, Cycle 3: R1 HIGH, R2 sampai R5 MEDIUM, R6 LOW). Owner melepas parkirnya 2026-11-11 dengan opsi b: replan memasukkan temuan siklus 3, plan checker sebagai gerbang, lalu eksekusi, tanpa review plan Codex lagi. Ini bukan review plan, melainkan brainstorm untuk tambahan CONTEXT.

Plan 09-01 sampai 09-11 ditulis 2026-11-08. Sesudah itu Fase 11, 12, 12.1, 12.2, 14, dan Bagian A Fase 8 dieksekusi, jadi plan menyebut berkas dan perilaku yang sudah berubah. Tambahan CONTEXT ada di `.planning/phases/09-operations/09-CONTEXT.md`, bagian "Update 2026-11-12" (U-01 sampai U-10). Bacalah lebih dulu.

## Keputusan owner (kata per kata, mengikat)

- "Fase 9: b. Seed menolak, tidak pernah menghapus data demo."
- "Versi 1.0.0 saat rilis v1.0.0. CODEOWNERS berisi @afrizzal Widget README: tidak."
- Aturan I (biaya GitHub) dan J (resource Docker test) di `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi di kode

- Fase 14 menambah model `ProjectFileCleanup` dan `sweepProjectFileCleanup` di `src/lib/projects/file-cleanup.ts`, yang menghapus berkas proyek tersimpan. Worker sekarang memasang `uploads_data` (K68). Plan 09-04 menambah outbox lain, `PendingFileDeletion`, dengan lease backup.
- `Dockerfile:93` membuat `/data/uploads` milik `node:node`; `app` dan `worker` berjalan sebagai `node`. `local-file-storage.ts` memakai `mkdir` dan `writeFile` dengan mode bawaan.
- Service `backup` di plan 09-08 memakai image `pgvector/pgvector:pg16` dengan entrypoint sendiri.
- Helper aturan J ada di `tests/support/docker-test-labels.ts`, `docker-test-preflight.ts`, `docker-test-resources.ts`, dan `scripts/test-docker-cleanup.ts`. Harness container Fase 8.1 (08-14, di `.planning/phases/08-security-hardening/deferred-8.1/`) menunggu owner. Ruang VM Colima 13,9 GiB, di bawah preflight 20 GiB.
- Rute publik baru di bawah `/api/public` tidak butuh entri `PUBLIC_PREFIXES` baru. CSP sudah mengizinkan `img-src 'self'`.

## Pertanyaan

1. **U-03, dua outbox penghapusan berkas.** Mana yang lebih aman untuk konsistensi backup: (a) satu outbox untuk semua penghapusan berkas (lampiran tiket, logo, dan berkas proyek); atau (b) dua outbox, keduanya patuh pada lease yang sama? Sertakan jebakan, termasuk R2 (pemegang lease kehilangan sesi database di tengah aksi). Apakah ada jalur hapus berkas lain yang belum disebut?
2. **U-07, bukti tingkat stack.** Opsi: (a) Fase 9 menulis harness kecil sendiri di atas helper J1, dan langkahnya tercatat `blocked (space)` selama VM kurang dari 20 GiB; (b) bukti stack Fase 9 menunggu harness 08-14 dan klausul stack AIDA-33 dan AIDA-35 tetap terbuka; (c) lainnya. Mana yang paling aman bagi resource Docker bersama, dan mana yang paling sedikit pekerjaan ganda?
3. **U-08, non-root.** Service `backup` berjalan sebagai user apa, siapa pemilik `backups_data`, dan bagaimana restore menjaga uploads tetap milik `node`? Bandingkan dengan menjalankannya sebagai root, dengan alasan tertulis.
4. **U-04, seed menolak.** Kalau seed atau demo boot mati di tengah jalan, data demo jadi parsial dan semua boot berikutnya menolak. Apakah ada jalur yang memblokir boot pertama yang sah untuk selamanya? Apa pemulihan manual yang aman dan bisa didokumentasikan tanpa kode yang menghapus data?
5. **U-05, `check-version`.** Dengan versi 1.0.0 dan kebijakan bump yang belum diputuskan owner, apakah aturan "gagal bila hilang, tidak valid, atau lebih rendah dari base; versi sama hanya notice" masuk akal? Ada risiko lain?
6. Konflik apa yang paling berbahaya antara plan 09-01 sampai 09-11 dan kode sekarang (Bagian A Fase 8, Fase 11 sampai 14)? Sebut berkas dan baris. Jangan review ulang semua plan; cari yang bisa membuat plan salah total.

## Format jawaban

Bahasa Indonesia. Per pertanyaan: rekomendasi, alasan, dan jebakan. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 900 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
