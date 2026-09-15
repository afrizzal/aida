# Fase 11 Inbox: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

9 plan di `.planning/phases/11-inbox/11-01-PLAN.md` sampai `11-09-PLAN.md` (6 wave), untuk AIDA-47 sampai AIDA-51. Keputusan mengikat ada di `11-CONTEXT.md` (D-01 sampai D-24, dari brainstorm denganmu: `.planning/run-loop/codex/fase11-jawab.md`). D-17 punya amandemen bertanggal: kedua jalur balasan mengunci baris tiket dulu, lalu menjalankan reopen bersyarat, karena `UPDATE` bersyarat saja tidak menunggu resolve yang belum commit. Kontrak UI ada di `11-UI-SPEC.md` (disetujui). Batas run ada di `.planning/run-loop/PIAGAM.md`.

Fase 08, 09, dan 10 diparkir karena review plan siklus 3 masih menemukan HIGH. Di Fase 10 kedua HIGH terakhir adalah kontradiksi internal: skrip E2E yang mengharapkan hasil yang tidak mungkin terjadi menurut plan sebelumnya, dan predikat helper test yang tidak cocok dengan perilaku PostgreSQL. Tolong cari kelas cacat itu secara khusus.

## Fakta yang sudah saya verifikasi

- Plan-checker GSD lolos tanpa blocker maupun warning, tetapi pemeriksaannya terarah: struktur, wave, tumpang tindih berkas per wave, batas run, dan pemetaan baris UI-SPEC lewat skrip dan kata kunci. Aksi tiap task tidak dibaca baris per baris, jadi bacaan barismu yang pertama.
- Tiap plan berisi 3 task; wave = max(dependensi)+1; tanpa `checkpoint:human-verify`; `db push` hanya muncul sebagai larangan; tanpa perubahan `package.json`.
- Container `aida-dev-db` belum ada di mesin ini. 11-01 Task 1 punya precondition: kalau container tidak berjalan, plan berhenti dan melapor, tidak membuatnya. Orkestrator akan membuat container itu sebelum eksekusi (image `pgvector/pgvector:pg16`, `127.0.0.1:55432`), karena piagam menyebutnya container sekali pakai milik project yang diizinkan.
- 11-09 mencatat `pnpm test:integration` penuh dan `pnpm test:egress` sebagai "blocked (O-1)", lalu menjalankan sisa suite integration dengan `--exclude tests/integration/egress-isolation.test.ts`.
- Di kode `HEAD`: mutasi satu tiket ada di `src/app/(app)/tickets/[id]/actions.ts` tanpa audit; `AuditEvent` khusus AI; kedua jalur balasan menghitung `shouldReopen` sebelum transaksi (`src/lib/channels/email/ingest-message.ts:187-188`, `src/app/api/public/status/[token]/follow-up/route.ts:88`).

## Pertanyaan

Untuk setiap temuan: plan dan task, bukti (file dan baris), dampak, dan perbaikan konkret. Severity HIGH (acceptance gagal, melanggar piagam, atau celah keamanan), MEDIUM, atau LOW.

1. **Kontradiksi internal.** Acceptance atau grep yang menunjuk berkas lain dari tempat aksi menaruh kodenya; test atau E2E yang mengharapkan kode error, state akhir, efek tombol, atau jumlah yang bertentangan dengan perilaku yang ditetapkan plan lain atau plan yang sama; helper test (misalnya pengamat lock-wait berbasis `pg_blocking_pids`) yang tidak bisa cocok dengan perilaku PostgreSQL sebenarnya.
2. **Service mutasi dan aksi massal (11-02).** Paritas efek samping dengan action lama (status: `resolvedAt` dan reset flag; prioritas: hitung ulang SLA), urutan lock, audit dalam transaksi yang sama, cek keanggotaan aktor dan assignee di dalam transaksi, seam rollback, batas 100, dan deadlock antara dua aksi massal.
3. **Auto-close (11-04, D-15 sampai D-19).** Apakah lock-dulu di kedua jalur balasan plus `UPDATE` bersyarat di job benar-benar menutup ketiga urutan race? Awal periode sepi, `resolvedAt` null, idempotensi, batas 100 per organisasi, pembacaan setting yang tidak valid, dan apakah ada jalur yang tetap mengirim sesuatu ke pelanggan.
4. **Saved views (11-01, 11-03, 11-05).** Partial unique index lewat migrasi, izin private dan shared, referensi yang hilang, `mine`, peringatan teks pencarian bersama, URL `sv` dan perbandingan filter, dan test isolasi tanpa mock.
5. **Palette dan keyboard (11-07, 11-08, 11-09).** Endpoint pencarian dengan cek keanggotaan, registry dan ID duplikat, guard input, IME, dan dialog, chord dengan timeout, prioritas handler lokal, dan apakah E2E menyatakan hasil yang diamati.
6. **Migrasi (11-01).** Trigger append-only, partial unique index, `migrate deploy`, `migrate diff`, dan precondition `aida-dev-db`.
7. **Pelanggaran piagam.** Checkpoint manusia, scope dibuang, `prisma db push`, `.env`, `rm -rf`, egress baru, container selain `aida` dan `aida-dev-db`, email nyata atau notice pelanggan, nama orang atau path rumah di berkas yang dilacak, klaim lulus untuk hasil merah, atau penilaian visual rekaan.

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat, lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.400 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
