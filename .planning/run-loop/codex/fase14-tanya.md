# Fase 14 Fondasi Projects: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Konteks: Fase 14 di `.planning/ROADMAP.md` (bagian "Phase 14: Projects Foundation", tujuh kriteria sukses, tanpa UI), requirement AIDA-64 sampai AIDA-71 dan AIDA-100 sampai AIDA-105 di `.planning/REQUIREMENTS.md`, daftar perilaku di `.planning/run-loop/FITUR-PROJECTS.md`, dan batas mengikat di `.planning/run-loop/PIAGAM.md` (terutama "Clean-room modul Projects", aturan E, "Aturan teknis AIDA", dan Larangan). Fase 15 (tampilan kerja) dan 16 (ruang kerja) akan memakai lapisan logika fase ini; Fase 10 (undangan dan peran) diparkir, dan Fase 16 bergantung padanya. Hasil brainstorm menjadi `14-CONTEXT.md`.

Clean-room: produk rujukan tanpa lisensi; yang boleh hanya `FITUR-PROJECTS.md` dan perilaku demo yang sudah dicatat di sana. Jangan menyebut, menebak, atau meniru kode, nama tabel, teks UI, atau tata letak produk rujukan.

## Fakta yang sudah diverifikasi di kode

- Semua model per organisasi lewat `scopedDb` (`src/lib/scoped-db.ts`); `scopedDb` hanya menambah filter organisasi pada sebagian operasi (code review Fase 12.2 mencatat yang tidak: `findUnique*`, `findFirstOrThrow`, `aggregate`, `groupBy`, `createMany*`, `updateManyAndReturn`), jadi kode fase terakhir menulis term organisasi sendiri dan memakai FK komposit `(organizationId, id)` (lihat migrasi `prisma/migrations/20261111100000_kb_proposals`).
- Nomor tiket: `TicketCounter` per organisasi (`prisma/schema.prisma:310`), di-upsert di dalam transaksi pembuatan (`src/lib/tickets/create-ticket.ts:97`), dengan test konkurensi.
- Lampiran: model `Attachment` (`schema.prisma:435`) wajib terkait `messageId`; penyimpanan di `src/lib/attachments/` (`file-storage.ts`, `local-file-storage.ts`, `staged-files.ts`).
- Markdown tersanitasi: `src/lib/markdown/render.ts` (`renderMarkdown`; Fase 12.2 menambah `renderMarkdownPreview` yang mematikan tautan dan gambar remote).
- Riwayat tiket: `TicketAuditEvent` (`schema.prisma:661`: actor, action, before, after JSON, batchId). `AuditEvent` append-only di level database dan khusus AI (keputusan D-07 Fase 11). AIDA-103 dan AIDA-104 meminta "writes an audit event" untuk hapus; konflik serupa untuk merge tiket sudah menjadi butir owner 12-o1 yang belum dijawab.
- Peran organisasi: tabel `member` Better Auth dengan `role` owner, admin, member; tabel itu tanpa kunci unik `(organizationId, userId)` (butir owner 12.2-o4); Fase 12.2 memakai `findConservativeMembership` (`src/lib/membership.ts`): admin hanya bila semua baris owner atau admin.
- Tidak ada setelan zona waktu di `src/lib` (grep kosong); preferensi zona waktu per pengguna adalah AIDA-98 (Fase 16).
- Antrean pg-boss (`src/lib/worker/index.ts`), tanpa Redis.

## Area abu-abu

Untuk setiap area: rekomendasi, alasan, risiko, status `terverifikasi di kode` atau `belum terverifikasi`; tandai keputusan milik owner.

1. **Model data dan integritas.** Project, keanggotaan proyek, Task, subtask (relasi diri atau model sendiri; kedalaman), komentar, lampiran (model baru, atau `Attachment` dibuat polimorfik), label, milestone, Team dan anggotanya, penugasan tim ke proyek, favorit per pengguna, kunci task dan alias kunci lama. FK komposit dan CHECK mana yang mencegah relasi lintas proyek dan lintas organisasi (AIDA-66, AIDA-71)?
2. **Proyek privat (AIDA-71).** Siapa yang boleh membaca dan mengubah proyek privat: anggota proyek, anggota tim yang ditugaskan, owner dan admin organisasi? Bagaimana menegakkannya di setiap jalur (satu helper yang wajib dipanggil, view atau fungsi SQL, atau RLS) dan membuktikannya tanpa mock? Apa yang terjadi saat task dipindah ke proyek privat atau keluar darinya?
3. **Aktivitas (AIDA-68) dan audit hapus (AIDA-103, AIDA-104).** Satu tabel aktivitas append-only per organisasi (actor, verb, old, new) untuk proyek dan task: apakah baris aktivitas bertahan saat proyek atau task dihapus, dan bagaimana tanpa FK cascade? Bagaimana memenuhi "writes an audit event" tanpa melanggar D-07, dan bagian mana yang harus jadi butir owner?
4. **Kunci task (AIDA-101, AIDA-103).** Prefix per proyek dan counter per proyek di bawah konkurensi; prefix berubah; task dipindah mendapat kunci baru sementara tautan lama tetap resolve (alias); duplikat.
5. **Task berulang (AIDA-102).** Bentuk aturan (harian, mingguan, bulanan), akhir bulan, zona waktu tanpa setelan zona waktu (organisasi atau UTC sampai AIDA-98), dan "tepat sekali" saat penyelesaian di-retry atau dua penyelesaian bersamaan (constraint unik apa).
6. **Urutan dan operasi untuk Fase 15.** Reorder di list dan board (posisi integer, fractional index, atau lexorank), pindah status, bulk update, ubah tanggal (start setelah due ditolak), semua diotorisasi di server. Bentuk API logika (service di `src/lib/projects/`, kode penolakan bertipe seperti Fase 12.2) dan konkurensi (versi atau lock).
7. **Progres dan status proyek (AIDA-100, AIDA-66).** Rumus progres proyek dari task (dengan atau tanpa subtask, task terarsip) dan progres task dari subtask; set status proyek yang tetap; proyek kosong.
8. **Arsip, favorit, duplikat, pindah, hapus (AIDA-70, AIDA-103, AIDA-104).** Soft atau hard delete, apa yang ikut terduplikasi (anggota, label, milestone, subtask, komentar, lampiran), dan konfirmasi hapus di lapisan logika.
9. **Tim tanpa Fase 10.** Team dibangun di atas anggota organisasi yang ada; apa yang harus ditunda ke Fase 16 (guest, AIDA-110) agar tidak ada kontradiksi.
10. **Pemecahan plan dan urutan.** Fase ini besar (14 requirement). Berapa plan dan wave yang aman (pelajaran fase lalu: bekukan kontrak dulu, plan kecil, tidak ada kontradiksi antar plan, test tanpa mock dengan Testcontainers, tanpa sleep), dan apa yang perlu dibekukan lebih dulu?
11. **Yang saya lewatkan.**

## Format jawaban

Bahasa Indonesia. Untuk setiap area: rekomendasi, alasan, risiko, dan status `terverifikasi di kode` atau `belum terverifikasi`. Tandai keputusan milik owner. Paling banyak sekitar 1.800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
