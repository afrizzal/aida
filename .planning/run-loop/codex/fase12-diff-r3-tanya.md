# Fase 12 Siklus tiket: kritik diff fase (putaran 3 dari maksimal 3, terakhir)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan putaran 1 dan 2

- Putaran 1 (`.planning/run-loop/codex/fase12-diff-jawab.md`): D1 HIGH (sumber merge bisa dibuka kembali lewat perubahan status), D2 (cek keanggotaan terlambat di route pesan), D3 (thread email balasan antre sesudah merge), D4 (pilihan merge basi), D5 (dua pembacaan terpisah di halaman status), D6 (catatan gerbang basi). D1, D2, D4, D5 diperbaiki di pass F4; D6 dikoreksi.
- Putaran 2 (`fase12-diff-r2-jawab.md`): tanpa HIGH; D1, D2, D5 kamu nyatakan tertutup. R2-1 MEDIUM (dialog merge jatuh ke baris lama bila pembacaan ulang gagal; link yang berubah sesudah review tetap diganti), R2-2 MEDIUM (alasan K36 tidak menutup salah konteks thread dan urutan in-flight), R2-3 LOW (sumber merge tampil sebagai baris CLOSED biasa; ditunda ke visual pass).
- Disposisi: `.planning/phases/12-ticket-lifecycle/12-REVIEW.md`, bagian "Codex critique of the phase diff (round 1)" dan "(round 2)". Status perbaikan: `12-REVIEW-FIX.md`, bagian "Fix pass F4" dan "Fix pass F5".

## Perubahan pass F5 (yang belum pernah kamu lihat)

Masing-masing dengan test yang terlihat gagal sebelum perbaikan:

- R2-1: `src/lib/tickets/merge.ts` (`mergeTickets`) dan action merge kini mewajibkan `reviewedLinkLabel` (label link dari sisi sumber, atau null). Di bawah row lock, link pasangan dibaca; bila berbeda, merge ditolak `LINK_CHANGED` tanpa perubahan dan tanpa baris audit. `src/components/tickets/merge-ticket-dialog.tsx`: langkah konfirmasi hanya terbuka sesudah pembacaan ulang yang berhasil dan masih menemukan barisnya; bila gagal, langkah 1 tetap dengan pilihan tersimpan dan callout "Could not check #N again. Try again.". Test: `tests/integration/ticket-merge.test.ts`, E2E `tests/e2e/ticket-merge.spec.ts`.
- R2-2 (keputusan run K37, menggantikan K36): `src/lib/worker/jobs/email-outbound-send.ts` memakai asal `mergedFromTicketId ?? ticketId`; subjek, nomor, dan penerima dari tiket asal; riwayat `References`/`In-Reply-To` dari pesan dengan `ticketId = asal OR mergedFromTicketId = asal`, lewat `scopedDb`. Test `tests/integration/email-outbound-merge.test.ts` dengan transport SMTP palsu: balasan antre lalu merge lalu kirim; urutan in-flight (pesan dibaca sebelum merge, riwayat sesudahnya); balasan yang ditulis di target sesudah merge.

## Fakta yang sudah saya verifikasi

- Gerbang ulang sesudah F5, di commit `4acce90` (`12-GATE.md`, bagian "Rerun after Codex diff round 2 fixes"): `lint`, `typecheck`, `test` (276), integration tanpa egress (34 berkas, 300), E2E penuh (165 lolos, 1 skip lama, 0 gagal), dan `build` semuanya exit 0; `audit --prod` exit 1 dengan angka baseline. Integration penuh dan `test:egress` blocked (owner O-1).
- Predikat provenance di `status-visibility.ts` tidak berubah sejak putaran 1.

## Pertanyaan

1. Apakah R2-1 dan R2-2 benar-benar tertutup di kode, termasuk semua pemanggil `mergeTickets` (action, test, fixture, seed demo)?
2. Apakah perubahan F5 membuka masalah baru? Perhatikan khususnya: perbandingan label link (arah, pasangan parent/child, link duplikat), urutan baca link terhadap lock merge, `LINK_CHANGED` sebagai penolakan aturan di UI, dan worker email (organisasi, tiket asal yang tidak ditemukan, retry pg-boss sesudah merge, pesan yang dipindah dari sumber yang punya riwayat panjang).
3. Adakah HIGH yang tersisa di seluruh diff fase yang membuat fase ini tidak layak masuk verifikasi?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan berkas dan baris, bukti, dampak, dan perbaikan konkret; lalu satu paragraf: apakah fase ini layak masuk verifikasi. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 900 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
