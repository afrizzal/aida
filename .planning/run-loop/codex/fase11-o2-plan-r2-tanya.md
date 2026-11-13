# Fase 11 susulan (11-o2): review plan (siklus 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan siklus 1

Jawabanmu di `.planning/run-loop/codex/fase11-o2-plan-jawab.md`. Semua tujuh temuan dicek ke kode dan diterima; disposisinya di `.planning/phases/11-inbox/11-REVIEWS.md`, bagian "Codex (queue row 11-o2, cycle 1, 2026-11-13)":

- **C1-1 (HIGH, balasan salah arah):** index unik Message-ID pemberitahuan (11-10 T1) dan pencocokan berperingkat: In-Reply-To dulu, lalu References dari yang terbaru, atas Message dan Message-ID pemberitahuan (11-12 T1 langkah 6, kasus f sampai j).
- **C1-2 (HIGH, penerima tidak terikat):** diterima sebagai risiko terbuka. Alasan: tidak ada jalur app yang mengubah `Contact.email` (aksi kontak hanya menulis catatan; find-or-create hanya mengisi nama, telepon, perusahaan). W-08 dan W-12 tetap; test tripwire di 11-11 T2; ancaman T-11-61 mitigasi sebagian plus sisa yang diterima; teks UI dikoreksi.
- **C1-3 sampai C1-7:** expiry per klaim dengan jam dibaca per klaim; kolom `closeMessageSeq` diambil di bawah lock tiket saat penutupan; batas `historySeq` saat klaim; galat non-database menutup tiket tanpa rekaman, galat database membatalkan penutupan dan rekaman bersama; hanya `count === 1` yang sampai ke SMTP, data kirim dibaca ulang di transaksi klaim.

## Yang direview

Plan yang sudah direvisi: `.planning/phases/11-inbox/11-10-PLAN.md` sampai `11-13-PLAN.md`, beserta ledger-nya, dan amandemen teks di `11-UI-SPEC.md`.

## Pertanyaan

1. Apakah C1-1 sampai C1-7 benar-benar tertutup di plan? Apakah revisinya membuka masalah baru (misalnya pencocokan berperingkat yang salah mengarahkan balasan biasa, urutan lock yang bisa deadlock, `closeMessageSeq` yang tidak cocok dengan pesan yang tiba bersamaan)?
2. **C1-2:** apakah penerimaan sebagai risiko terbuka dapat diterima, atau tetap HIGH? Bila tetap HIGH, sebut opsi paling konservatif yang tidak membutuhkan bukti kepemilikan alamat yang tidak bisa dibangun (misalnya menyimpan alamat penerima di setiap pesan keluar lalu mengikat pemberitahuan ke alamat itu).
3. Masih adakah HIGH di plan ini yang belum tercatat?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, masing-masing dengan plan, task, dan baris. Lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 700 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
