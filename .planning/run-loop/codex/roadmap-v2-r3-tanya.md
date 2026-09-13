# Kritik roadmap v2.0 AIDA, putaran 3 dari 3 (terakhir)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, jadi tidak ada `node_modules` dan tidak ada riwayat git.

## Ringkasan putaran sebelumnya

- **Putaran 1** (`.planning/run-loop/codex/roadmap-v2-jawab.md`) memberi 15 temuan, 10 HIGH. Semuanya diterima.
- **Putaran 2** (`.planning/run-loop/codex/roadmap-v2-r2-jawab.md`) menilai 9 tertutup dan 6 sebagian. Ada 4 HIGH yang tersisa atau baru, ditambah 3 MEDIUM.

Klaim terverifikasi dari putaran 2 sudah saya cek ke kode, dan semuanya benar:

- `migrate` adalah service sekali jalan (`restart: "no"`), dan `app` menunggu `service_completed_successfully`.
- `scripts/backup.sh` menjalankan dump lalu tar secara berurutan, dan `local-file-storage.ts` punya `unlink`.
- `bootstrap-demo.ts` hanya menghitung tiket sebelum `ensureDemoIdentities()`.

Semua temuan putaran 2 saya terima:

| Temuan putaran 2 | Perubahan |
|---|---|
| HIGH jeda SLA | AIDA-57: tiap due time bergeser tepat sebesar waktu jeda sesudah beberapa jeda terkendali, termasuk restart worker. Kriteria Fase 12 ikut diubah |
| HIGH migrate one-shot | AIDA-27 dan kriteria Fase 8: `app` dan `worker` non-root saat berjalan, `migrate` non-root dan exit 0, dibuktikan dari container yang sudah keluar atau `id -u` di image yang sama |
| HIGH konsistensi backup | AIDA-33: setiap record lampiran di dump punya file di arsip set yang sama, walau lampiran berubah selama backup, diuji dengan perubahan di tengah backup. Strateginya diputuskan di CONTEXT Fase 9 |
| HIGH fallback parkir | Aturan tabel Cross-phase risks: requirement yang acceptance-nya memuat bagian yang hilang tetap terbuka dan tidak pernah ditutup. Fallback hanya agar pembangunan bisa lanjut. Baris-barisnya disesuaikan |
| MEDIUM seed dan demo | AIDA-37: `pnpm db:seed` menolak kalau sudah ada organisasi atau user. Boot `DEMO_MODE` hanya jalan di database kosong, melewati kalau isinya hanya data demonya sendiri, dan menolak selain itu |
| MEDIUM retry digest | AIDA-46: ditandai terkirim sesudah SMTP menerima, retry sebelum handoff tidak menggandakan, jendela sisanya didokumentasikan |
| MEDIUM password compose | AIDA-35: password sintetis, dicek secara terprogram tanpa dicetak |
| Sebagian: deaktivasi | AIDA-43: notifikasi dan digest berhenti, undangan yang belum diterima dicabut. AIDA-58: token milik pembuat yang dinonaktifkan berhenti bekerja |

## Yang diminta

1. Untuk setiap baris tabel di atas, nilai `tertutup`, `sebagian`, atau `belum`, dengan satu kalimat alasan. Baca teks yang sekarang di `.planning/REQUIREMENTS.md` dan `.planning/ROADMAP.md`.
2. Laporkan hanya temuan baru tingkat HIGH: hal yang akan membuat sebuah fase mustahil ditutup dengan bukti, membocorkan data antar tenant atau pelanggan, atau memaksa bukti rekaan. Paling banyak 5. Detail yang lebih kecil akan ditangani saat review plan per fase, yang punya tiga siklus Codex sendiri.
3. Satu paragraf penutup: apakah masih ada HIGH. Jawab tegas.

## Batas mengikat

- `.planning/run-loop/PIAGAM.md`, `CLAUDE.md`, dan `PROJECT.md` mengalahkan pendapat siapa pun. Tabel fase dan rantai parkir piagam tidak boleh diubah, dan isi fase tidak boleh dibuang.
- Clean-room modul Projects berlaku.
- Tanpa Redis, satu server, satu `docker compose`.

## Format jawaban

Bahasa Indonesia. Bagian 1 berupa tabel. Bagian 2 per temuan: letak, masalah, saran, dan status `terverifikasi di kode` atau `belum terverifikasi`. Bagian 3 satu paragraf.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
