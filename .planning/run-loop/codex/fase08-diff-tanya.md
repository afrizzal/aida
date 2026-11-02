# Fase 08 Keamanan, Bagian A: kritik diff fase (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang dikritik

Kode Bagian A Fase 8 sudah dieksekusi (18 plan), digerbang (08-24), di-review empat bagian, dan diperbaiki dalam lima batch F1 sampai F5. Bagian B (Fase 8.1: harness container, bukti HTTP dan Caddy sungguhan, gerbang compose, classifier CI egress) sengaja ditunda menurut `08-SPLIT.md`; jangan menilai ketiadaannya sebagai temuan, tetapi nilai kode Bagian A yang salah.

Berkas produk utama: `src/proxy.ts`, `src/lib/security/csp.ts`, `next.config.ts`, `src/app/layout.tsx`, `src/components/theme-provider.tsx`, `src/lib/auth.ts`, `src/lib/rate-limit/` (semua modul), `src/lib/health/health-check.ts`, `src/lib/http/read-bounded-form-data.ts`, `src/lib/attachments/`, `src/lib/public-forms/limits.ts`, `src/lib/connection-test/`, `src/lib/channels/email/test-connection.ts`, route `src/app/api/health/` dan `src/app/api/public/`, `src/app/(app)/settings/` (aksi dan tombol test koneksi), `Caddyfile`, `Dockerfile`, kedua berkas compose, `.github/` (workflow dan Dependabot), `scripts/test-image-check.ts`, `scripts/part-a-gate-check.ts`, `docs/OPERATIONS.md`, `docs/SECURITY.md`, dan dua halaman website di `website/src/content/docs/`. Test di `tests/`.

Konteks: `.planning/phases/08-security-hardening/` (`08-CONTEXT.md` D-01 sampai D-28, `08-SPLIT.md`, SUMMARY tiap plan, `08-GATE-A.md`, `08-REVIEW.md` dengan bagian "Orchestrator dispositions" dan keputusan K126 sampai K130, `08-REVIEW-b.md`, `08-REVIEW-c.md`, `08-REVIEW-d.md`, `08-REVIEW-FIX.md`, `deferred-items.md`), `.planning/REQUIREMENTS.md` (AIDA-25 sampai AIDA-32), `.planning/run-loop/PIAGAM.md` (aturan I dan J, Aturan teknis AIDA, Larangan), `.planning/run-loop/J1-RENCANA.md` (K108 sampai K124).

## Fakta yang sudah saya verifikasi

- Gerbang 08-24 di `4d0eefd` (sebelum review): lint, typecheck, unit 1156, build, integration 1327, E2E 219 lolos; `pnpm audit --prod` exit 1 (0 critical, 10 high; dua high nodemailer menunggu owner, butir 08-o3); `test:egress` dan dua cek image `blocked (space)` (ruang host di bawah 20 GiB, aturan J).
- Code review empat bagian: 3 critical, 25 warning, 28 info. Critical: nonce basi sesudah `router.refresh()` (K126); test koneksi IMAP masih membedakan port terbuka dan tertutup (K127); verifier gerbang tidak mencocokkan exit code cek image. Saya mencek kedua critical produk ke kode sebelum triase.
- Perbaikan F1 sampai F4 dengan bukti merah dulu per baris; sesudah F4: unit 1298, integration penuh 1341 (sesudah F3), E2E penuh 220 (sesudah F1), typecheck dan lint exit 0. Sesudah F5: unit 1310, integration tiga berkas auth 14 (test upgrade kini mulai dari skema v1 dan menerapkan 7 migrasi), E2E penuh 223 lolos, 1 skip lama. Gerbang final belum diulang sesudah perbaikan review.
- Delapan butir info ditunda dengan alasan (daftar di `08-REVIEW.md`, bagian Deferred). Temuan sampingan F2: probe Ollama lolos untuk layanan HTTP apa pun yang menjawab 200 dengan JSON.

## Keputusan run yang minta dikritik

- **K127:** satu aturan kategori untuk keempat probe. Hanya penolakan kredensial oleh server protokol yang `authentication_failed`; semua galat jaringan, timeout, close, dan ketidakcocokan protokol `connection_failed`; `unknown` hanya untuk galat bukan jaringan dan bukan protokol; log memuat bentuk galat dari himpunan tetap. Opsi yang saya tolak: hanya memperbaiki kata-kata residu. Apakah aturan ini masih membuka oracle (termasuk temuan probe Ollama 200 JSON), atau malah menyesatkan admin?
- **K128 sampai K130:** 10 berkas per request; nama 200, email 320, subjek 500, pesan 50 000 karakter; tunggu limiter `lock_timeout` 500 ms dan `maxWait` 1000 ms menjadi 429. Residu: koneksi pool yang ditinggalkan tetap antre di pg-pool. Apakah ada jalur yang masih memberi 500, antrean tanpa batas, atau DoS murah lainnya?
- **K126:** nonce render pertama dipertahankan di klien. Apakah ada jalur lain (navigasi lunak, server action tanpa refresh, error boundary, halaman 404) yang memberi dokumen baru tanpa CSP atau memakai nonce yang tidak cocok?

## Pertanyaan

Untuk setiap temuan: berkas dan baris, bukti, dampak, dan perbaikan konkret. Severity HIGH (CSP bisa dilewati atau dilonggarkan, rate limit bisa dilewati atau mengunci semua pengguna, oracle jaringan, rahasia bocor ke respons atau log, resource Docker bukan milik run tersentuh, status `passed` palsu, melanggar aturan I atau J), MEDIUM, atau LOW.

1. CSP dan proxy: nonce, matcher, guard encoding rusak K125, header keamanan di semua jalur respons.
2. IP klien dan rate limit: `TRUSTED_PROXY_HOPS`, bucket bersama, limiter atomik dan batas tunggunya, throttle health, batas byte, jumlah berkas, dan panjang teks.
3. Test koneksi: kategori K127 dan apakah masih ada oracle atau kebocoran teks galat.
4. Skrip cek image dan verifier gerbang: jalur yang menghapus atau menimpa resource yang bukan milik run, dan status `passed` yang tidak didukung bukti.
5. Test yang tidak bisa gagal, termasuk test baru F1 sampai F5.
6. Klaim dokumen yang tidak didukung kode.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah Bagian A siap ke gerbang final dan verifier. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.000 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
