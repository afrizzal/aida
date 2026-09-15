# Fase 11 Inbox: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Konteks: Fase 11 di `.planning/ROADMAP.md` (termasuk tabel Cross-phase risks), AIDA-47 sampai AIDA-51 di `.planning/REQUIREMENTS.md`, `.planning/seeds/SEED-005-*.md`, `SEED-006-*.md`, `SEED-009-*.md`, dan `.planning/research/plane-inspiration.md` §4 (hanya sebagai rujukan perilaku). Batas mengikat: `.planning/run-loop/PIAGAM.md`. UI wajib mengikuti `.planning/DESIGN-SYSTEM.md`. Hasilnya menjadi `11-CONTEXT.md`.

Fase 08, 09, dan 10 diparkir sesudah tiga siklus review plan masing-masing (lihat bagian Outcome di `08-REVIEWS.md`, `09-REVIEWS.md`, dan `10-REVIEWS.md`). Akibatnya kode belum berubah: `better-auth` masih 1.6.22, belum ada CSP, `getScopedDb` (`src/lib/session.ts:38-43`) belum memeriksa keanggotaan, dan model notifikasi belum ada. Pelajaran yang mengikat di sini:
- Plan sedikit dan sederhana. Setiap mekanisme baru harus bisa dibuktikan dengan unit test atau Testcontainers (row lock, update bersyarat, unique constraint, satu transaksi).
- Tanpa test yang menyalakan stack compose (keputusan owner O-1 masih terbuka).
- Skrip E2E menyatakan hasil yang diamati, bukan urutan tombol yang rapuh.
- Tidak ada edit plan sesudah review tanpa diperiksa lagi.

## Fakta yang sudah diverifikasi

- Filter inbox: `TicketListFilters` di `src/lib/tickets/list-query.ts:10-17` (`view` unassigned/mine/all, `statuses`, `tagId`, `cf`, `q`, `limit`), di-parse dari query string oleh `parseTicketListFilters` (baris 38-69) tanpa zod. Encoding custom field ada di `src/lib/tickets/cf-param.ts`. `zod` 4.4.3 terpasang.
- Belum ada model `SavedView` dan belum ada konsep snooze di `prisma/schema.prisma`. `TicketStatus`: NEW, OPEN, PENDING, RESOLVED, CLOSED. `TicketPriority`: LOW, NORMAL, HIGH, URGENT. AIDA-56 (Fase 12) kelak mengubah status menjadi tabel.
- Mutasi satu tiket ada di `src/app/(app)/tickets/[id]/actions.ts`: `changeStatus` (baris 25), `changePriority` (50, menghitung ulang tenggat SLA dan mereset flag), `assignTicket` (198, belum memeriksa keanggotaan assignee), `addTag` (215), dan `removeTag` (235). Tidak satu pun menulis audit.
- `AuditEvent` (`prisma/schema.prisma:446-461`) khusus AI: kolom `provider`, `model`, `input`, dan `output` wajib diisi; enum `AuditActionType` hanya TRIAGE, DRAFT_GENERATED, DRAFT_APPROVED, INSIGHT_CLUSTER_LABELS, INSIGHT_SUMMARY; append-only lewat trigger database; satu-satunya jalur tulis adalah `src/lib/audit/record-audit-event.ts`. AIDA-48 dan AIDA-51 mewajibkan audit untuk aksi non-AI.
- Pengaturan per organisasi: model `Setting` (key-value, unique `[organizationId, key]`). Halaman pengaturan SLA ada di `src/app/(app)/settings/sla/`.
- Worker pg-boss: `src/lib/worker/index.ts` memakai `boss.schedule`; `sla-flag` berjalan tiap 5 menit dengan SQL berbasis set (`src/lib/worker/jobs/sla-flag.ts`).
- Balasan pelanggan membuka ulang tiket RESOLVED atau CLOSED: `src/lib/channels/email/ingest-message.ts:188` dan `src/app/api/public/status/[token]/follow-up/route.ts:84-88`.
- Palette: `cmdk` ^1.1.1 dan `src/components/ui/command.tsx` sudah ada. Pencarian FTS yang aman per organisasi ada di `src/lib/tickets/search.ts`. Handler `keydown` lokal sudah ada di `filter-chip-row.tsx`, `tag-manager.tsx`, dan `ticket-meta-header.tsx`; belum ada shortcut global.

## Area abu-abu

Untuk setiap area: pilih opsi, sebut risikonya, tandai keputusan milik owner.

1. **Saved views (AIDA-47):** bentuk model dan JSON filter (skema zod dari `TicketListFilters`; apakah `q` dan `limit` ikut disimpan), siapa yang boleh membuat, mengubah, dan menghapus view bersama, view yang merujuk tag atau custom field yang sudah dihapus, nama unik, urutan, dan test isolasi tanpa mock.
2. **Aksi massal (AIDA-48):** di mana audit non-AI disimpan, dengan opsi: (a) perluas `AuditEvent` (enum baru, kolom AI jadi nullable, migrasi pada tabel append-only); (b) tabel append-only baru per tiket, ter-scope organisasi; (c) lainnya. Apakah aksi satu tiket ikut memakai service dan audit yang sama. Batas jumlah tiket per batch, semua-atau-tidak-sama-sekali dalam satu transaksi, perhitungan ulang SLA saat prioritas berubah, validasi assignee, dan cara membuktikan rollback.
3. **Command palette (AIDA-49):** API registry yang bisa menerima command dari modul lain (Fase 16 akan memakainya), deteksi konteks per halaman, pencarian tiket lewat FTS yang ada, buat tiket, ganti view, dan E2E per kelompok command.
4. **Keyboard (AIDA-50):** peta tombol untuk inbox dan halaman tiket, chord dengan timeout, guard untuk input, textarea, contenteditable, dialog, dan komposisi IME, modal `?`, halaman docs, bentrok dengan shortcut browser dan pembaca layar, serta cara menyatukan handler lokal yang sudah ada.
5. **Auto-close (AIDA-51):** default pengaturan (0 = mati?), timestamp "sepi" (`resolvedAt`, pesan terakhir, catatan internal dihitung atau tidak), race dengan balasan pelanggan yang membuka ulang tiket, idempotensi dan batas per run, audit per tiket, pemberitahuan pelanggan dengan template tetap (mati secara default) lewat jalur kirim yang ada, dan perilaku saat diaktifkan pada data lama (ribuan tiket RESOLVED lama tertutup sekaligus).
6. **Celah warisan:** fase-fase yang diparkir meninggalkan `getScopedDb` tanpa cek keanggotaan dan `assignTicket` tanpa validasi assignee. Apa yang wajib dilakukan Fase 11 dan apa yang cukup dicatat?
7. **Pemecahan plan** dan wave: jumlah plan sekecil mungkin, bukti mandiri per plan, tanpa test stack compose.
8. **Yang saya lewatkan.**

## Format jawaban

Bahasa Indonesia. Untuk setiap area: rekomendasi, alasan, risiko, dan status `terverifikasi di kode` atau `belum terverifikasi`. Tandai keputusan milik owner. Paling banyak sekitar 1.500 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
