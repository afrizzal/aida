# Fase 12 Siklus tiket (relasi, merge, snooze, feed): review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

9 plan di `.planning/phases/12-ticket-lifecycle/12-01-PLAN.md` sampai `12-09-PLAN.md` (7 wave), untuk AIDA-52 sampai AIDA-55. Fase 12 asli dipecah menjadi 12, 12.1, dan 12.2 (keputusan run K32, `.planning/ROADMAP.md`). Keputusan mengikat ada di `12-CONTEXT.md` (D-01 sampai D-23, dari brainstorm denganmu di `.planning/run-loop/codex/fase12-jawab.md`); kontrak UI di `12-UI-SPEC.md` (disetujui). Batas run: `.planning/run-loop/PIAGAM.md`. Kode Fase 11 yang diperluas: `src/lib/tickets/mutations.ts`, `reopen-on-reply.ts`, `src/lib/worker/jobs/auto-close.ts`, `src/lib/membership.ts`, `tests/support/lock-wait.ts`.

Tiga fase sebelumnya diparkir karena kontradiksi internal di plan, dan Fase 11 lolos sesudah review. Tolong cari kelas cacat itu secara khusus: acceptance atau grep yang menunjuk berkas lain dari tempat aksi menaruh kodenya; test atau E2E yang mengharapkan hasil yang bertentangan dengan plan lain; helper test yang tidak bisa mengamati perilaku PostgreSQL sebenarnya.

## Fakta yang sudah saya verifikasi

- Plan-checker GSD lolos sesudah satu revisi. Revisinya menghapus deadlock: jalur balasan dan merge kini sama-sama mengunci lewat `lockTicketsInIdOrder` (12-03), jalur balasan mengecek ulang di bawah lock, dan kalau merge sudah commit, ia melakukan satu relock lewat `ROLLBACK TO SAVEPOINT` lalu mengalihkan balasan ke target dalam transaksi yang sama; kalau masih berubah, hasilnya 409 `TICKET_CHANGED` tanpa menulis apa pun. Merge yang mengganti link menulis RELATION_REMOVED dan RELATION_ADDED.
- Pilihan perilaku server: balasan agen ke tiket sumber yang sudah di-merge ditolak dengan 409 `MERGED_SOURCE`; yang bisa di-snooze NEW, OPEN, PENDING, RESOLVED (batas server 4 menit sampai 366 hari); merge menghapus snooze tiket sumber.
- Tiap plan berisi 3 task; wave = max(dependensi)+1; tanpa `checkpoint:human-verify`; tanpa perubahan `package.json`; migrasi di dalam `aida-dev-db` dengan precondition stop-and-report.

## Pertanyaan

Untuk setiap temuan: plan dan task, bukti (file dan baris), dampak, dan perbaikan konkret. Severity HIGH (acceptance gagal, melanggar piagam, celah keamanan atau tenancy, kebocoran pesan antar link), MEDIUM, atau LOW.

1. **Kontradiksi internal** seperti dijelaskan di atas.
2. **Merge dan provenance (12-03, 12-04, D-07 sampai D-10).** Apakah setiap token status hanya menampilkan apa yang ditetapkan D-09, termasuk lampiran, follow-up, CSAT, dan email yang dialihkan? Apakah mekanisme savepoint dan relock benar, dan apakah semua urutan race (merge, balasan, follow-up, merge ulang) punya hasil terdefinisi yang diuji?
3. **Relasi (12-02).** Satu relasi per pasangan, satu parent, tanpa siklus di bawah konkurensi, dan link duplikat hasil merge yang tidak bisa dihapus.
4. **Snooze (12-05).** Job bangun dengan update bersyarat, bangun di kedua jalur balasan di bawah lock D-17, auto-close melewati tiket yang di-snooze di kueri kandidat dan update final, dan filter grammar yang kompatibel dengan saved view `version: 1`.
5. **Feed dan UI (12-06 sampai 12-08).** Scoping organisasi, cek keanggotaan di setiap jalur baru, urutan feed yang stabil, dan tidak ada data target di halaman publik.
6. **Migrasi (12-01)** dan pengamanan indeks, CHECK, dan trigger lama, termasuk kolom `searchVector` yang ditulis tangan.
7. **Pelanggaran piagam.** Checkpoint manusia, scope dibuang, `prisma db push`, `.env`, `rm -rf`, egress baru, container selain `aida` dan `aida-dev-db`, email nyata, nama orang atau path rumah, klaim lulus untuk hasil merah, atau penilaian visual rekaan.

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat, lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.400 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
