# Fase 08 Security Hardening: review plan (siklus 3, siklus terakhir)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Ini siklus terakhir. Menurut piagam, kalau sesudah siklus ini masih ada temuan HIGH yang tidak bisa dimasukkan ke plan, fase diparkir. Jadi bedakan dengan tegas antara HIGH yang benar-benar menghalangi acceptance atau melanggar piagam, dan perbaikan yang baik tetapi tidak menghalangi.

## Ringkasan siklus 1 dan 2

- Siklus 1 (`.planning/run-loop/codex/fase08-plan-jawab.md`): 13 temuan C1 sampai C13. Semua diterima atau diterima sebagian, dengan properti wajib di `.planning/phases/08-security-hardening/08-REVIEWS.md` bagian `### Cycle 1`.
- Siklus 2 (`.planning/run-loop/codex/fase08-plan-r2-jawab.md`): 9 temuan R2-1 sampai R2-9, semua diterima (`### Cycle 2`). Kamu menerima penolakan validasi seluruh rantai XFF (C8). Untuk C4 kita tetap berbeda sesudah dua putaran, jadi run mengambil opsi paling konservatif K22: semua bukti container baru berjalan di project compose `aida` (yang disebut piagam) di balik pengaman. Pengaman parkir dan tidak menyentuh apa pun kalau ada container atau network `aida`, atau port 80/443 dipakai siapa pun. Volume dan image diberi nama per run, yang dicek tidak ada sebelum dibuat. Volume `aida_*` yang sudah ada tidak pernah di-mount atau dihapus. Teardown hanya menghapus yang dibuat run. Tidak ada container mandiri di luar `aida`. Suite yang disebut piagam (Testcontainers untuk integration dan E2E, `pnpm test:egress` dengan `aida-egress-test`) tetap. Pertanyaan ini juga dilaporkan ke owner.
- Plan direvisi lagi: 23 plan dalam 14 wave, commit `ded5f56`. Setiap plan punya ledger `### Round 2 — 96d7c8f`. Task Caddy mandiri dari 08-21 pindah ke 08-22. 08-23 berjalan sesudah 08-22. Plan-checker GSD lolos; warning "4 task" ternyata salah hitung (semua plan 3 task). Gerbang otomatis: requirement 8/8, keputusan 30/30.

## Fakta terverifikasi yang tidak bisa kamu cek dari ekspor

- `node_modules/next/dist/server/base-server.js:577`: Next.js mengisi `X-Forwarded-For` yang hilang dengan peer TCP sebelum proxy.
- `node_modules/better-auth/dist/api/rate-limiter/index.mjs:275`: bucket `no-trusted-ip` di Better Auth 1.6.22.
- Saat ini Docker di mesin ini tidak punya container, network, atau volume `aida`, dan port 80 serta 443 bebas.

## Pertanyaan

1. **Penggabungan siklus 2.** Untuk K22 dan R2-1 sampai R2-9, apakah properti di `08-REVIEWS.md` (`### Cycle 2`, "Required properties for the replan (cycle 2)") benar-benar ada di isi plan yang dieksekusi? Sebut yang belum, dengan plan, task, dan baris.
2. **Pengaman K22 dan R2-1.** Cari celah yang masih bisa membuat run menyentuh atau mengubah stack, network, atau volume milik pihak lain di VM Docker bersama, termasuk lewat `--remove-orphans`, `down` dari project `aida`, nama image, atau build cache.
3. **Gerbang dan kejujuran bukti.** Apakah aturan empat status, reporter, matriks bukti 08-16, dan cabang Docker tidak sehat atau working tree kotor sudah konsisten satu sama lain dan tidak bisa meluluskan hasil yang sebenarnya merah, terhalang, atau tidak dijalankan?
4. **HIGH yang tersisa.** Selain di atas, apakah ada plan yang pasti gagal mencapai acceptance-nya, melanggar piagam, atau membuka celah keamanan?

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (file dan baris), dampak, dan perbaikan konkret. Tutup dengan satu paragraf: apakah plan siap dieksekusi, dan apakah ada HIGH yang menurutmu harus membuat fase diparkir. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.500 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
