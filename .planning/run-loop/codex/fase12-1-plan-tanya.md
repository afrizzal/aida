# Fase 12.1 Status kustom dan jeda SLA: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

17 plan di `.planning/phases/12.1-ticket-lifecycle-custom-states-and-sla-pause/12.1-01-PLAN.md` sampai `12.1-17-PLAN.md` (7 wave) untuk AIDA-56, AIDA-97, dan AIDA-57. Keputusan mengikat: `12.1-CONTEXT.md` (D-01 sampai D-19 dan bagian "Amendments after pattern mapping", yang menggantikan D-03, D-07, D-10, D-11, D-12, D-15), dari brainstorm denganmu di `.planning/run-loop/codex/fase12-1-jawab.md`. Kontrak UI: `12.1-UI-SPEC.md` (disetujui). Peta pola: `12.1-PATTERNS.md`. Batas run: `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Plan checker GSD lolos di putaran 2 tanpa blocker dan warning. Putaran 1 menemukan satu blocker: verifikasi plan 05 (wave 2) menjalankan test yang memanggil `mergeTickets`, padahal isi `merge.ts` baru dimigrasi plan 07. Revisi memindahkannya, lalu mengaudit seluruh plan untuk kelas yang sama dan memperbaiki delapan kasus lain.
- Wave akhir: 1: 01, 02; 2: 03, 04, 05, 10, 11; 3: 06, 08, 09, 13, 14; 4: 07, 12; 5: 15; 6: 16; 7: 17.
- Repo sengaja tidak lolos typecheck dari plan 01 (enum dibuang) sampai plan 15. Tiap plan di jendela itu memakai cek `tsc` yang dibatasi ke berkasnya sendiri; vitest dan Playwright tetap menjalankan kode saat runtime.
- Keputusan run sesudah brainstorm: K40 (default di group OPEN), K41 (hapus hanya dengan pengganti satu group), K42 (hapus adalah soft delete; audit hanya `stateId` dan `stateGroup`, tanpa teks bebas), K43 (state default dan konfigurasi dibuat trigger database `AFTER INSERT ON "organization"`, karena ada dua jalur pembuatan organisasi dan banyak fixture).
- Urutan lock: baris konfigurasi, lalu state, lalu tiket menaik; penulis membaca state tujuan `FOR SHARE`; lock tiket tidak pernah join `TicketState`.
- Catatan terbuka dari plan check (info, belum masuk plan): di plan 06 penjaga CLOSED di `src/lib/tickets/snooze.ts:116` masih membaca `row.status`, yang tidak ada lagi sejak plan 01, sampai plan 07 memigrasinya; kasus snooze plan 06 lolos tanpa menguji penjaga itu.
- Probe deterministik: 50 perintah verifikasi, semua path resolve dan semua punya `<fails_when>`.

## Pertanyaan

Untuk setiap temuan: plan dan task, bukti (berkas dan baris), dampak, dan perbaikan konkret. Severity HIGH (acceptance gagal, melanggar piagam, celah keamanan atau tenancy, data hilang saat migrasi, nama state internal bocor ke publik), MEDIUM, atau LOW.

1. **Kontradiksi internal.** Tiga fase sebelumnya diparkir karena kelas ini: acceptance atau grep yang menunjuk berkas lain dari tempat aksi menaruh kodenya; test atau E2E yang mengharapkan hasil yang bertentangan dengan plan lain; helper test yang tidak bisa mengamati perilaku PostgreSQL sebenarnya. Cari juga test yang lolos secara kebetulan karena kode yang belum dimigrasi (seperti catatan snooze di atas).
2. **Migrasi (plan 01, 03).** Apakah data, saved view `version: 1` ke `version: 2`, awal jeda tiket PENDING, trigger organisasi, objek tulisan tangan lama (`searchVector`, GIN, CHECK, trigger audit), dan pembuangan enum benar, atomik, dan terbukti tanpa kehilangan data? Apakah test migrasi di database tersendiri benar-benar menguji migrasi dari keadaan `20261109100000_ticket_lifecycle`?
3. **Jendela merah typecheck.** Apakah cek `tsc` terbatas tiap plan cukup, dan adakah plan yang verifikasinya bisa lolos hampa karenanya? Apakah plan 15 realistis mengembalikan typecheck dan lint ke hijau?
4. **Konkurensi (plan 04, 06, 07, 08).** Urutan lock, soft delete melawan penulis (`FOR SHARE`), jeda dan resume melawan worker `sla-flag`, merge sumber pending, reopen saat balasan, auto-close. Adakah deadlock, urutan tak terdefinisi, atau test race yang lolos karena timing?
5. **Jeda SLA (AIDA-57).** Apakah rumus dan test (beberapa jeda dengan panjang terkontrol, restart, first response saat jeda, perubahan prioritas) benar-benar membuktikan acceptance AIDA-57, termasuk tiket yang pending saat migrasi?
6. **Pembaca dan privasi.** Apakah setiap pembaca status di matriks D-11 tercakup dan diuji, dan apakah halaman publik dan loader-nya tidak pernah membawa nama, id, atau warna state internal? Apakah kontrak URL `state=` dan saved view gagal tertutup (tidak pernah melebar)?
7. **Pelanggaran piagam.** Checkpoint manusia, scope dibuang, `prisma db push`, `.env`, `rm -rf` (menghapus `.next/` adalah butir owner yang terbuka), egress baru, container selain `aida` dan `aida-dev-db`, email nyata, nama orang atau path rumah, klaim lulus untuk hasil merah, atau penilaian visual rekaan.

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat, lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.500 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
