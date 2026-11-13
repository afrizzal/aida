# Fase 11 susulan O-2: brainstorm pemberitahuan auto-close ke pelanggan (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini; jangan mencari `node_modules` di luar folder ini.

## Latar

Fase 11 mengirim auto-close tiket resolved (AIDA-51) tanpa pemberitahuan ke pelanggan (D-19 di `.planning/phases/11-inbox/11-CONTEXT.md`, butir owner O-2). Owner sudah memutuskan O-2. Plan susulan Fase 11 dikerjakan sesudah Fase 10 (sudah selesai, `10-VERIFICATION.md` `human_needed` 5/5). Tambahan CONTEXT ada di `11-CONTEXT.md`, bagian "Update 2026-11-13: owner item O-2 decided" (W-01 sampai W-15). Bacalah lebih dulu. Ini bukan review plan, melainkan brainstorm untuk tambahan CONTEXT itu.

## Keputusan owner (kata per kata, mengikat)

Sumber: `.planning/run-loop/ANTREAN.md`, baris `11-o2`:

> "Owner 2026-11-11: butir 10: opsi a, "ya" tegas dari owner. Template tetap yang ditulis admin, mati secara default, dinyalakan admin per workspace. Kerjakan sesudah Fase 10 sebagai plan susulan Fase 11."

Artinya: template tetap yang ditulis admin, mati secara default, dinyalakan admin per workspace, boleh dikirim otomatis ke pelanggan saat tiket auto-close tanpa persetujuan manusia per pesan. Jangan membuka ulang keputusan ini. Yang boleh kamu nilai hanya cara teknisnya. AIDA-51 (`.planning/REQUIREMENTS.md:47`): "any customer notice is a fixed template, off by default, with no AI text".

## Fakta yang sudah saya verifikasi di kode

- `closeResolvedTicketIfQuiet` (`src/lib/worker/jobs/auto-close.ts:98-152`): satu transaksi per tiket (`:289-299`, timeout 30 s di `:63`); urutan lock: baris days `Setting` `FOR SHARE` (`src/lib/tickets/auto-close-settings.ts:100-125`), config dan state tujuan `FOR SHARE` (`auto-close.ts:111-117`), lalu baris tiket (`:119`); satu `UPDATE … RETURNING` bersyarat (`:125-140`); audit `AUTO_CLOSED` hanya bila baris berubah (`:141-150`). Batas 100 per organisasi per run (`:60`). Error satu organisasi membuat run melempar `AutoCloseRunError` di akhir (`:237-248`).
- Worker memanggil `autoCloseHandler(job.data)` tanpa handle pg-boss (`src/lib/worker/index.ts:72-76`). Tidak ada job worker yang meng-enqueue job lain; `boss.send("email-outbound-send", …)` hanya di app (`src/app/api/tickets/[id]/messages/route.ts:255-259`, `src/app/(app)/tickets/[id]/actions.ts:95`).
- Simpan setelan: `saveAutoCloseDays` memegang `FOR UPDATE` pada baris days sepanjang transaksi (`auto-close-settings.ts:177-228`), tetapi gerbangnya `findActiveMembership` plus `isAdminRole` (`:168-170`), bukan bacaan konservatif `findConservativeMembership` (`src/lib/membership.ts:81`).
- `emailOutboundSendHandler` (`src/lib/worker/jobs/email-outbound-send.ts:62-172`): hanya `Message` `OUTBOUND` `PUBLIC`; diam-diam kembali bila kanal email mati (`:81-82`), baris `QUEUED` dibiarkan; `FAILED` lalu lempar ulang untuk retry (`:162-169`, `retryLimit` 2 di `index.ts:103-110`); subjek `Re: {subject} [#{number}]` (`:155`). `composeMail` tidak menerima header tambahan (`src/lib/channels/email/compose-outbound.ts:28-55`), jadi tanpa `Auto-Submitted` dan tanpa batas waktu total.
- Digest Fase 10: `sendDigestMail` (`src/lib/notifications/digest-sender.ts:162`) memegang socket sendiri dengan tenggat total (`:1-9`), hasil `accepted`, `rejected` (jenis `configuration`, `permanent`) atau `ambiguous` (`:11-30`), dan header `Auto-Submitted: auto-generated` (`:48-50`).
- Inbound: `Auto-Submitted` selain `no` dianggap otomatis (`src/lib/channels/email/auto-generated.ts:9-10`) dan tidak pernah membuka ulang. Balasan pelanggan nyata membuka ulang tiket grup `RESOLVED` atau `CLOSED` (`src/lib/tickets/reopen-on-reply.ts:273`). Cadangan threading: token subjek `[#number]` (`src/lib/channels/email/thread-match.ts:3-7`).
- `Message` tanpa penanda jenis atau sistem (`prisma/schema.prisma:380-409`). Pesan `OUTBOUND` tanpa penulis tampil sebagai "Agent" (`src/components/tickets/thread-message.tsx:53-55`), dan semua pesan `PUBLIC` tampil di halaman status publik (`src/lib/tickets/status-visibility.ts:56-59`). `TicketAuditAction` belum punya nilai pemberitahuan (`schema.prisma:663-673`). Belum ada model template atau canned response.
- Intake publik membuat tiket dan contact untuk alamat email apa pun, dibatasi per IP (`src/app/api/public/intake/route.ts:61-71`, `:103-108`). `Ticket.statusToken` disimpan polos (`schema.prisma:306`).
- Migrasi terakhir `20261115100000_team_foundation`; migrasi baru wajib masuk `UPGRADE_MIGRATIONS` (`tests/integration/auth-upgrade.test.ts:38-48`). SQL mentah di worker butuh entri allowlist Rule D (`tests/unit/membership-inventory.test.ts:20-23`, contoh `:341-346`).

## Kandidat keputusan (ringkas; rinciannya di CONTEXT)

- W-01 penyimpanan template: (a) kunci `Setting` tanpa tabel baru, teks polos atau Markdown tersanitasi 1 sampai 2000 karakter; (b) model baru.
- W-02 sakelar per workspace, mati bila kunci tidak ada; dibaca di bawah `FOR SHARE` baris days; isi template disalin ke catatan pemberitahuan saat close.
- W-03 hanya owner dan admin, bacaan konservatif.
- W-04 placeholder: (a) daftar tertutup `{ticketNumber}`, `{workspaceName}`; (b) tanpa placeholder. Subjek: (a) `Re: {subject} [#n]`; (b) subjek sistem tetap dengan `[#n]`. Tanpa tautan halaman status.
- W-05 kapan dikirim: tidak di dalam transaksi close; catatan outbox di transaksi, kirim sesudah commit: (a) oleh job auto-close dengan sender bertenggat pola digest; (b) antrean baru plus sapuan yatim; (c) pakai ulang `email-outbound-send`.
- W-06 paling banyak satu pemberitahuan per peristiwa close lewat kunci unik; `ambiguous` tidak diulang.
- W-07 pencatatan: (a) `Message` dengan penanda baru; (b) model baru plus nilai `TicketAuditAction` baru; (c) boolean di snapshot `AUTO_CLOSED`.
- W-08 email saja; contact tanpa alamat dicatat `SKIPPED`.
- W-09 header `Auto-Submitted: auto-generated`.
- W-10 kanal mati: tiket tetap tutup, catatan `SKIPPED`, tidak dikirim belakangan; gagal kirim: `FAILED` dengan kode saja.
- W-11 privasi: tanpa catatan internal, nama member, draf AI, atau riwayat kutipan.
- W-12 batas penyalahgunaan lewat intake.
- W-13 UI di halaman SLA sesuai `.planning/DESIGN-SYSTEM.md`, addendum UI-SPEC lebih dulu.
- W-14 test unit, integration Testcontainers, inventori, E2E lewat UI asli dengan transport palsu.

## Pertanyaan

1. **W-05 dan W-10, jalur kirim.** Opsi (a), (b), atau (c)? Bagaimana catatan yang sudah commit tetapi belum terkirim (worker mati di antara commit dan kirim) ditangani tanpa mengirim dua kali dan tanpa mengirim berhari-hari terlambat? Apakah kegagalan pemberitahuan boleh membuat run melempar `AutoCloseRunError`, padahal pg-boss lalu mengulang seluruh run?
2. **W-06, idempoten.** Per peristiwa close atau per tiket selamanya? Kunci unik pada apa persisnya? Apakah at-most-once pada `ambiguous` benar untuk pemberitahuan sopan seperti ini?
3. **W-07, pencatatan dan threading.** `Message` dengan penanda atau catatan terpisah? Apakah perubahan skema benar-benar perlu? Kalau catatan terpisah, apakah balasan pelanggan ke pemberitahuan masih ter-thread lewat header, atau cukup token `[#n]`? Apa akibatnya bagi aturan merge dan `seq` di `email-outbound-send.ts:9-36`?
4. **W-04 dan W-12, data tidak tepercaya.** Subjek `Re: {subject}` menggemakan teks pelanggan dari pengirim otomatis; intake menerima alamat siapa pun. Apakah perlu syarat bukti bahwa alamat itu pernah ikut (email masuk atau balasan publik terkirim), atau cukup karena agen yang me-resolve? Placeholder apa yang aman?
5. **W-02 dan W-03, lock dan gerbang.** Apakah `FOR SHARE` baris days cukup supaya close membaca pasangan sakelar dan isi yang konsisten bila template disimpan di bawah `FOR UPDATE` yang sama? Perlukah plan ini memindah `saveAutoCloseDays` ke bacaan konservatif, atau itu melebar dari scope?
6. **W-08, halaman status.** Tampilkan pemberitahuan di halaman status atau tidak? Sebut juga paling banyak dua konflik antara W-01 sampai W-15 dan kode sekarang yang belum tercatat, dengan berkas dan baris.

## Format jawaban

Bahasa Indonesia. Temuan diurutkan menurut tingkat (HIGH, MEDIUM, LOW), masing-masing dengan berkas dan baris. Per pertanyaan: rekomendasi, alasan, dan jebakan. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 800 kata.

Cari kelemahan, jangan setuju demi setuju, tandai klaim yang belum kamu verifikasi, baca hanya folder kerja ini, jangan menulis file.
