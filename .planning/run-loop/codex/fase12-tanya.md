# Fase 12 Siklus tiket: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Konteks: Fase 12 di `.planning/ROADMAP.md` (baris 263-279, enam kriteria sukses, dan baris Cross-phase risks 392-393), AIDA-18, AIDA-52 sampai AIDA-57, dan AIDA-97 di `.planning/REQUIREMENTS.md` (baris 51-58), `.planning/seeds/SEED-003-*.md` dan `SEED-004-*.md`. Batas mengikat: `.planning/run-loop/PIAGAM.md`. UI mengikuti `.planning/DESIGN-SYSTEM.md`. Fase 11 sudah dieksekusi; keputusannya di `.planning/phases/11-inbox/11-CONTEXT.md` mengikat di sini. Hasilnya menjadi `12-CONTEXT.md`.

Fase 08, 09, dan 10 diparkir. Pelajaran dari tiga fase itu dan dari Fase 11 (yang lolos):
- Plan sedikit dan mekanisme sederhana yang bisa dibuktikan Testcontainers: row lock, update bersyarat, unique constraint, satu transaksi.
- Tanpa test stack compose (owner O-1).
- E2E menyatakan hasil yang diamati.
- Setiap jalur baru memeriksa keanggotaan aktif (`findActiveMembership`, D-01 Fase 11); jalur lama yang belum memeriksa tetap AIDA-43 yang terbuka.

## Fakta yang sudah diverifikasi

- Relasi, merge, snooze, dan jeda SLA belum ada (`prisma/schema.prisma:258-295`; tidak ada "pause" di `src/lib`).
- Status (`TicketStatus` enum) dibaca di sekitar 19 berkas: `sla-flag.ts:12,24` (SQL mentah), `auto-close.ts:75-78,215,221`, `reopen-on-reply.ts:61-64`, `mutations.ts:39,52,320-333`, `list-filters.ts`, `list-query.ts`, `palette-search.ts`, `search.ts`, `thread-match.ts:66`, halaman status `page.tsx:74,116`, `csat/route.ts:24`, chip dan UI inbox, bar aksi massal, fixture demo. Insight SQL (`src/lib/insight/sla-csat.ts:35,63`) membaca `resolvedAt` dan `isAtRisk`, bukan `status`.
- Filter saved view menyimpan nilai `TicketStatus` dalam JSON `version: 1` (D-03 Fase 11).
- SLA: `computeDueTimestamps` (`sla.ts:43`) menghitung dari waktu mulai secara wall-clock; tenggat ditetapkan di `create-ticket.ts:65-66`, `mutations.ts:340`, `run-triage.ts:56`, dan seed demo; `sla-flag.ts` hanya menyetel flag, tiap 5 menit.
- Link status publik: `Ticket.statusToken` unik; halaman memuat semua pesan PUBLIC tiket itu (`page.tsx:38-47`); follow-up menulis sebagai `ticket.contactId` (`follow-up/route.ts:102`); route lampiran hanya memeriksa id tiket dan PUBLIC. Tidak ada scoping per kontak.
- Audit: `TicketAuditEvent` append-only dengan aksi ASSIGNEE_CHANGED, STATUS_CHANGED, PRIORITY_CHANGED, TAG_ADDED, TAG_REMOVED, AUTO_CLOSED; `AuditEvent` khusus AI dan tidak boleh diisi kolom AI palsu (D-07 Fase 11). AIDA-53 menyebut "full `AuditEvent`".
- KB: `KbArticle` (`schema:479-495`) tanpa status draft; pembuatan lewat admin dan langsung tayang. Belum ada drafting KB oleh AI. `llm/complete.ts` selalu meredaksi; "AI mati" berarti tidak ada provider. Gerbang manusia hari ini ada pada draft balasan (`DRAFT_APPROVED`).
- Auto-close (D-16, D-17 Fase 11): job harian dengan `UPDATE` bersyarat; jalur balasan mengunci baris tiket lalu reopen bersyarat.
- Migrasi: 8; yang terakhir `20261108140000_inbox` memuat indeks dan CHECK yang ditulis tangan dan wajib dipertahankan.

## Area abu-abu

Untuk setiap area: pilih opsi, sebut risikonya, tandai keputusan milik owner.

1. **Pemecahan fase.** Delapan requirement dengan tiga mekanisme berisiko (merge lintas kontak, status kustom dengan migrasi data, jeda SLA). Apakah fase ini perlu dipecah (misalnya 12a relasi, merge, dan snooze; 12b status kustom dan jeda SLA; 12c usulan KB), atau cukup banyak plan dalam satu fase? Urutan mana yang paling aman?
2. **Merge (AIDA-53).** Rule "setiap link status hanya menampilkan apa yang bisa dilihat pemegangnya sebelum merge plus balasan untuknya", atau menolak merge antar kontak yang berbeda (diizinkan acceptance). Audit di `TicketAuditEvent` (aksi baru) melawan "full `AuditEvent`": apakah ini keputusan owner karena menyentuh teks requirement?
3. **Relasi dan feed (AIDA-52, AIDA-55).** Jenis relasi, keunikan per pasangan termasuk arah, siklus, dan apa isi feed aktivitas (sumbernya `TicketAuditEvent` dan pesan?).
4. **Snooze (AIDA-54).** Kolom `snoozedUntil` atau state; job bangun; kedua jalur balasan membangunkan di bawah lock D-17; filter inbox; auto-close melewatinya.
5. **Status kustom (AIDA-56, AIDA-97).** Tabel state per organisasi dengan group tetap, migrasi data enum ke tabel tanpa kehilangan, cara setiap pembaca beralih ke group (termasuk SQL mentah `sla-flag`, saved view `version: 1` ke `version: 2`, halaman status publik), dan apa yang terjadi pada state yang dihapus.
6. **Jeda SLA (AIDA-57).** Model akuntansi jeda (kolom akumulasi atau log interval), group mana yang menjeda, restart worker, dan tiket PENDING saat migrasi.
7. **Usulan KB (AIDA-18).** Status draft pada `KbArticle`, pemicu, redaksi, teks tiket sebagai input tak tepercaya, dan gerbang admin sebelum tayang.
8. **Yang saya lewatkan.**

## Format jawaban

Bahasa Indonesia. Untuk setiap area: rekomendasi, alasan, risiko, dan status `terverifikasi di kode` atau `belum terverifikasi`. Tandai keputusan milik owner. Paling banyak sekitar 1.600 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
