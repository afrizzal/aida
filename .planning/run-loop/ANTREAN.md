# Antrean run loop

Status: `belum`, `berjalan`, `selesai`, `menunggu manusia`, `diparkir`.

| Butir | Isi | Status | Catatan |
|---|---|---|---|
| 0a | Baseline yang tertunda: `pnpm build`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:egress`. Kerjakan begitu regresi Rekriva selesai. Sementara menunggu, lanjut ke 0b | selesai | Putaran 7 dan 8 (2026-11-08): `pnpm build` exit 0. Dengan socket Colima: `test:integration` exit 1, hanya karena berkas egress (11/12 berkas, 26 test lolos); `test:e2e` exit 1, 63 lolos dan 2 gagal di `honesty-invariants.spec.ts`, yang lolos 2/2 saat dijalankan sendirian (flake, plus teardown `taskkill` khusus Windows). Egress dipindah ke 0a2 |
| 0a2 | Baseline `pnpm test:egress` | menunggu owner | Terikat O-1 (LAPORAN bagian 3). Suite ini membuat lalu membongkar (`down -v`) container, network, dan volume project `aida-egress-test`, sedangkan Larangan hanya mengizinkan project `aida` dan `aida-dev-db`. Keputusan run di putaran 27 (C1 Fase 10, aturan keputusan 4): dicatat "blocked (O-1)" sampai owner memutuskan (K26). Putaran 29 sempat menjalankannya karena keliru, lalu menghentikannya di tahap build, sebelum ada container, network, atau volume; tidak ada yang tertinggal. Opsi: (a) izinkan project test berawalan `aida-` yang dibuat dan dibongkar oleh suite AIDA sendiri, dengan pengaman R3-2; (b) tetap blocked. Terhalang: baseline egress dan gerbang `test:egress` di akhir setiap fase |
| 0b | Buka milestone v2.0 dengan tangan. Catat keputusan owner bertanggal 2026-11-07 di `PROJECT.md`: pagar "tanpa modul project management" dicabut, modul Projects dibangun clean-room, larangan memakai kode AGPL atau tanpa lisensi tetap berlaku. Tulis `REQUIREMENTS.md` (ID mulai AIDA-25, AIDA-18 tetap) dan `ROADMAP.md` dengan format arsip `milestones/v1.0.0-*`, Phase 08 sampai 17. Perbarui `STATE.md`. Minta Codex mengkritik roadmap. Selesai kalau `gsd-tools.cjs query init.phase-op 8` berhasil | selesai | Dokumen `8a72f4c`. Codex tiga putaran: 15 temuan (`995ed9e`), 4 HIGH dan 3 MEDIUM (`fea685d`), 1 HIGH (`b9b1d9b`). `init.phase-op 8` menemukan fase 8 dengan requirement. Perbaikan putaran 3 tidak diperiksa ulang Codex karena batas 3 putaran |
| 0c | Lengkapi `FITUR-PROJECTS.md` dengan menelusuri demo publik sesuai aturan clean-room | selesai | `cb10c1c`. Chromium headless, hanya UI tampak. 29 baris perilaku baru, 6 di luar scope dengan alasan. AIDA-100 sampai AIDA-114 ditambahkan, total 91 requirement |
| 08 | Keamanan | diparkir | Langkah 1 sampai 5 dijalankan: CONTEXT `8abbc6c`; plan 23 dalam 14 wave (`ded5f56`); review Codex 3 siklus (`99721fd`, `96d7c8f`, siklus 3 di `08-REVIEWS.md`). Siklus 3 (terakhir) masih memberi 4 HIGH soal keselamatan resource Docker bersama dan kejujuran matriks bukti, jadi fase diparkir sesuai Titik keputusan (K24). Menunggu keputusan owner (LAPORAN bagian 3). Tidak ada fase lain yang ikut diparkir |
| 09 | Operasional | diparkir | CONTEXT `5ebef8b`, UI-SPEC disetujui, 11 plan (`f4b5dfc`), tiga siklus review Codex. Siklus 3 menyisakan 1 HIGH: recovery `demo-partial` menghapus data demo, bertentangan dengan AIDA-37 (K25). Belum ada kode yang dieksekusi. Menunggu keputusan owner |
| 10 | Tim | berjalan | Langkah 1 sampai 4 selesai. Langkah 5: 14 plan (`f188b06`); Codex siklus 1 (`eed405e`, 12 temuan diterima); replan 1 jadi 15 plan (`05570ee`); Codex siklus 2 (`1e11185`): 4 HIGH dan 2 MEDIUM, semua dicek dan diterima (R2-1 sampai R2-6). Berikutnya: `/gsd-plan-phase 10 --reviews --skip-research` putaran 2 (ledger `### Round 2 — 1e11185`), lalu Codex siklus 3 (terakhir; HIGH tersisa berarti parkir) |
| 11 | Inbox | belum | |
| 12 | Siklus tiket | belum | |
| 13 | Integrasi | belum | |
| 14 | Fondasi Projects | belum | |
| 15 | Tampilan kerja | belum | |
| 16 | Ruang kerja | belum | |
| 17 | Penyatuan | belum | |
| 09-o1 | Owner: baseline `version` di `package.json` dan kebijakan bump untuk `check-version` (D-23) | menunggu owner | Opsi: tetapkan versi awal (mis. `1.0.0` sesudah tag) atau biarkan workflow memberi notice. Terhalang: aktivasi gerbang versi |
| 09-o2 | Owner: handle untuk `CODEOWNERS` dan widget README pihak ketiga (D-25) | menunggu owner | Opsi: isi handle/tim dan izinkan widget, atau biarkan tidak ada. Terhalang: dua butir AIDA-40 |
| 10-o2 | Owner: apakah balasan pelanggan dan peringatan SLA pada tiket tanpa assignee memberi notifikasi ke seseorang (CONTEXT Fase 10, O-2) | menunggu owner | Sementara hanya assignee yang diberi notifikasi. Terhalang: cakupan notifikasi untuk tiket tanpa assignee |
