# Kritik roadmap v2.0 AIDA (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, jadi tidak ada `node_modules` dan tidak ada riwayat git.

## Yang diminta

Kritik `.planning/ROADMAP.md` dan `.planning/REQUIREMENTS.md`. Baca juga `.planning/run-loop/PIAGAM.md` (mengikat), `.planning/run-loop/FITUR-PROJECTS.md`, `.planning/PROJECT.md`, dan `.planning/seeds/` seperlunya. Cek ke `src/`, `prisma/schema.prisma`, `Dockerfile`, dan `docker-compose.yml` kalau klaimnya menyangkut kode.

Cari secara khusus:

1. Isi tabel fase di piagam, atau baris `FITUR-PROJECTS.md`, yang hilang atau melemah di requirement.
2. Requirement yang acceptance-nya tidak bisa dicek dengan perintah atau test, atau yang menyatukan dua hal sehingga bisa lolos separuh.
3. Urutan fase dan ketergantungan yang salah, termasuk tautan antar fase yang belum tercatat di bagian Cross-phase risks.
4. Requirement yang diam-diam butuh manusia, kredensial asli, atau jaringan, sehingga akan membuat run tanpa manusia macet atau memalsukan bukti.
5. Risiko migrasi, keamanan, atau tenancy yang diremehkan.

## Keputusan yang saya ambil dan ingin kamu serang

| No | Keputusan | Alternatif yang saya tolak |
|---|---|---|
| K1 | `Depends on` hanya memuat rantai parkir piagam (13 butuh 10, 15 butuh 14, 16 butuh 10 dan 14, 17 butuh 13 sampai 16). Tautan lain masuk tabel Cross-phase risks | Menambah ketergantungan keras baru, misalnya 15 butuh 11. Itu mengubah aturan parkir di piagam |
| K2 | Baris piagam Fase 14 hanya logika, Fase 15 hanya tampilan kerja. Halaman daftar dan detail proyek serta drawer task tidak disebut di piagam, jadi saya taruh di Fase 15 (AIDA-72, AIDA-73). Palette untuk Projects saya taruh di Fase 16 (AIDA-86) | Menaruhnya di Fase 14 |
| K3 | Piagam bertujuan menutup semua celah v1. Maka saya menambah temuan yang tidak disebut di tabel Fase 08 dan 09: F-11, F-13, F-14 (AIDA-32) dan F-09, F-10 (AIDA-37) | Hanya mengerjakan yang tertulis di tabel |
| K4 | F-14 punya masalah font: `next/font/google` mengambil Inter saat build. Inter berlisensi OFL, dan daftar lisensi package di piagam hanya MIT, Apache-2.0, BSD, ISC. AIDA-32 membiarkan Fase 08 memilih antara stack font sistem dan mencatat alasan | Langsung memasang paket font |
| K5 | AIDA-56 mengerjakan SEED-004 penuh (enum menjadi tabel), bukan langkah murah di catatan seed, karena piagam menyebut status kustom dengan jeda SLA | Langkah murah: enum tetap, tambah `pendingReason` |

## Batas mengikat

- Piagam, `CLAUDE.md`, dan `PROJECT.md` mengalahkan pendapat siapa pun. Tabel fase piagam tidak boleh diubah, dan isi fase tidak boleh dibuang. Saran mengurangi scope tidak akan dipakai. Kalau sebuah butir terlalu besar, sarankan pemecahan.
- Clean-room modul Projects berlaku. Jangan menyarankan memakai kode repo itu atau Plane.
- Tanpa Redis, satu server, satu `docker compose`.

## Fakta yang sudah saya verifikasi di kode

- `pnpm audit --prod`: 7 critical, 52 high, 69 moderate, 13 low. Modul critical: `next`, `proxy-addr`, `better-auth`.
- `Dockerfile` tidak punya baris `USER` dan tidak menyetel `NEXT_TELEMETRY_DISABLED`.
- `src/app/layout.tsx:2` masih mengimpor `next/font/google`.
- Tidak ada Content-Security-Policy di `src`, `next.config.ts`, maupun `Caddyfile`.
- Tiga route publik memakai token kiri `x-forwarded-for`. `Caddyfile` tidak menyetel `trusted_proxies`.
- `checkRateLimit` hanya dipakai di `intake`, `csat`, dan `follow-up`.
- Healthcheck compose memanggil `/api/health` lewat `127.0.0.1:3000` dari dalam container.
- `.slice(0, 200)` pesan error mentah ada di 4 titik: `settings/actions.ts:99`, `:162`, `settings/email/actions.ts:102`, `:133`.
- `prisma/seed.ts:31` memanggil `ensureDemoIdentities()` sebelum cek `ticket.count` di baris 34. Baris 59 sampai 60 mencetak password.
- `scripts/backup.sh` menjalankan `pg_dump` lewat `docker compose exec db`, dan image app tidak punya `pg_dump`.
- Skema punya 25 model. Belum ada Notification, Project, Task, Team, SavedView, atau ApiToken.
- `AIDA-10` di v1 tercatat selesai walaupun alur undangan tidak ada (temuan F-16).

## Format jawaban

Tulis dalam bahasa Indonesia, paling banyak 15 temuan, urut dari yang paling berat. Untuk tiap temuan:

- Tingkat: HIGH, MEDIUM, atau LOW.
- Letak: ID requirement, nomor fase, atau baris file.
- Masalah dan akibatnya, dalam dua atau tiga kalimat.
- Perubahan konkret yang kamu sarankan.
- Status: `terverifikasi di kode` atau `belum terverifikasi`.

Sesudah itu jawab K1 sampai K5 satu per satu: setuju atau tidak, dengan alasannya.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
