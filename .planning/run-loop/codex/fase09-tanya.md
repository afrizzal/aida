# Fase 09 Operations: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Konteks: Fase 09 di `.planning/ROADMAP.md`, requirement AIDA-33 sampai AIDA-41 di `.planning/REQUIREMENTS.md`, `.planning/seeds/SEED-010-repo-health-installer-version-gate.md`, dan `.planning/milestones/v1.0.0-phases/07-launch-readiness/deferred-items.md`. Batas mengikat ada di `.planning/run-loop/PIAGAM.md`, terutama "Aturan owner 2026-11-08", "Aturan teknis AIDA", "Test dan bukti", dan "Larangan". Hasil brainstorm ini akan menjadi `09-CONTEXT.md`.

## Keadaan run

- Fase 08 (Keamanan) **diparkir** sesudah tiga siklus review plan (`.planning/phases/08-security-hardening/08-REVIEWS.md`). Kodenya belum berubah: belum ada helper IP klien tepercaya, limiter masih `count` lalu `create`, container masih root, belum ada CSP. Fase 09 tidak bergantung pada 08 menurut rantai parkir piagam, tetapi banyak menyentuh berkas yang sama (`docker-compose.yml`, `Dockerfile`, `docs/OPERATIONS.md`, `src/proxy.ts`).
- Siklus 3 review Fase 08 menemukan bahwa setiap test yang menjalankan stack compose sungguhan menyentuh VM Docker yang dipakai bersama project lain. Larangan piagam hanya mengizinkan container dan volume project `aida` dan `aida-dev-db`. Pertanyaan apakah suite test boleh memakai project sendiri sedang menunggu owner. Suite yang disebut piagam (Testcontainers untuk integration dan E2E, serta `pnpm test:egress` dengan `aida-egress-test`) tetap jalan.
- Test di mesin ini: unit lolos, integration lolos (kecuali berkas egress), E2E lolos dengan dua flake yang diketahui. Hanya satu proses test pada satu waktu.

## Fakta yang sudah saya verifikasi

| Hal | Fakta |
|---|---|
| Backup | `scripts/backup.sh` menjalankan `pg_dump --format=custom` lewat service `db`, lalu `tar czf` atas `/data/uploads` lewat `docker compose run app`. Dua langkah terpisah, tanpa snapshot bersama, tanpa jadwal, tanpa retensi. `scripts/restore.sh` memakai `pg_restore --clean --if-exists` |
| `POSTGRES_PASSWORD` | `docker-compose.yml` baris 29, 49, dan 101 menyisipkan password mentah ke `DATABASE_URL` untuk `migrate`, `app`, `worker`. `prisma.config.ts` membaca `env("DATABASE_URL")` |
| Seed dan demo | `prisma/seed.ts` memanggil `ensureDemoIdentities()` (baris 31) sebelum guard jumlah tiket (baris 34) dan mencetak password (baris 59). `src/lib/demo/bootstrap-demo.ts` hanya memeriksa `prisma.ticket.count()`. Boot dipanggil dari `src/instrumentation.ts`. Heartbeat worker (`src/lib/worker/jobs/heartbeat.ts`) meng-upsert `SystemSetting` setiap menit |
| Logo | Branding v1 hanya nama (`src/lib/branding/settings.ts`, keputusan D-16 v1), disimpan sebagai `Setting` per organisasi. Halaman publik (`/request`, `/status/[token]`) memilih organisasi dengan `prisma.organization.findFirst()`. Upload lampiran sudah memakai sniffing byte (`file-type`) dan `UPLOADS_DIR` |
| `<h1>` | `src/components/top-bar.tsx` merender `<h1>`, dan 12 halaman app serta `ticket-meta-header.tsx` juga punya `<h1>` sendiri. `src/app/(public)/status/[token]/page.tsx` punya dua `<h1>` |
| Test | Tidak ada test demo boot, guard seed, atau backup/restore di `tests/`. Buktinya dulu sekali jalan di `07-VERIFICATION.md` |
| Phase 1 v1 | `milestones/v1.0.0-phases/01-foundation/` tidak punya `01-VERIFICATION.md`; ada `01-UAT.md` dan SUMMARY |
| SEED-010 | Belum ada `scripts/install.sh`, `AGENTS.md`, `.github/CODEOWNERS`, workflow `check-version`. `package.json` tidak punya field `version` |
| Piagam | Repo publik: dilarang menulis rahasia, nama orang, atau path rumah ke berkas yang dilacak. Package baru: versi disematkan, lisensi MIT/Apache-2.0/BSD/ISC. Tanpa Redis; antrean pg-boss. Egress baru wajib masuk `docs/SECURITY.md` dan test egress |

## Area abu-abu

Untuk setiap area: pilih opsi, sebut risikonya, dan tandai kalau keputusannya milik owner.

1. **Backup terjadwal (AIDA-33).** Di mana backup berjalan "di dalam satu stack compose": (a) job pg-boss di `worker`, yang butuh `pg_dump` di image Node (paket apk baru); (b) service compose khusus berbasis image Postgres yang sudah dipakai, dengan loop dan jadwal; (c) cara lain. Bagaimana menjamin set yang konsisten saat lampiran ditambah, diganti, atau dihapus di tengah run: snapshot `pg_dump` lalu arsip hanya berkas yang dirujuk snapshot itu (gagal kalau berkas hilang), penundaan hapus fisik berkas, atau cara lain? Di mana set disimpan, bagaimana status gagal dilaporkan ke admin, retensi, dan cara mematikannya. Logo (AIDA-34) juga harus ikut.
2. **Test backup/restore (AIDA-33, AIDA-38).** Acceptance meminta restore "ke stack terisolasi". Mengingat keadaan run di atas, apakah logika backup dan restore bisa diuji dengan Testcontainers (Postgres sekali pakai dan direktori sementara) tanpa stack compose, dan apakah itu memenuhi acceptance? Apa yang tetap butuh bukti stack sungguhan?
3. **Logo (AIDA-34).** Penyimpanan, format yang diizinkan (SVG ditolak), batas ukuran, route publik yang di-throttle dan masuk `PUBLIC_PREFIXES`, cache, logo organisasi mana di halaman publik, dan tampilan di sidebar menurut `.planning/DESIGN-SYSTEM.md`. Throttle: pakai `checkRateLimit` yang ada (masih rentan spoofing dan tidak atomik karena Fase 08 diparkir) atau yang lain?
4. **Password URL (AIDA-35).** Opsi: (a) entrypoint yang menyusun dan meng-encode `DATABASE_URL` dari bagian-bagiannya; (b) `prisma.config.ts` dan klien app menyusun URL ter-encode dari variabel terpisah; (c) variabel `DATABASE_URL` terpisah yang wajib diisi operator; (d) lainnya. Acceptance menyebut "`DATABASE_URL` yang di-resolve `docker compose config` untuk setiap service yang memakainya". Bagaimana membuktikannya tanpa mencetak password, dan bagaimana dengan `backup.sh`, `restore.sh`, dan compose egress?
5. **Satu `<h1>` (AIDA-36).** Top bar atau halaman yang memegang `<h1>`? Dampaknya pada aksesibilitas, design system, dan halaman yang hanya mengandalkan judul top bar.
6. **Guard seed dan demo (AIDA-37).** Definisi data tenant, cara mengenali "hanya organisasi demo dan identitas demo", dan urutan supaya tidak ada tulisan sebelum guard. Bagaimana test membandingkan jumlah baris setiap tabel sebelum dan sesudah.
7. **`01-VERIFICATION.md` (AIDA-39) dan `STATE.md` (AIDA-41).** Bukti apa yang pantas untuk fase yang sudah dikirim tujuh bulan lalu, dan bagaimana menandai cek yang hanya bisa dilakukan manusia.
8. **SEED-010 (AIDA-40).** `install.sh`: bagaimana menguji terhadap "stand-in rilis" lokal tanpa jaringan, dan bagaimana installer membuat password yang aman untuk URL. `check-version`: `package.json` belum punya `version`; versi berapa yang dipakai tanpa mendahului keputusan rilis owner? `CODEOWNERS` wajib berisi handle GitHub, padahal piagam melarang nama orang di berkas yang dilacak. Widget README (Repobeats, contrib.rocks) memuat gambar pihak ketiga dan Repobeats butuh akun. Mana yang milik owner?
9. **Benturan dengan Fase 08 yang diparkir.** Fase 09 mengubah berkas yang juga diubah plan Fase 08. Apa yang harus dicatat atau dihindari supaya Fase 08 bisa dilanjutkan nanti tanpa merusak hasil Fase 09, dan sebaliknya?
10. **Pemecahan plan.** Usulkan pembagian plan dan wave, dengan bukti mandiri per plan.
11. **Yang saya lewatkan.** Risiko lain dari kode atau dokumen yang relevan untuk Fase 09.

## Format jawaban

Bahasa Indonesia. Untuk setiap area: rekomendasi, alasan, risiko, dan status `terverifikasi di kode` atau `belum terverifikasi` untuk setiap klaim fakta. Tandai keputusan yang milik owner. Paling banyak sekitar 1.800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
