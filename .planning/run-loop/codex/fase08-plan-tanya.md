# Fase 08 Security Hardening: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

18 plan di `.planning/phases/08-security-hardening/08-01-PLAN.md` sampai `08-18-PLAN.md`, untuk requirement AIDA-25 sampai AIDA-32 (`.planning/REQUIREMENTS.md`). Keputusan yang mengikat ada di `08-CONTEXT.md` (D-01 sampai D-30, hasil brainstorm denganmu di putaran sebelumnya: `.planning/run-loop/codex/fase08-jawab.md`). Peta pola kode ada di `08-PATTERNS.md`. Batas run ada di `.planning/run-loop/PIAGAM.md`, terutama "Aturan owner 2026-11-08", "Aturan teknis AIDA", "Test dan bukti", dan "Larangan".

Urutan wave: 1 = 08-01, 08-05, 08-06, 08-17; 2 = 08-02, 08-07; 3 = 08-03, 08-04; 4 = 08-08, 08-09; 5 = 08-10; 6 = 08-11, 08-18; 7 = 08-12, 08-13; 8 = 08-14; 9 = 08-15; 10 = 08-16.

## Fakta yang sudah saya verifikasi

- Baseline di Mac ini (kode sama dengan v1): `pnpm build` exit 0. `pnpm test:integration`: 11 dari 12 berkas lolos; satu-satunya yang gagal adalah `egress-isolation.test.ts` (ikut terjaring `include`). `pnpm test:e2e`: 63 lolos, 2 gagal di `honesty-invariants.spec.ts`, yang lolos 2/2 saat dijalankan sendirian. `taskkill` (perintah Windows) dipakai di teardown `honesty-invariants`, `phase4-ai`, dan `phase5-rag`; plan 08-17 menanganinya.
- Gangguan luar sejak 2026-11-08 07.45 dan masih berlangsung 08.59: `binaries.prisma.sh` menjawab `HEAD` 200, tetapi `GET` engine 0 byte. Akibatnya setiap build image Docker macet di `@prisma/engines postinstall`, termasuk `pnpm test:egress` dan `docker compose -p aida up --build`. Mirror pihak ketiga dilarang. Engine macOS sudah ada di cache host, jadi `next build`, `prisma generate`, dan Testcontainers di host tetap jalan.
- `workflow.use_worktrees` bernilai `false`, jadi `execute-phase` menjalankan plan satu per satu di working tree utama. Hanya satu proses test boleh berjalan pada satu waktu.
- Plan-checker GSD: 0 blocker sesudah satu revisi. Requirement 8/8 dan keputusan 30/30 tercakup menurut gerbang otomatis.

## Pertanyaan

Untuk setiap temuan, sebut plan dan task, bukti (file dan baris di plan atau kode), dampaknya, dan perbaikan konkret yang bisa ditulis ke PLAN.md. Beri severity HIGH (plan akan gagal mencapai acceptance, melanggar piagam, atau membuka celah keamanan), MEDIUM, atau LOW.

1. **Bukti yang bergantung pada image Docker.** 08-09, 08-14, dan 08-16 membutuhkan build image, yang kini terhalang. Bagian mana dari AIDA-27 (non-root), AIDA-29 (spoofing lewat Caddy sungguhan, D-19), AIDA-30 (healthcheck tetap hijau), dan AIDA-28 (kebijakan CSP produksi) yang sebenarnya bisa dibuktikan tanpa image, misalnya `next build` lalu `next start` di host dengan Postgres Testcontainers, atau image `caddy` resmi yang tidak bergantung pada Prisma? Apakah plan sekarang membedakan dengan jujur "terbukti", "terhalang", dan "belum"? Apakah ada plan yang akan macet total kalau host Prisma tidak pulih?
2. **Upgrade dependensi (08-01 sampai 08-04).** Apakah bukti upgrade Better Auth cukup: sesi lama bertahan, keanggotaan organisasi, `/setup`, bootstrap, dan `prisma migrate deploy` dari skema v1 berisi data? Apakah "versi 16.x terbaru yang >= 16.4.1" dan "1.7.x terbaru yang >= 1.7.7" cukup deterministik dan tercatat? Apakah pemindahan `shadcn` dan tabel residual tidak mengakali audit?
3. **CSP (08-07, 08-08).** Planner memilih hash sha256 untuk style tag `sonner`, `setNonce` dari `get-nonce` untuk scroll lock Radix, dan `style-src-attr 'unsafe-inline'`. E2E berjalan di `next dev` dengan `'unsafe-eval'`. Apakah ini memenuhi AIDA-28 ("blocks inline script without a nonce", "zero CSP violations")? Adakah jalur bypass, misalnya header `x-nonce` dari klien, cache HTML yang memakai ulang nonce, atau rute yang lolos dari matcher proxy?
4. **IP klien (08-10, 08-18).** Proxy menyetel `x-aida-client-ip` dan Better Auth membaca hanya header itu. `TRUSTED_PROXY_HOPS` 0 sampai 10, kunci IPv6 diringkas ke /64, Caddy `header_up X-Forwarded-For {remote_host}`. Cari jalan spoofing, termasuk request langsung ke route handler tanpa melewati proxy, dan perilaku saat header hilang atau cacat.
5. **Abuse route publik (08-11, 08-12, 08-13).** Apakah limiter benar-benar atomik di Postgres? Apakah throttle `/api/health` dalam memori bisa memutus healthcheck container? Apakah batas byte 32/32/31 MiB benar diterapkan pada byte yang diterima, termasuk chunked, dan apakah berkas tersimpan dibersihkan saat gagal?
6. **Sisa (08-05, 08-06, 08-17, 08-15, 08-16).** Error koneksi berkategori tanpa bocoran, font sistem, telemetri, Dependabot dan job audit, perbaikan harness E2E, rekonsiliasi `docs/SECURITY.md`, dan kejujuran gerbang akhir.
7. **Urutan dan ketergantungan.** Apakah ada plan yang membaca hasil plan lain yang belum ada pada wave-nya? Apakah ada plan yang terlalu besar untuk satu eksekutor?
8. **Pelanggaran piagam.** Checkpoint manusia, scope yang dibuang, edit `package.json` paralel, `prisma db push`, sentuhan ke `.env`, `rm -rf`, egress baru, atau klaim lulus untuk gerbang merah.

## Format jawaban

Bahasa Indonesia. Mulai dengan daftar temuan dari yang paling berat, lalu ringkasan satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim fakta `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
