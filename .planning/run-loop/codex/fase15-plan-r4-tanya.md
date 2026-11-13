# Fase 15 Tampilan kerja: review plan sesudah keputusan owner (satu review, khusus bagian yang diubah)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Latar

Tiga siklus review plan sebelumnya (`codex/fase15-plan-jawab.md`, `fase15-plan-r2-jawab.md`, `fase15-plan-r3-jawab.md`) berakhir dengan 2 HIGH (CX3-1 pergantian akun A ke B ke A saat simpan lama masih berjalan; CX3-2 contoh test K100 bertentangan dengan API K105) dan 1 MEDIUM (CX3-3 Reload dialog tanggal yang gagal). Fase diparkir. Keputusan owner, kata per kata (sumber `.planning/run-loop/ANTREAN.md` baris `15`): "Opsi c (sederhanakan K100) dengan dua syarat: perbaiki dialog tanggal (CX3-3), dan perubahan terakhir sebelum pindah halaman wajib terkirim (simpanan tertunda dikirim saat halaman ditinggalkan, `fetch` dengan `keepalive: true`). Lalu satu review Codex, khusus bagian yang diubah."

## Yang berubah

Dicatat di `.planning/phases/15-work-views/15-CONTEXT.md` (bagian bertanggal 2026-11-13) dan `15-REVIEWS.md` (bagian Revision 4 dan daftar status di akhir):

- K100 kini satu saver per view yang terpasang, tanpa registry modul; kontrol selalu mulai dari props server (K106 dicabut); K99 tetap.
- Setiap simpan view state lewat route baru `POST /api/projects/view-state` dengan `fetch` `keepalive: true`; route memeriksa Origin, ukuran, satu baca sesi, dan identitas yang diharapkan.
- Flush: saat unmount, state antre dikirim tepat sesudah simpan yang sedang berjalan; saat `pagehide` atau tab tersembunyi, langsung. Bila simpan gagal sesudah pindah halaman tetapi tab masih terbuka, satu toast umum. Tiga kasus urutan yang tersisa dinyatakan sebagai batas.
- CX3-1: registry dihapus, setiap simpan membawa identitasnya sendiri, server menolak identitas sesi lain. CX3-2: hilang bersama `viewStateSaverKey`. CX3-3: reload mengembalikan berhasil atau gagal; dialog hanya tertutup sesudah baca yang berhasil.
- 13 drift terhadap kode sekarang diperbaiki (antara lain `requirePageAccess`, migrasi `20261118100000_work_views` lewat aturan J, penolakan bertipe K164, helper action di `src/app/(app)/projects/`).
- Plan yang berubah: 15-01, 08, 09, 10, 11, 12, 14, 15, 16, 17, 18, 20, 21, 22, 24, 25.

## Pertanyaan

1. Apakah desain sederhana ini benar-benar menutup CX3-1, CX3-2, dan CX3-3, dan memenuhi kedua syarat owner?
2. Apakah perubahan membuka masalah baru: keamanan route `view-state` (CSRF, ukuran, identitas, organisasi), `keepalive` (batas 64 KiB, urutan, kegagalan diam-diam), atau drift yang masih tersisa?
3. Masih adakah HIGH di bagian yang diubah?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, masing-masing dengan plan, task, dan baris. Lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 700 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
