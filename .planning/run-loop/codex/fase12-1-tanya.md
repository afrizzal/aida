# Fase 12.1 Status kustom dan jeda SLA: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Konteks: Fase 12.1 di `.planning/ROADMAP.md` (bagian "Phase 12.1", dua kriteria sukses), AIDA-56, AIDA-97, dan AIDA-57 di `.planning/REQUIREMENTS.md`, `.planning/seeds/SEED-004-custom-workflow-states.md`, dan `.planning/research/plane-inspiration.md` §4 baris 4. Batas mengikat: `.planning/run-loop/PIAGAM.md`. UI mengikuti `.planning/DESIGN-SYSTEM.md` (token saja, tanpa warna hardcode). Hasilnya menjadi `12.1-CONTEXT.md`.

Kamu sudah memberi rekomendasi untuk area ini di brainstorm Fase 12 (`.planning/run-loop/codex/fase12-jawab.md`, area 5, 6, dan 8): lima nilai enum menjadi lima state terpisah dengan group tetap; default dan state tujuan eksplisit untuk transisi otomatis; saved view `version: 1` dipetakan ke ID state lalu `version: 2`; hapus state hanya sesudah reassignment dalam transaksi; jeda hanya di group `pending` dengan `pauseStartedAt` dan akumulasi, digeser di bawah lock saat keluar dari pending; tiket yang sudah `PENDING` saat migrasi memakai waktu migrasi sebagai awal jeda. Sejak itu Fase 12 sudah dieksekusi dan menambah pembaca status. Putaran ini untuk mempertajam, bukan mengulang.

## Fakta yang sudah diverifikasi

- Enum `TicketStatus` (`prisma/schema.prisma:182-188`): NEW, OPEN, PENDING, RESOLVED, CLOSED. Tenggat ada di `Ticket.firstResponseDueAt` dan `resolutionDueAt` (`schema.prisma:271-272`), dihitung `computeDueTimestamps` (`src/lib/tickets/sla.ts:43`) secara wall-clock dari waktu mulai.
- Worker `sla-flag` (`src/lib/worker/jobs/sla-flag.ts`) adalah dua `UPDATE` SQL mentah lintas organisasi dengan `status NOT IN ('RESOLVED', 'CLOSED')` dan `${now}` dari Node; flag hanya dinaikkan, dan dibersihkan oleh action saat first response atau resolve.
- Sekitar 25 berkas produk membaca nilai status (grep `TicketStatus` dan literal nilai enum di `src`), termasuk pembaca baru Fase 12 (D-02 di `.planning/phases/12-ticket-lifecycle/12-CONTEXT.md`): merge menutup sumber ke `CLOSED` (`src/lib/tickets/merge.ts:261-294`); snooze menolak `CLOSED` (`src/lib/tickets/snooze.ts:116`); kondisi snooze di auto-close; wake di jalur balasan; filter snooze di inbox; `runTicketMutation` menolak perubahan status pada sumber merge (`src/lib/tickets/mutations.ts:263`); halaman status publik dan route CSAT (`src/app/api/public/status/[token]/csat/route.ts:24`, hanya RESOLVED atau CLOSED).
- Insight (`src/lib/insight/sla-csat.ts`) membaca `resolvedAt` dan flag SLA, bukan `status`.
- Filter saved view disimpan sebagai JSON `version: 1` berisi nilai `TicketStatus` (D-03 Fase 11).
- Audit `TicketAuditEvent` menyimpan `before`/`after` JSON, termasuk nilai status lama; feed Fase 12 merender label dari tabel copy (`src/lib/tickets/activity-copy.ts`).
- Migrasi terakhir `20261109100000_ticket_lifecycle`; migrasi sebelumnya punya indeks, CHECK, dan kolom `searchVector` yang ditulis tangan dan wajib dipertahankan (Prisma `migrate dev --create-only` membuang kolom itu, jadi dihapus dengan tangan).
- Test egress dan stack compose blocked (owner O-1); test memakai Testcontainers.

## Area abu-abu

Untuk setiap area: pilih opsi, sebut risikonya, tandai keputusan milik owner.

1. **Model data dan integritas.** `TicketState` per organisasi dengan group tetap. Apakah `Ticket` menyimpan `stateId` saja, atau juga group terdenormalisasi untuk SQL mentah dan halaman publik? Kalau terdenormalisasi, apakah FK komposit `(stateId, group)` dan `(stateId, organizationId)` ke `TicketState` cukup untuk mencegah drift dan state lintas organisasi? Apa peran sistem yang dibutuhkan (default tiket baru, tujuan reopen, tujuan auto-close, tujuan merge, tujuan resolve dari aksi lama) dan di mana disimpan?
2. **Migrasi data.** Urutan langkah SQL (buat tabel, isi lima state per organisasi, isi `stateId`, ubah saved view `version: 1` ke `version: 2`, buang atau pertahankan enum), organisasi tanpa tiket, nilai saved view yang tidak dikenal, URL filter lama, dan cara membuktikan "tanpa kehilangan data" di test Testcontainers pada data berisi.
3. **Pembaca status.** Untuk setiap kelompok pembaca (buat tiket, reopen saat balasan, auto-close, merge, snooze, wake, mutasi tunggal dan massal, sla-flag, CSAT, halaman publik, filter dan chip, palette, triage AI, fixture demo, feed dan audit lama), apakah ia bernalar dengan group, dengan peran sistem, atau dengan state tertentu? Apa yang ditampilkan halaman status publik: nama state internal ("Waiting on engineering") atau label group? Ini menyangkut privasi.
4. **Pengelolaan state (AIDA-97).** Buat, ganti nama, ganti warna, urutkan, set default, dan hapus dengan reassignment. Konkurensi hapus state melawan tiket yang sedang ditulis, saved view yang menunjuk state terhapus, audit lama yang menyimpan nama atau id state, dan warna: palet token tetap (misalnya delapan token state) agar sesuai design system dan terbaca di mode gelap, tanpa mengandalkan warna saja.
5. **Jeda SLA (AIDA-57).** Kolom yang dibutuhkan, rumus saat keluar dari pending, perubahan prioritas atau kebijakan SLA selama jeda, first response saat pending, perpindahan antar state pending, restart worker, tiket pending saat migrasi, dan cara menguji "worker nyata tidak menaikkan flag selama jeda" tanpa sleep (jam terkontrol). Apakah snooze menjeda SLA? Apakah sumber merge yang sedang pending perlu menutup jedanya?
6. **Pemecahan plan dan urutan.** Fase ini menyentuh skema inti, banyak pembaca, UI admin, dan SLA. Berapa plan dan wave yang aman (pelajaran: plan sedikit, mekanisme sederhana yang bisa dibuktikan Testcontainers, tidak ada kontradiksi antar plan), dan apa yang perlu dibekukan lebih dulu?
7. **Yang saya lewatkan.**

## Format jawaban

Bahasa Indonesia. Untuk setiap area: rekomendasi, alasan, risiko, dan status `terverifikasi di kode` atau `belum terverifikasi`. Tandai keputusan milik owner. Paling banyak sekitar 1.600 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
