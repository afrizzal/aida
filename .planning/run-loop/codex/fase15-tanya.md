# Fase 15 Tampilan kerja: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Clean-room: produk rujukan tanpa lisensi; yang boleh hanya `.planning/run-loop/FITUR-PROJECTS.md`. Jangan menyebut, menebak, atau meniru kode, teks UI, CSS, ikon, atau tata letak produk rujukan. Tampilan mengikuti `.planning/DESIGN-SYSTEM.md`.

Konteks: Fase 15 di `.planning/ROADMAP.md` (enam kriteria sukses, fase ber-UI), AIDA-72 sampai AIDA-80 dan AIDA-106 di `.planning/REQUIREMENTS.md`, `FITUR-PROJECTS.md`, dan batas mengikat di `.planning/run-loop/PIAGAM.md`. Lapisan logika Fase 14 sudah ada di `src/lib/projects/` dengan kontrak di `.planning/phases/14-projects-foundation/14-CONTRACT.md` (76 operasi, kode penolakan bertipe, kebijakan akses dengan keputusan run K69 sampai K73: tanpa oracle keberadaan proyek privat, predikat akses di setiap query, posisi proyek hanya urutan yang terbaca). Saved view tiket Fase 11 ada di `src/lib/saved-views/`. Pola action dan halaman: `src/app/(app)/tickets/` dan `src/app/(app)/kb/proposals/` (Fase 12.2: `getSessionActor`, kode penolakan bertipe, `resolveActionOutcome`, fokus, `aria-disabled`). Hasilnya menjadi `15-CONTEXT.md`.

## Area abu-abu

Untuk setiap area: rekomendasi, alasan, risiko, status `terverifikasi di kode` atau `belum terverifikasi`; tandai keputusan milik owner.

1. **Struktur rute dan server action.** Halaman daftar dan detail proyek, drawer task lawan halaman penuh dengan deep link yang sama (AIDA-73), dan lapisan action tipis di atas service Fase 14 (pemetaan kode penolakan ke copy, `UNKNOWN`, `unstable_rethrow`).
2. **Drag and drop dengan alternatif keyboard** (Board, Calendar, Timeline): library (lisensi, ukuran, aksesibilitas) atau implementasi sendiri; bagaimana E2E membuktikan gerakan yang sama lewat mouse dan keyboard dan persist sesudah reload.
3. **Table dan edit sel** (AIDA-76): validasi, konflik versi, pilihan kolom tersimpan.
4. **Calendar dan Timeline**: zona waktu (tanpa preferensi pengguna sampai AIDA-98), tanggal kalender `YYYY-MM-DD` Fase 14, zoom, pengelompokan, rendering tanpa library berat.
5. **Tampilan tersimpan** (AIDA-80): pakai model Fase 11 atau model baru per pengguna dan proyek; versi skema filter; gagal tertutup.
6. **Tingkat workspace** (AIDA-106): daftar lintas proyek yang hanya memuat proyek terbaca, paging keyset, dan tanpa oracle.
7. **Files** (AIDA-79): unduhan lewat cek akses Fase 14, pratinjau aman.
8. **Pemecahan plan, UI-SPEC, dan urutan**, dan yang perlu dibekukan dulu.
9. **Yang saya lewatkan.**

## Format jawaban

Bahasa Indonesia. Untuk setiap area: rekomendasi, alasan, risiko, status. Tandai keputusan milik owner. Paling banyak sekitar 1.600 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
