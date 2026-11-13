# Fase 11 susulan (11-o2, pemberitahuan auto-close ke pelanggan): review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Konteks

- Keputusan owner (tidak dibuka ulang): template tetap yang ditulis admin, mati secara default, dinyalakan per workspace, dikirim otomatis saat tiket auto-close tanpa persetujuan per pesan. Sumber: `.planning/run-loop/ANTREAN.md` baris `11-o2`.
- Keputusan teknis final W-01 sampai W-18: `.planning/phases/11-inbox/11-CONTEXT.md`, bagian "Update 2026-11-13: owner item O-2 decided (auto-close customer notice)", subbagian "Decided after the Codex brainstorm (2026-11-13)". Jawaban brainstorm-mu: `.planning/run-loop/codex/fase11-o2-jawab.md`.
- UI: `.planning/phases/11-inbox/11-UI-SPEC.md`, "Addendum 2026-11-13: auto-close customer notice (queue row 11-o2)".
- Plan yang direview: `.planning/phases/11-inbox/11-10-PLAN.md` sampai `11-13-PLAN.md` (empat plan, wave 7 sampai 10). Satu migrasi `20261116100000_auto_close_notice`.
- Batas mengikat: piagam `.planning/run-loop/PIAGAM.md` (Larangan, aturan J, aturan eksekutor), `CLAUDE.md`, `.planning/DESIGN-SYSTEM.md`. Tanpa egress baru selain SMTP yang dikonfigurasi; SMTP tiruan saja di test; `docs/SECURITY.md` diblokir butir owner 08-o4; cookie cache sesi tetap mati.

## Penyimpangan planner yang perlu dinilai

- Empat plan alih-alih dua atau tiga (W-15), supaya test W-14 tidak dibuang.
- W-01 menyebut empat kunci Setting tetapi menamai tiga; planner memakai tiga.
- Klaim W-05 lewat Prisma `updateMany` bersyarat alih-alih `UPDATE ... RETURNING` mentah.
- Lease 10 menit untuk percobaan kirim yang macet dan anggaran 240 detik per pass sweep.

## Pertanyaan

1. Apakah keempat plan menerapkan W-01 sampai W-18 dengan benar dan lengkap? Sebut task yang salah, kurang, atau bertentangan dengan keputusan.
2. Apakah ada risiko keamanan, privasi, atau ketepatan (pemberitahuan ganda, terkirim ke alamat yang salah, bocornya data internal, penutupan yang gagal karena pemberitahuan, race dengan merge, reopen, atau balasan pelanggan) yang tidak tertutup plan?
3. Apakah migrasi, lock, dan test (unit, integration tanpa mock untuk isolasi, inventaris, E2E lewat UI nyata) cukup untuk membuktikan acceptance AIDA-51?
4. Apakah penyimpangan planner di atas dapat diterima?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan, task, dan baris. Lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
