# Fase 15 Tampilan kerja: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Clean-room: produk rujukan tanpa lisensi; yang boleh hanya `.planning/run-loop/FITUR-PROJECTS.md`. Jangan menyebut, menebak, atau meniru kode, teks UI, CSS, ikon, atau tata letak produk rujukan.

## Yang direview

25 plan di `.planning/phases/15-work-views/15-01-PLAN.md` sampai `15-25-PLAN.md` (sekitar 2,6 MB, 10 wave). Konteks: `15-CONTEXT.md` (D-01 sampai D-23, K74 sampai K90), `15-UI-SPEC.md`, `15-PLAN-OUTLINE.md` (dengan amandemen orkestrator di akhir), `15-PLAN-NOTES.md`, kontrak beku di blok `<contract_amendment>` `15-01-PLAN.md` (bagian 18, disalin ke `14-CONTRACT.md` saat eksekusi), dan `15-PLAN-CHECK.md` (plan check 10 irisan: 8 BLOCKER, 41 WARNING, 25 INFO; disposisi K91 sampai K98; catatan revisi). Kode Fase 14 yang dipanggil ada di `src/lib/projects/`.

## Fakta yang sudah diverifikasi orkestrator

- Semua 25 plan lolos `frontmatter validate --schema plan` dan `verify plan-structure`; 372 perintah `<automated>` asli terselesaikan dan punya `<fails_when>` (sebelum revisi; revisi menambah perintah dengan aturan yang sama).
- Tidak ada plan yang bergantung pada plan di wave yang sama atau sesudahnya; tabrakan berkas satu wave hanya `src/lib/projects/ui-copy.ts` dan `tests/unit/project-copy.test.ts` (baris celah append-only, nomor G berikutnya saat eksekusi; plan dieksekusi satu per satu di satu checkout).
- Batas unggah dicek di kode: `Caddyfile` `max_size 12MB`, `next.config.ts` `proxyClientMaxBodySize` 30 MiB; K91 menetapkan satu berkas per permintaan dengan `UPLOAD_REQUEST_MAX_BYTES` 11 MiB.
- Pembacaan ulang penuh menemukan lost update di 15-15 (reload sinyal saat editor terbuka) yang kini diperbaiki dengan versi baris saat editor dibuka; aturan sama diterapkan di 15-18, 15-20, 15-23.

## Pertanyaan

Untuk setiap temuan: plan dan baris atau bagian, bukti, dampak, perbaikan konkret, severity HIGH (proyek privat bocor atau oracle keberadaan, kebocoran antar organisasi, data hilang atau tertimpa diam-diam, deadlock, plan yang membuat eksekutor menebak atau berhenti, test yang tidak bisa gagal untuk kriteria sukses, melanggar piagam), MEDIUM, atau LOW.

1. Privasi (K69 sampai K74, D-06, kriteria sukses 6): adakah jalur di plan (bacaan, kursor, hitungan grup, opsi filter, chip, notice, respons action atau RSC, route unduh dan unggah, saved view, view state) yang membedakan proyek privat yang ada dari yang tidak ada, atau membocorkan data organisasi lain? Prioritaskan 15-03, 15-04, 15-07, 15-08, 15-12, 15-20, 15-21, 15-22.
2. Konkurensi dan integritas: sinyal perubahan task (K92) bersama penjaga adopsi dan aturan versi editor; perubahan hapus K90 dan urutan lock; unggah berurutan K91; antrean simpan view state. Adakah lost update, deadlock, atau hasil basi yang menimpa hasil baru?
3. Konsistensi lintas plan: nama yang dipakai satu plan dan didefinisikan plan lain (sesudah revisi), kontrak 18 terhadap plan yang memakainya, urutan wave dan depends_on.
4. Test: adakah test kunci (kriteria sukses 3, 4, 6; K97 UNKNOWN; tiling bulan K96) yang bisa lolos tanpa membuktikan klaimnya?
5. Yang terlewat oleh plan check dan revisi.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah plan siap dieksekusi. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.500 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
