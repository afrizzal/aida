# Fase 08, plan 08-08: plan buntu pada test CSP C13-boundary (konsultasi, putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Masalah

Plan `.planning/phases/08-security-hardening/08-08-PLAN.md` (E2E CSP tanpa pelanggaran, D-15; kriteria AIDA-28) diparkir sementara. Hasil eksekusi ada di `08-08-SUMMARY.md` dan commit `wip(parkir)`. Dari 9 test di `tests/e2e/csp.spec.ts`, 8 lolos. Yang gagal adalah test `C13-boundary` (baris sekitar 207).

`GET /status/%E0%A4%A` (encoding URL rusak) menghasilkan halaman HTML Pages Router "400: Bad Request" dari jalur decode-error Next.js. Log test: `PRE-PROXY-BOUNDARY {"status":400,"contentType":"text/html; charset=utf-8","hasCsp":false,"hasScript":true}`. Script di halaman itu membawa nonce per request, jadi `src/proxy.ts` (`forwardWithSecurityHeaders`, CSP dari `src/lib/security/csp.ts`) memang berjalan. Tetapi header respons proxy hilang di jalur ini. Plan mengasumsikan respons ini bukan HTML dan tanpa script.

Akibatnya, `pnpm test:e2e` penuh exit 1 (217 lolos, 1 gagal). Versi `next` yang terpasang: 16.4.6.

Opsi dari eksekutor:
- **(a)** ubah must-have supaya jalur ini boleh mengembalikan HTML;
- **(b)** cari pengaturan atau versi Next.js yang mempertahankan header di halaman galat ini;
- **(c)** biarkan Caddy menambah CSP statis yang ketat ke respons 4xx/5xx yang tidak punya CSP.

## Batas mengikat

- Piagam (`.planning/run-loop/PIAGAM.md`): plan baru boleh diparkir final sesudah 2 perbaikan dan 1 konsultasi Codex.
- CSP tidak boleh dilonggarkan, misalnya dengan `'unsafe-inline'` untuk script.
- Kriteria AIDA-28 ada di `.planning/REQUIREMENTS.md`, keputusan D-11 sampai D-15 di `08-CONTEXT.md`.
- Satu server, Caddy di depan app dalam compose (`Caddyfile`). Test E2E memakai `next dev` tanpa Caddy.

## Pertanyaan

1. Menurut kode yang ada (`src/proxy.ts`, `next.config.ts`, `src/app/`, apakah ada `pages/_error` atau `app/global-error`), di mana header proxy hilang? Adakah perbaikan di sisi aplikasi yang tidak melonggarkan CSP? Contoh yang perlu dinilai:
   - halaman galat sendiri;
   - `headers()` di `next.config.ts` untuk pola URL tertentu, tanpa membuat CSP ganda pada halaman normal;
   - menolak path dengan encoding rusak di proxy lebih dulu, dengan respons non-HTML ber-CSP.
2. Apakah opsi (c) cukup sebagai bukti untuk AIDA-28, padahal E2E berjalan tanpa Caddy? Apa risikonya kalau ada dua header CSP?
3. Apakah opsi (a) jujur? Batasan apa yang harus tertulis kalau dipilih?
4. Rekomendasimu: satu perbaikan konkret dan test yang membuktikannya bisa gagal.

## Format jawaban

Bahasa Indonesia, paling banyak sekitar 700 kata. Tandai setiap klaim dengan `terverifikasi di kode` atau `belum terverifikasi`.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
