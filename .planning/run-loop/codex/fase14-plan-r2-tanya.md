# Fase 14 Fondasi Projects: review plan (siklus 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Clean-room: produk rujukan tanpa lisensi; yang boleh hanya `.planning/run-loop/FITUR-PROJECTS.md`. Jangan menyebut, menebak, atau meniru kode, nama tabel, teks UI, atau tata letak produk rujukan.

## Ringkasan siklus 1

Di siklus 1 (`.planning/run-loop/codex/fase14-plan-jawab.md`) kamu memberi 2 HIGH dan 5 MEDIUM, plus catatan tentang hapus member Better Auth. Semua dicek di teks plan dan diterima; disposisinya ada di `.planning/phases/14-projects-foundation/14-REVIEWS.md` (C1 sampai C8, ditambah P1 sampai P3 dari plan checker) dan amandemen di akhir `14-CONTEXT.md`. Replan `--reviews` putaran 1 (`a30e361`) mengubah 11 plan (semua kecuali 14-03 dan 14-05), masing-masing dengan `### Round 1 — f110ba5`. Ringkas:

- C1: baris aktivitas dua proyek (pindah, duplikat) menyimpan tiap sisi utuh; sisi yang tak terbaca menjadi `REDACTED_SIDE` (`{ redacted: true }`) lewat satu jalur `redactActivityRow`; test dua arah dengan rahasia berbeda di tiap sisi dan perbandingan seluruh respons.
- C2 (keputusan run K69): keanggotaan tim tidak pernah memberi akses proyek privat; menugaskan tim ke proyek privat menyalin anggota tim saat itu menjadi `ProjectMember` langsung; perubahan tim sesudahnya tidak mengubah akses privat; `addTeamMember` tidak lagi menolak berdasarkan tautan privat; test bahwa dua keadaan yang hanya berbeda pada tautan privat tersembunyi memberi hasil identik.
- C3: tulisan subtask mengunci parent `FOR SHARE` lebih dulu; `archiveTask` mengunci task `FOR UPDATE`; race dua arah tanpa 40P01.
- C4: snapshot diurutkan per primary key untuk 18 tabel.
- C5: kelas isolasi per operasi (TARGET, CREATE, LIST, KEY, TEAM) di kontrak, 14-04, dan inventaris 14-13.
- C6: `duplicateTask` memakai lock PROJECT_UPDATE dengan rebalance; 14-12 kini bergantung pada 14-11 (race duplikat lawan reorder).
- C7: inventaris 14-13 hanya cek kelengkapan, dengan test negatif parser.
- C8: hapus member Better Auth tidak diserialkan; dinyatakan sebagai batas (terkait butir owner 12.2-o4).

## Fakta yang sudah saya verifikasi

- Plan checker atas replan: lolos tanpa temuan (ledger, K69 di semua plan, `REDACTED_SIDE`, lock parent, urutan snapshot, kelas isolasi, wave dan dependensi konsisten, piagam). Catatan checker: cakupan "tidak ada verifikasi yang menjalankan kode plan sesudahnya" dan "acceptance menunjuk berkas yang ditulis aksi" hanya diperiksa sampel.
- Probe deterministik: semua perintah verifikasi punya arah gagal.

## Pertanyaan

1. Apakah C1 sampai C8 dan P1 sampai P3 benar-benar tertutup di plan, dan adakah perbaikan yang membuka masalah baru? Perhatikan khususnya: K69 (apakah salinan anggota saat penugasan tim, `setProjectPrivacy(true)` tanpa salinan, dan pelepasan tim punya celah privasi atau kontradiksi dengan AIDA-69 dan AIDA-71); apakah `REDACTED_SIDE` menutup semua jalur yang membaca aktivitas (feed proyek, feed tim, feed task, aktivitas proyek yang dihapus); urutan lock baru parent sebelum anak terhadap urutan global (Team, Project, Task, counter, kunci, outbox, aktivitas) dan operasi pohon (pindah, hapus, arsip).
2. Masih adakah kontradiksi antar plan, test yang lolos karena kode yang belum ada, atau acceptance yang menunjuk berkas lain dari tempat aksi menaruh kodenya (dua hal ini hanya diperiksa sampel oleh checker)?
3. HIGH yang tersisa: adakah yang membuat plan tidak siap dieksekusi?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan plan dan task, bukti (berkas dan baris), dampak, dan perbaikan konkret; lalu satu paragraf: apakah plan siap dieksekusi. Tandai klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.000 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
