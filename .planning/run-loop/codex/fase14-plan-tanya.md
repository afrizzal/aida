# Fase 14 Fondasi Projects: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Clean-room: produk rujukan tanpa lisensi; yang boleh hanya `.planning/run-loop/FITUR-PROJECTS.md`. Jangan menyebut, menebak, atau meniru kode, nama tabel, teks UI, atau tata letak produk rujukan.

## Yang direview

13 plan di `.planning/phases/14-projects-foundation/14-01-PLAN.md` sampai `14-13-PLAN.md` (7 wave) untuk AIDA-64 sampai AIDA-71 dan AIDA-100 sampai AIDA-105. Keputusan mengikat: `14-CONTEXT.md` (D-01 sampai D-17, keputusan run K61 sampai K64, butir owner 14-o1 dan 14-o2), dari brainstorm denganmu di `.planning/run-loop/codex/fase14-jawab.md`. Peta pola: `14-PATTERNS.md` (temuan C1 sampai C18). Keputusan run sesudah CONTEXT (lihat akhir `.planning/run-loop/RUN-LOG.md`): K65 deskripsi dan komentar task dirender tanpa gambar dengan tautan aman; K66 penghapusan berkas lampiran lewat outbox di transaksi hapus dan job sapu terjadwal; K67 baris milik task merujuk `(organizationId, taskId)`; K68 worker memasang volume uploads di kedua berkas compose. Plan 14-01 membekukan kontrak (`14-CONTRACT.md` dan `src/lib/projects/contract.ts`): 76 operasi dengan level akses, mode lock, dan verb aktivitas. Batas run: `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Wave: 1: 01; 2: 02, 03; 3: 04, 05; 4: 06, 07; 5: 08, 09, 10, 11; 6: 12; 7: 13. Orkestrator mengeksekusi plan satu per satu.
- Plan checker iterasi 1 (tiga irisan) menemukan 1 blocker (relasi komposit ke Project tidak disebut untuk ProjectMember, ProjectTeam, ProjectLabel, ProjectMilestone, ProjectFavorite; tanpa test lintas organisasi), 9 warning, dan 5 info; semuanya diperbaiki di `10b43e0`. Keputusan orkestrator: proyek terarsip tetap boleh dihapus (hapus keras K64 adalah jalur bersih-bersih), dicatat sebagai penyimpangan dari D-12 di bagian 16 kontrak.
- Plan checker iterasi 2: semua butir tertutup; 3 warning yang belum masuk plan (akan dibawa bersama temuanmu, tidak perlu dilaporkan ulang kecuali ada akibat lain): plan 14-04, 14-10, dan 14-12 tidak menuliskan eksplisit bentuk test bagian 17 kontrak yang diperiksa inventaris 14-13 (judul describe per operasi, `missingId()`, MEMBERSHIP_ENDED, snapshot tabel, verb di blok `it` yang sama).
- Probe deterministik: 39 perintah verifikasi, semua punya arah gagal; tidak ada `rm -rf`.
- Cacat lama yang ditemukan pattern mapper dan dicek di kode: worker menyimpan lampiran email masuk (`src/lib/channels/email/ingest-message.ts:146`) tetapi hanya `app` yang memasang volume uploads di `docker-compose.yml`; K68 memperbaikinya, dan stack compose belum bisa dijalankan (butir owner O-1).

## Pertanyaan

Untuk setiap temuan: plan dan task, bukti (berkas dan baris), dampak, dan perbaikan konkret. Severity HIGH (acceptance gagal, melanggar piagam atau clean-room, celah tenancy atau proyek privat bocor, data hilang, deadlock), MEDIUM, atau LOW.

1. **Kontradiksi internal.** Acceptance atau grep yang menunjuk berkas lain dari tempat aksi menaruh kodenya; test yang mengharapkan hasil bertentangan dengan kontrak 14-01 atau plan lain; verifikasi yang menjalankan kode yang baru dibangun plan sesudahnya; helper test yang tidak bisa mengamati perilaku PostgreSQL sebenarnya.
2. **Proyek privat (AIDA-71).** Apakah setiap jalur baca dan tulis (detail, daftar, agregat, komentar, unggah dan unduh lampiran, aktivitas, alias kunci, favorit, pindah, duplikat, bulk, recurrence) melewati kebijakan akses dan terbukti tanpa mock untuk anggota, anggota tim, non-anggota, admin organisasi, dan organisasi lain? Apakah protokol lock (urutan Team, Project, Task, counter, kunci, outbox, aktivitas; konten `FOR SHARE`, revokasi `FOR UPDATE`) bebas deadlock dan menutup race revokasi?
3. **Skema dan migrasi (plan 02).** FK komposit RESTRICT, trigger subtask satu tingkat dengan lock, trigger append-only aktivitas, CHECK tanggal, tabel tanpa FK yang harus bertahan sesudah hapus (aktivitas, kunci, prefix, outbox), satu migrasi dibuat dengan `migrate dev --create-only` di database sementara, objek `searchVector` lama dipertahankan.
4. **Identitas dan konkurensi.** Kunci task unik di bawah konkurensi, alias dan tombstone, prefix yang berubah; recurrence tepat sekali (flag di bawah lock plus indeks unik predecessor), akhir bulan, zona waktu dan DST; rank dan rebalance; bulk atomik maksimal 100; edit berversi.
5. **Aktivitas dan hapus (AIDA-68, 103, 104).** Satu record per mutasi yang berubah, tanpa record untuk no-op dan favorit; nilai dibatasi; hapus keras dengan konfirmasi, tombstone, outbox; `AuditEvent` tidak pernah dihapus; klaim acceptance audit menunggu owner (14-o2).
6. **Pelanggaran piagam.** Checkpoint manusia, scope dibuang, `prisma db push`, `.env`, `rm -rf` (menghapus `.next/` adalah butir owner yang terbuka), egress baru, container baru, panggilan AI, nama orang atau path rumah, nama produk rujukan di luar `.planning`, klaim lulus untuk hasil merah.

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat, lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.500 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
