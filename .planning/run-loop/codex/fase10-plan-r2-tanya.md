# Fase 10 Tim: review plan (siklus 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan siklus 1

Di siklus 1 (`.planning/run-loop/codex/fase10-plan-jawab.md`) kamu memberi 12 temuan (9 HIGH, 3 MEDIUM). Saya mengecek klaim kuncinya ke plan dan kode lalu menerima semuanya, tiga dengan penyempitan (C5, C9, C12). Properti wajib untuk replan ada di `.planning/phases/10-team/10-REVIEWS.md` (`### Cycle 1` dan `### Required properties for the replan`). Plan direvisi: 11 plan berubah, ditambah plan baru 10-15 (wave 1), sehingga totalnya 15 plan dalam 6 wave. Setiap plan yang berubah punya ledger `### Round 1 — eed405e`. Tidak ada temuan yang ditunda atau ditolak.

## Fakta yang sudah saya verifikasi

- Plan-checker GSD mode reviews: 0 blocker, 1 warning, 1 info. Warning-nya: 10-02 menyentuh 23 berkas, 13 di antaranya penggantian mekanis ke `getPageScopedDb` (C6). Saya terima karena penggantian itu dijaga test inventaris.
- Probe perintah verifikasi: 43 perintah, 0 blocker. Tiap plan berisi paling banyak 3 task, wave = max(dependensi)+1, tanpa `checkpoint:human-verify`, dan `db push` hanya muncul sebagai larangan.
- `vitest.integration.config.ts` memuat `tests/integration/**/*.test.ts`, termasuk `egress-isolation.test.ts` yang menyalakan stack compose `aida-egress-test`. Karena itu 10-14 mencatat `pnpm test:integration` penuh dan `pnpm test:egress` sebagai "blocked (O-1)", lalu menjalankan sisa suite dengan berkas egress dikecualikan. Run juga menahan baseline egress v1 dengan alasan yang sama (K26).

## Pertanyaan

1. Untuk C1 sampai C12, apakah properti wajibnya benar-benar ada di isi plan yang dieksekusi (aksi, must-have, acceptance, perintah verifikasi), bukan hanya di ledger? Sebut yang belum, dengan plan, task, dan baris.
2. Cari masalah baru yang muncul dari revisi:
   - **10-15:** kedua prefix plugin (organization dan admin) ditutup di `src/proxy.ts` berdasarkan daftar route dari paket 1.6.22 yang terpasang. Apakah ada fitur AIDA yang sekarang memanggil endpoint itu dari klien (pemilih organisasi, halaman admin, sign-up, `authClient`), sehingga penutupan merusak alur yang ada? Apakah varian cookie dan blokir sign-up umum benar?
   - **10-08 dan 10-02 (C9):** `setActiveOrganization` diganti `activateSessionOrganization`, yang menulis baris `session` langsung, dan `requireMembership` membaca sesi tanpa cookie cache. Apakah menulis tabel session milik Better Auth secara langsung aman (cache sesi, sesi lain milik user yang sama, sesi yang dicuri)? Apakah mematikan cookie cache membuka masalah kinerja atau konsistensi?
   - **10-05 (C2):** lock organisasi di accept dan revoke, plus test barrier. Adakah urutan lock yang bisa deadlock dengan 10-03 atau 10-06?
   - **10-03 (C3):** invariant "minimal satu owner" dan rekonsiliasinya dengan D-09.
   - **10-09 (C8, C10):** hanya balasan SMTP 4xx/5xx yang melepas klaim seketika; kegagalan lain menahan klaim sampai lease habis; `beforeSend` dijalankan sebelum cek ulang. Apakah ini benar dan bisa diuji dengan fake SMTP `drop-after-data-end`?
   - **10-12 (C7):** `stripMentionTokens` saat mode berpindah ke publik. Adakah jalur (draft tersimpan, kirim langsung lewat HTTP, sunting pesan) yang melewatinya?
   - **10-14 (C1):** apakah perintah yang mengecualikan berkas egress benar-benar menjalankan seluruh berkas integration lain, dan apakah pencatatan "blocked (O-1)" jujur?
3. Pelanggaran piagam: checkpoint manusia, scope dibuang, `prisma db push`, `.env`, `rm -rf`, egress baru tanpa `docs/SECURITY.md` dan `tests/integration/egress-isolation.test.ts`, container selain `aida` dan `aida-dev-db`, email nyata, nama orang atau path rumah di berkas yang dilacak, klaim lulus untuk hasil merah, atau penilaian visual rekaan.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (file dan baris), dampak, dan perbaikan konkret; lalu satu paragraf: apakah plan siap dieksekusi. Tandai klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.400 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
