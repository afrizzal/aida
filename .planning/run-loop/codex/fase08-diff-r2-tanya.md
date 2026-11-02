# Fase 08 Keamanan, Bagian A: kritik diff fase (putaran 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan putaran 1

Jawabanmu ada di `.planning/run-loop/codex/fase08-diff-jawab.md`: 4 HIGH, 1 MEDIUM, 1 LOW. Semua saya cek ke kode dan saya terima. Keputusan dan alasannya ada di `.planning/phases/08-security-hardening/08-REVIEW.md`, bagian "Codex diff critique round 1 dispositions (2026-11-12)":
- **K131:** di probe Ollama, 401 dan 403 menjadi `connection_failed`, karena AIDA tidak mengirim kredensial ke Ollama. Probe hanya lolos bila bentuk respons Ollama terpenuhi. OpenAI dan Anthropic tetap memetakan 401/403 ke `authentication_failed`.
- **K132:** batas admission untuk transaksi limiter di depan pool.
- **K133:** verifier gerbang menjalankan validasi murni yang sama atas log image dan berkas exit yang sebenarnya.
- **K134:** bukti resource asing mencatat exit setiap listing dan menolak listing kosong; nama barisnya dipersempit.
- **K135:** jumlah part dihitung sebelum parsing multipart; semua part `file` dihitung, termasuk yang kosong.
- **LOW (respons buatan Caddy tanpa header keamanan):** ditunda ke Fase 8.1, karena blok header global Caddy akan menggandakan CSP.

## Yang direview

Batch perbaikan F6: `.planning/run-loop/codex/fase08-diff-r2.patch` (25 berkas, commit `2e04a18` sampai `0424a63`; laporan di `.planning/phases/08-security-hardening/08-REVIEW-FIX.md` bagian F6). Bentuk akhir ada di folder kerja.

## Fakta yang sudah saya verifikasi

- typecheck dan lint exit 0; `pnpm test` 76 berkas, 1371 test; `pnpm test:integration` penuh 101 berkas, 1358 test; E2E `public-intake`, `public-status`, `phase4-ai`, `phase5-rag` 27 lolos. Setiap baris punya run merah lebih dulu.
- Angka yang dipilih eksekutor: batas admission 3 transaksi limiter per proses app (`RATE_LIMIT_MAX_CONCURRENT`), dari pool 10 koneksi; batas part intake 17 (10 berkas, 5 field teks, 2 cadangan) dan follow-up 14 (10 berkas, 2 field teks, 2 cadangan).
- Deviasi yang dilaporkan eksekutor:
  - limiter juga menolak panggilan bila 3 atau lebih connect sudah menunggu di pool (`dbPoolWaitingCount()` baru di `src/lib/db.ts`);
  - dengan batas part aktif, reader menolak tanpa parsing body yang bukan multipart dan bukan url-encoded, juga content type multipart dengan lebih dari satu parameter `boundary`;
  - CSAT tidak diberi batas part;
  - test atomisitas 20 paralel menaikkan batas ke 20 lewat seam test.
- `check` atas `08-GATE-A.md` lama kini exit 1, hanya pada baris K134, karena bukti lama tidak punya berkas listing baru. Ini diharapkan; gerbang diulang di langkah 8.

## Pertanyaan

1. Apakah K131 sampai K135 benar-benar tertutup di kode? Apakah ada perbaikan yang membuka masalah baru? Contohnya:
   - limiter: penghitung slot yang bocor pada jalur galat, 429 palsu untuk pengguna sah di bawah beban wajar, atau `dbPoolWaitingCount()` yang salah membaca pool;
   - penghitung part: bisa diakali dengan boundary di dalam isi part, preamble, epilog, CRLF atau LF, atau batas yang memotong delimiter;
   - pemeriksaan bentuk respons Ollama terlalu longgar atau terlalu ketat untuk Ollama sungguhan;
   - modul validasi bersama masih menyentuh Docker;
   - aturan K134 masih bisa lolos dengan bukti lemah.
2. Masih adakah HIGH? Yang dimaksud: oracle jaringan; rate limit yang bisa dilewati atau mengunci semua pengguna; DoS murah; status `passed` palsu; resource Docker bukan milik run tersentuh; test kunci yang tidak bisa gagal.
3. Apakah deviasi eksekutor dapat diterima, atau ada yang harus dibalik?

R2 hanya untuk diff F6 dan dampaknya. Jangan membuka review menyeluruh ulang; temuan lama di luar F6 hanya disebut kalau berat dan belum tercatat.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah Bagian A siap ke gerbang final dan verifier. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
