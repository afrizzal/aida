# Fase 10 Team: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Konteks: Fase 10 di `.planning/ROADMAP.md`, AIDA-42 sampai AIDA-46 di `.planning/REQUIREMENTS.md`, `.planning/seeds/SEED-007-*.md` dan `SEED-008-*.md`. Batas mengikat: `.planning/run-loop/PIAGAM.md`. Hasilnya menjadi `10-CONTEXT.md`. Fase 08 dan 09 diparkir (lihat `08-REVIEWS.md` dan `09-REVIEWS.md`): Better Auth tetap 1.6.22, belum ada helper IP tepercaya, belum ada CSP. ROADMAP → Cross-phase risks: undangan dibangun di atas versi Better Auth sekarang, dan test undangan harus diulang sesudah upgrade. Pelajaran dari dua fase itu: hindari test yang menjalankan stack compose sungguhan (keputusan owner soal test container masih terbuka) dan hindari protokol data yang rumit; utamakan mekanisme sederhana yang bisa diuji dengan Testcontainers.

## Fakta yang sudah diverifikasi

- `src/lib/auth.ts:22-24`: plugin `organization({ allowUserToCreateOrganization: false })` dan `admin(...)`; tidak ada pengirim email undangan. `better-auth` 1.6.22, `@better-auth/cli` 1.4.21 (versi tidak cocok). Model `member` dan `invitation` ada di `prisma/schema.prisma`. Peran owner, admin, member (`src/lib/authz.ts:5`).
- `getScopedDb` (`src/lib/session.ts:38-43`) hanya memeriksa sesi dan `activeOrganizationId`, tidak memeriksa keanggotaan, jadi member yang dinonaktifkan tetap bisa memakai sesinya. `getOrgRole` membaca baris `member`.
- Belum ada model `Notification`, lonceng, halaman member, kode undangan (temuan v1 F-16), atau parsing mention. Catatan internal sudah ada: `Message.visibility` PUBLIC atau INTERNAL. Email lewat `src/lib/channels/email/`. Antrean pg-boss; job worker ada di `src/lib/worker/jobs/`.

## Area abu-abu

Untuk setiap area: pilih opsi, sebut risikonya, tandai keputusan milik owner.

1. **Undangan (AIDA-42):** pakai fitur undangan plugin organisasi Better Auth atau buat sendiri; token sekali pakai, kedaluwarsa, email yang cocok, batas peran pengundang, link yang bisa disalin saat SMTP mati; pengujian dengan SMTP palsu.
2. **Deaktivasi dan peran (AIDA-43):** di mana cek keanggotaan dipasang supaya halaman, action, route API, dan unduhan lampiran langsung menolak sesi member nonaktif; cara mencegah admin terakhir dihapus oleh dua request bersamaan; pencabutan undangan tertunda; audit event; apakah perlu peran ketiga (requirement menyerahkannya ke CONTEXT).
3. **Notifikasi (AIDA-44):** model, scoping organisasi lewat `scopedDb`, kejadian mana yang membuat notifikasi (assignment, balasan pelanggan, mention, SLA), dibuat sinkron atau lewat pg-boss, lonceng dengan jumlah belum dibaca, baca dan arsip.
4. **Mention (AIDA-45):** sintaks dan parsing, hanya di catatan internal, dan jaminan tidak bocor ke balasan publik atau email pelanggan.
5. **Preferensi dan digest (AIDA-46):** penyimpanan preferensi per jenis kejadian, job digest pg-boss yang tidak mengirim ganda, subjek tanpa PII.
6. **Pemecahan plan** dan wave, dengan bukti mandiri per plan dan tanpa test stack compose.
7. **Yang saya lewatkan.**

## Format jawaban

Bahasa Indonesia. Untuk setiap area: rekomendasi, alasan, risiko, dan status `terverifikasi di kode` atau `belum terverifikasi`. Tandai keputusan milik owner. Paling banyak sekitar 1.500 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
