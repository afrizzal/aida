# Antrean run loop

Status: `belum`, `berjalan`, `selesai`, `menunggu manusia`, `diparkir`.

| Butir | Isi | Status | Catatan |
|---|---|---|---|
| 0a | Baseline yang tertunda: `pnpm build`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:egress`. Kerjakan begitu regresi Rekriva selesai. Sementara menunggu, lanjut ke 0b | selesai | Putaran 7 dan 8 (2026-11-08): `pnpm build` exit 0. Dengan socket Colima: `test:integration` exit 1, hanya karena berkas egress (11/12 berkas, 26 test lolos); `test:e2e` exit 1, 63 lolos dan 2 gagal di `honesty-invariants.spec.ts`, yang lolos 2/2 saat dijalankan sendirian (flake, plus teardown `taskkill` khusus Windows). Egress dipindah ke 0a2 |
| 0a2 | Baseline `pnpm test:egress` | diparkir | Build image macet di `@prisma/engines postinstall`: `binaries.prisma.sh` menjawab `HEAD` 200 tetapi `GET` 0 byte (07.45). Gangguan host luar, mirror pihak ketiga tidak dipakai. Di awal setiap putaran, uji `GET` `schema-engine.gz`; kalau pulih, status kembali `belum` dan test dijalankan. Gerbang akhir Fase 08 juga membutuhkannya |
| 0b | Buka milestone v2.0 dengan tangan. Catat keputusan owner bertanggal 2026-11-07 di `PROJECT.md`: pagar "tanpa modul project management" dicabut, modul Projects dibangun clean-room, larangan memakai kode AGPL atau tanpa lisensi tetap berlaku. Tulis `REQUIREMENTS.md` (ID mulai AIDA-25, AIDA-18 tetap) dan `ROADMAP.md` dengan format arsip `milestones/v1.0.0-*`, Phase 08 sampai 17. Perbarui `STATE.md`. Minta Codex mengkritik roadmap. Selesai kalau `gsd-tools.cjs query init.phase-op 8` berhasil | selesai | Dokumen `8a72f4c`. Codex tiga putaran: 15 temuan (`995ed9e`), 4 HIGH dan 3 MEDIUM (`fea685d`), 1 HIGH (`b9b1d9b`). `init.phase-op 8` menemukan fase 8 dengan requirement. Perbaikan putaran 3 tidak diperiksa ulang Codex karena batas 3 putaran |
| 0c | Lengkapi `FITUR-PROJECTS.md` dengan menelusuri demo publik sesuai aturan clean-room | selesai | `cb10c1c`. Chromium headless, hanya UI tampak. 29 baris perilaku baru, 6 di luar scope dengan alasan. AIDA-100 sampai AIDA-114 ditambahkan, total 91 requirement |
| 08 | Keamanan | berjalan | Langkah 1 sampai 3 selesai (CONTEXT `8abbc6c`); langkah 4 dilewati (`UI hint: no`); langkah 5 bagian plan selesai: 18 plan dalam 10 wave di `339ade5`, plan-checker tanpa blocker sesudah 1 revisi, requirement 8/8 dan keputusan 30/30. Berikutnya: review plan oleh Codex (maksimal 3 siklus), lalu `--reviews --skip-research` |
| 09 | Operasional | belum | |
| 10 | Tim | belum | |
| 11 | Inbox | belum | |
| 12 | Siklus tiket | belum | |
| 13 | Integrasi | belum | |
| 14 | Fondasi Projects | belum | |
| 15 | Tampilan kerja | belum | |
| 16 | Ruang kerja | belum | |
| 17 | Penyatuan | belum | |
