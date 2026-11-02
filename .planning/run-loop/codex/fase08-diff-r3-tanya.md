# Fase 08 Keamanan, Bagian A: kritik diff fase (putaran 3 dari maksimal 3, terakhir)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan putaran 1 dan 2

- **Putaran 1** (`codex/fase08-diff-jawab.md`): 4 HIGH, 1 MEDIUM, 1 LOW. Semuanya diterima. Keputusan K131 sampai K135 diperbaiki di batch F6. LOW (respons buatan Caddy) ditunda ke Fase 8.1.
- **Putaran 2** (`codex/fase08-diff-r2-jawab.md`, atas diff F6): tanpa HIGH; 3 MEDIUM, 1 LOW. Semuanya diterima. Keputusan K136 sampai K138 diperbaiki di batch F7. LOW (baris K134 menerima listing berisi header saja) diterima sebagai batas tertulis. Saat mengecek, saya menambah satu temuan: boundary di-encode latin1, sehingga boundary non-ASCII tidak terhitung. Temuan itu masuk K137.

Keputusan dan alasannya ada di `.planning/phases/08-security-hardening/08-REVIEW.md`, bagian "Codex diff critique round 2 dispositions (2026-11-12)":
- **K136:** satu identitas memegang paling banyak satu slot admission. Ada juga memori "ditolak sampai" dalam memori, sehingga panggilan yang sudah pasti ditolak tidak membuka transaksi.
- **K137:** penghitung part berhenti saat melewati batas dan di penutup pertama. Boundary wajib 1 sampai 70 karakter RFC 2046 ASCII.
- **K138:** pool, client Prisma, dan state limiter disimpan di `globalThis` dengan kunci `Symbol.for` di semua lingkungan.

## Yang direview

Batch F7: `.planning/run-loop/codex/fase08-diff-r3.patch` (11 berkas, commit `41b6462`, `2e82d12`, `b7ef8ff`; laporan di `08-REVIEW-FIX.md` bagian F7). Bentuk akhir ada di folder kerja.

## Fakta yang sudah saya verifikasi

- typecheck dan lint exit 0. `pnpm test` 78 berkas, 1390 test. `pnpm test:integration` penuh 101 berkas, 1360 test. E2E `public-intake` dan `public-status` 10 lolos. Setiap perilaku baru punya run merah lebih dulu, kecuali modul memori penolakan murni; perilakunya dibuktikan merah di test integration.
- Batas yang dipilih:
  - memori penolakan paling banyak 10 000 identitas, disapu paling sering sekali per detik, dan entri tertua digusur saat penuh;
  - map slot per identitas paling banyak 3 entri;
  - penghitung melihat paling banyak `maxParts + 1` kecocokan delimiter.
- Deviasi yang dilaporkan eksekutor:
  - body dengan lebih dari satu baris baru sesudah penutup ditolak tanpa parsing, karena parser melewati `--b--` di dalam header part dan tetap membangun part (terukur 41 entri);
  - boundary tanpa kutip kini hanya menerima karakter RFC 2046;
  - memori penolakan hanya berlaku untuk `max` dan `windowMs` yang sama;
  - klien tanpa alamat yang bisa dipakai berbagi satu identitas, jadi juga berbagi satu slot;
  - menghapus baris limiter di database tidak lagi mencabut penolakan yang diingat server yang sedang berjalan. `uat-gaps.spec.ts` harus menaruh test rate limit-nya paling akhir, padahal `playwright.config.ts` memakai `retries: process.env.CI ? 1 : 0`.
- K138 belum dicek pada build produksi sungguhan. Buktinya adalah test re-import di bawah `NODE_ENV=production`.

## Pertanyaan

1. Apakah K136 sampai K138 benar-benar tertutup di kode, dan apakah perbaikannya membuka masalah baru? Contohnya:
   - memori penolakan menolak pengguna sah setelah jendela berganti, atau bisa dipakai untuk menolak identitas lain;
   - bucket bersama "tanpa alamat" yang kini hanya punya satu slot mengunci semua pengguna di belakang proxy yang salah konfigurasi;
   - penolakan epilog atau boundary memutus klien sah;
   - singleton `globalThis` membocorkan state antar-test atau antara app dan worker.
2. Retry Playwright di CI bersama memori penolakan: apakah ini membuat CI merah palsu, dan perbaikan apa yang paling kecil?
3. Ini putaran terakhir. Masih adakah HIGH di Bagian A yang belum tercatat?

Hanya untuk diff F7 dan dampaknya. Jangan membuka review menyeluruh ulang.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah Bagian A siap ke gerbang final dan verifier. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 700 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
