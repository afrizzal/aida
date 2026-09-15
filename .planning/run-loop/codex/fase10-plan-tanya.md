# Fase 10 Tim: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

14 plan di `.planning/phases/10-team/10-01-PLAN.md` sampai `10-14-PLAN.md` (6 wave), untuk AIDA-42 sampai AIDA-46. Keputusan mengikat ada di `10-CONTEXT.md` (D-01 sampai D-29, dari brainstorm denganmu: `.planning/run-loop/codex/fase10-jawab.md`). Kontrak UI ada di `10-UI-SPEC.md`. Batas run ada di `.planning/run-loop/PIAGAM.md`.

Fase 08 dan 09 diparkir sesudah tiga siklus review masing-masing (`.planning/phases/08-security-hardening/08-REVIEWS.md`, `.planning/phases/09-operations/09-REVIEWS.md`). Kodenya tidak ada: `better-auth` masih 1.6.22, tanpa helper IP klien tepercaya, tanpa CSP. Pelajarannya mengikat di sini: tanpa test stack compose, dan mekanisme sederhana yang bisa dibuktikan Testcontainers (row lock, update bersyarat, unique constraint, satu transaksi).

## Fakta yang sudah saya verifikasi

- Plan-checker GSD lolos, tetapi pemeriksaannya dipersingkat: frontmatter, jumlah task, cakupan keputusan, dan batas run; aksi tiap task tidak dibaca baris per baris. Jadi bacaan barismu yang pertama.
- Cakupan keputusan 29/29; AIDA-42 sampai 46 tercakup; tanpa `checkpoint:human-verify`.
- Tanpa package baru: `package.json` hanya muncul sebagai syarat "tidak berubah" (10-05) dan bacaan skrip (10-14).
- Tanpa test stack compose: satu-satunya perintah compose adalah `docker compose config --quiet` di 10-09, yang tidak menyalakan apa pun.
- Di kode `HEAD`: `getScopedDb` (`src/lib/session.ts`) hanya memeriksa sesi dan `activeOrganizationId`, tidak memeriksa keanggotaan; `scopedDb` tidak menyuntik organisasi untuk `findUnique`, `createMany`, `aggregate`, `groupBy`, dan SQL mentah; `assignTicket` tidak memeriksa keanggotaan assignee; `sla-flag` menjalankan dua `UPDATE` global mentah.

## Pertanyaan

Untuk setiap temuan: plan dan task, bukti (file dan baris), dampak, dan perbaikan konkret. Severity HIGH (acceptance gagal, melanggar piagam, atau celah keamanan), MEDIUM, atau LOW.

1. **Cek keanggotaan di setiap request (10-02, D-08).** Apakah helper membaca ulang baris `member` dari database di setiap jalur: halaman dan layout `(app)`, server action, route API, unduhan lampiran (`src/app/api/attachments/[id]/route.ts`), worker, dan halaman status publik? Adakah jalur yang masih memakai `getScopedDb` lama atau cache cookie 5 menit? Apakah inventarisnya lengkap dan dibuktikan test, bukan grep saja?
2. **Penutupan endpoint plugin (10-02, D-02).** Apakah semua endpoint plugin organization yang membuat, menerima, membatalkan, atau menolak undangan, atau menambah, mengubah, menghapus member, termasuk `set-active`, benar-benar tertutup di 1.6.22? Apakah test membuktikannya lewat HTTP?
3. **Keamanan token undangan dan batas peran (10-05, 10-08, D-03 sampai D-06).** Token 256 bit berhash, kedaluwarsa, tidak masuk log atau referrer, base URL dari konfigurasi; email yang cocok; peran tidak melebihi peran pengundang saat dibuat dan saat diterima; penerimaan bersamaan; membuat akun dengan email terkunci tanpa membuka sign-up umum; redirect untuk pengguna yang sudah login.
4. **Race admin terakhir (10-03, D-09, D-10).** Lock baris organisasi, cek ulang peran pelaku, hitung owner dan admin, ubah, cabut undangan, audit. Apakah semua jalur (ubah peran, nonaktifkan, keluar, terima undangan yang mengubah peran) memakai lock yang sama? Apakah test benar-benar menyelingi dua transaksi?
5. **Tenancy notifikasi (10-01, 10-04, D-14, D-15, D-28).** Satu modul, hanya operasi yang di-scope, selalu memfilter penerima; test isolasi tanpa mock untuk organisasi dan penerima; tabel `NotificationDigest` dan `MemberAuditEvent` juga di-scope; append-only di level database.
6. **Kebocoran mention (10-07, 10-12, D-20, D-21).** Mention hanya di `INTERNAL`; payload HTTP langsung, pergantian mode composer, halaman status publik, email keluar ke pelanggan, dan render markdown. Apakah ada jalur di mana id atau nama yang di-mention sampai ke pelanggan?
7. **Digest (10-09, D-23 sampai D-25).** Klaim batch per penerima dengan `FOR UPDATE SKIP LOCKED`, lease, dedup saat dua worker berlomba dan saat gagal sesudah server SMTP menerima, cek ulang keanggotaan dan preferensi sebelum kirim, subjek konstan tanpa PII, isi tanpa nama, email, subjek tiket, atau teks pesan; tidak dikirim saat SMTP mati.
8. **Pembuat notifikasi (10-06, D-16 sampai D-18).** Sinkron di transaksi penyebab; semua jalur balasan pelanggan; transisi SLA memakai `RETURNING`; assignee harus member aktif.
9. **Pelanggaran piagam.** Checkpoint manusia, scope dibuang, `prisma db push`, `.env`, `rm -rf`, egress baru tanpa `docs/SECURITY.md` dan `tests/integration/egress-isolation.test.ts`, container selain `aida` dan `aida-dev-db`, email nyata, script inline yang bertentangan dengan rencana CSP, nama orang atau path rumah di berkas yang dilacak, klaim lulus untuk hasil merah, atau penilaian visual rekaan.

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat, lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.400 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
