# Fase 14 Fondasi Projects: kritik diff fase (putaran 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Clean-room: produk rujukan tanpa lisensi; yang boleh hanya `.planning/run-loop/FITUR-PROJECTS.md`. Jangan menyebut, menebak, atau meniru kode, nama tabel, teks UI, atau tata letak produk rujukan.

## Ringkasan putaran 1

Di putaran 1 (`.planning/run-loop/codex/fase14-diff-jawab.md`) kamu memberi 3 HIGH dan 1 LOW. Disposisi ada di akhir `.planning/phases/14-projects-foundation/14-REVIEW.md` (bagian "Codex diff critique / Round 1"), perbaikan di `14-REVIEW-FIX.md` bagian F3:

- D1: `listTaskComments`, `listTaskAttachments`, `listProjectAttachments`, dan `getTaskAttachmentForDownload` kini berjalan dalam satu transaksi baca (`runProjectReadInTransaction` di `src/lib/projects/service.ts`) dan query isinya membawa `task: { organizationId, project: readableProjectWhere(actor) }`; tiga race baru terikat PID di `tests/integration/project-content-read-race.test.ts`.
- D2: rebalance `moveProjectPosition` hanya mengubah `updatedAt` proyek yang dipindah; test dua dunia membandingkan per proyek apakah `updatedAt` berubah.
- D3: keputusan run K72: alias hanya resolve bila proyek asalnya juga terbaca, selain itu NOT_FOUND identik dengan kunci yang tidak ada; probe prefix tetap butir owner 14-o3.
- D4 ditolak (ketergantungan pada `fileParallelism: false` sudah dikomentari).

## Fakta yang sudah saya verifikasi

- Sesudah F3: unit 838, integrasi tanpa egress 1222, typegen, typecheck, lint exit 0; bukti merah dulu untuk D1 sampai D3.
- Batas yang dilaporkan fixer: bacaan lain yang mengecek akses proyek lalu membaca berdasarkan id proyek di pernyataan terpisah, misalnya `listProjectTasks`, `listProjectMilestones`, `listLabels`, dan sejenisnya, belum diaudit untuk celah kelas D1; pengecekan asal alias K72 dan bacaan task masih dua pernyataan di luar transaksi.

## Pertanyaan

1. Apakah D1 sampai D3 benar-benar tertutup, dan adakah perbaikan yang membuka masalah baru?
2. Audit seluruh bacaan di `src/lib/projects/` untuk kelas D1 (akses dicek, lalu isi dibaca di pernyataan lain tanpa predikat akses saat ini atau tanpa lock yang menserialkan dengan pindah, pencabutan anggota, perubahan privasi, atau hapus). Sebutkan setiap fungsi yang masih rentan, dengan berkas dan baris.
3. HIGH lain yang tersisa: proyek privat bocor, oracle keberadaan, kebocoran antar organisasi, data hilang, atau deadlock.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah fase siap ke gerbang dan verifier. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 900 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
