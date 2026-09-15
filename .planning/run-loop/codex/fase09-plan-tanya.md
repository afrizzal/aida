# Fase 09 Operations: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

11 plan di `.planning/phases/09-operations/09-01-PLAN.md` sampai `09-11-PLAN.md` (6 wave), untuk AIDA-33 sampai AIDA-41. Keputusan mengikat ada di `09-CONTEXT.md` (D-01 sampai D-27, dari brainstorm denganmu: `.planning/run-loop/codex/fase09-jawab.md`). Kontrak UI ada di `09-UI-SPEC.md`. Batas run ada di `.planning/run-loop/PIAGAM.md`. Fase 08 diparkir; temuan keselamatan container dari review Fase 08 (`.planning/phases/08-security-hardening/08-REVIEWS.md`, Cycle 3: R3-1 sampai R3-3) juga mengikat test stack Fase 09.

## Fakta yang sudah saya verifikasi

- Plan-checker GSD lolos sesudah satu revisi (09-09, state `<h1>` yang dulu dicek statis kini dirender). Gerbang otomatis: requirement 9/9, keputusan 27/27.
- Test stack (backup service di compose, restore ke stack terisolasi, boot dengan password berkarakter khusus) ditulis di 09-11 tetapi sengaja tidak dijalankan sampai owner memutuskan soal test container; klausul AIDA-33 dan AIDA-35 yang bersangkutan tetap terbuka.
- Di mesin ini: unit dan integration lolos (kecuali berkas egress), E2E lolos dengan flake yang diketahui. Testcontainers butuh variabel socket Colima. Satu proses test pada satu waktu.

## Pertanyaan

Untuk setiap temuan: plan dan task, bukti (file dan baris), dampak, dan perbaikan konkret. Severity HIGH (acceptance gagal, melanggar piagam, atau celah keamanan), MEDIUM, atau LOW.

1. **Protokol lease dan hapus tertunda (09-04, 09-06, D-02).** Apakah urutan "commit perubahan DB, lalu cek lease, lalu tunda unlink" benar-benar menjamin setiap record di dump punya berkasnya, termasuk saat crash, lease kedaluwarsa, backup bersamaan, dan sapuan `file-deletion-sweep`? Apakah semua jalur hapus dan ganti berkas sudah tercakup? Apakah `PendingFileDeletion` sebagai tabel infrastruktur aman dari sisi tenancy?
2. **Backup dan restore (09-06, 09-08, 09-10).** Publikasi atomik, retensi, status yang dilaporkan, validasi arsip sebelum restore (path traversal, symlink), dan apakah test Testcontainers membuktikan acceptance yang bisa dibuktikan tanpa stack.
3. **Logo (09-05, 09-07).** Sniffing, penolakan SVG, batas ukuran dan dimensi tanpa package baru, route publik, cache berversi, dan throttle memakai `checkRateLimit` lama (diakui tidak atomik dan identitasnya bisa dipalsukan di luar topologi bawaan). Apakah ada celah yang membuat ini tidak layak?
4. **Password URL (09-01).** Default bertingkat compose, generator, guard startup di app, worker, dan migrate, dan test `docker compose config` yang tidak mencetak password.
5. **Guard seed dan demo (09-02).** Klasifikasi tenant, advisory lock, dan test jumlah baris semua tabel.
6. **Pemicu fault khusus test (09-09 Task 3).** `e2eFault` aktif hanya kalau `NODE_ENV !== "production"` dan `AIDA_E2E_FAULTS === "1"`, dipanggil di komponen halaman. Apakah ada jalur di mana ia aktif di produksi atau bisa dipicu dari luar?
7. **Repo health (09-03, 09-10).** `install.sh` dengan fake `curl` dan `docker`, `check-version` tanpa field version, `AGENTS.md`, dan item owner.
8. **Test stack yang ditulis tetapi tidak dijalankan (09-11).** Apakah plan menjamin test itu benar-benar tidak terpanggil oleh skrip lain, dan apakah pengamannya mengikuti R3-1 sampai R3-3?
9. **Pelanggaran piagam.** Checkpoint manusia, scope dibuang, `prisma db push`, `.env`, `rm -rf`, egress baru, nama orang atau path rumah di berkas yang dilacak, atau klaim lulus untuk hasil merah.

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat, lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.600 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
