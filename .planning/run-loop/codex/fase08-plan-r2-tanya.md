# Fase 08 Security Hardening: review plan (siklus 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan siklus 1

Di siklus 1 (sesi terpisah) kamu mereview 18 plan dan memberi 13 temuan: 7 HIGH, 5 MEDIUM, 1 LOW, dengan verdict "plan belum siap". Jawabanmu ada di `.planning/run-loop/codex/fase08-plan-jawab.md`. Saya mengecek setiap klaim fakta ke plan dan kode; semuanya cocok. Disposisi dan "Required properties for the replan" ada di `.planning/phases/08-security-hardening/08-REVIEWS.md`, bagian `## Codex` / `### Cycle 1`. Ringkasnya:

- Diterima: C1 (egress keluar dari suite integration), C2 (probe healthcheck tidak bisa dibuat lapar), C3 (upload dalam batas per berkas), C5 (menulis test terpisah dari menjalankannya; empat status hasil), C6 (E2E mode produksi di host), C7 (limiter Better Auth lewat HTTP sungguhan), C9 sampai C13.
- Sebagian: C4 dan C8 (lihat pertanyaan 3 dan 4).

Plan direvisi menjadi 23 plan dalam 13 wave (commit `6238af7`). Plan baru: 08-19 (pengecualian egress), 08-20 (`/api/health/probe` tanpa throttle, membaca snapshot yang di-cache, ditolak Caddy, dipakai healthcheck compose), 08-21 (`pnpm test:e2e:prod`: `next build` lalu `next start` dengan Postgres Testcontainers, plus `caddy:2` sungguhan di depan server host), 08-22 dan 08-23 (pecahan suite container dari 08-14). Setiap plan yang berubah punya `## Review Dispositions Ledger` / `### Round 1 — 99721fd`. Plan-checker GSD lolos tanpa issue; gerbang otomatis: requirement 8/8, keputusan 30/30.

## Fakta yang sudah saya verifikasi sejak siklus 1

- Next.js mengisi `X-Forwarded-For` yang hilang dengan peer TCP sebelum proxy berjalan: `node_modules/next/dist/server/base-server.js:577` (`req.headers['x-forwarded-for'] ??= ...socket.remoteAddress`). Folder ekspormu tidak berisi `node_modules`, jadi ini tidak bisa kamu cek sendiri. Akibatnya klausul C7 "header hilang masuk bucket bersama" tidak bisa dibuktikan lewat HTTP sungguhan; planner menggantinya dengan perilaku nyata di 08-21 dan mempertahankan kasus unit.
- Better Auth 1.6.22 memasukkan request tanpa IP valid ke satu bucket `no-trusted-ip` (`node_modules/better-auth/dist/api/rate-limiter/index.mjs:275`).
- `binaries.prisma.sh` pulih 09.09 (`GET` 200), tetapi sempat macet lebih dari satu jam, jadi cabang "blocked" tetap wajib.
- Eksekusi plan berurutan (`workflow.use_worktrees` false); satu proses test pada satu waktu.

## Pertanyaan

1. **Penggabungan temuan siklus 1.** Untuk setiap C1 sampai C13, apakah properti yang diminta di `08-REVIEWS.md` benar-benar ada di isi plan yang bisa dieksekusi (task, action, acceptance, verify, must_haves), bukan hanya di ledger? Sebut yang belum, dengan plan dan baris.
2. **Masalah baru di 08-19 sampai 08-23 dan di plan yang ditulis ulang (08-14, 08-16).** Cari kegagalan acceptance, test yang tidak bisa lolos, langkah yang melanggar piagam, dan celah keamanan baru. Khusus `/api/health/probe` (08-20): apakah benar tidak terjangkau lewat Caddy dengan varian path apa pun, dan apakah ia membuka jalur DB tanpa batas atau bocoran informasi?
3. **C4, nama project compose untuk suite container.** Kamu membaca larangan "container dan volume selain milik project `aida` dan `aida-dev-db`" secara harfiah. Argumen saya: piagam yang sama mewajibkan `pnpm test:integration` dan `pnpm test:e2e`, yang membuat container Testcontainers di luar kedua project itu, dan `pnpm test:egress`, yang memakai project `aida-egress-test`. Jadi container yang dibuat dan dibuang oleh suite test AIDA sendiri terbaca sebagai milik AIDA. Selain itu, memakai `aida` untuk test bisa membuat `up`/`down` menimpa stack operator yang sedang jalan. Plan sekarang memakai `aida-hardening-test` plus hex acak per run, mencatat sisa run lama tanpa menyentuhnya, dan teardown hanya project run itu. Apakah argumen ini meyakinkan? Kalau tidak, opsi mana yang paling konservatif dan tetap aman bagi stack operator?
4. **C8, validasi rantai XFF.** Saya menolak validasi entri di kiri indeks tepercaya: entri itu dikendalikan klien, dan gagal tertutup di sana membuat klien bisa sengaja masuk bucket bersama lalu menghabiskannya. Apakah penolakan ini benar, atau ada serangan yang hanya tertutup kalau seluruh rantai divalidasi?
5. **Pelanggaran piagam.** Checkpoint manusia, scope dibuang, edit `package.json` paralel (sekarang 08-01, 08-02, 08-04, 08-21 di wave berbeda), `prisma db push`, sentuhan ke `.env`, `rm -rf`, egress baru produk, atau klaim lulus untuk gerbang merah.

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (file dan baris), dampak, dan perbaikan konkret. Lalu jawaban singkat untuk pertanyaan 3 dan 4. Tutup dengan satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
