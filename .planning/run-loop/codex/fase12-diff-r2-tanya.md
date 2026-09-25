# Fase 12 Siklus tiket: kritik diff fase (putaran 2 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Ringkasan putaran 1

Di putaran 1 (`.planning/run-loop/codex/fase12-diff-jawab.md`) kamu memberi 6 temuan: D1 HIGH (perubahan status tunggal atau massal bisa membuka kembali sumber merge), D2 HIGH (route pesan agen membaca tiket, setting email, dan berkas staged sebelum cek keanggotaan; run menilainya MEDIUM karena hanya oracle keberadaan id), D3 sampai D5 MEDIUM, dan D6 LOW. Semua dicek ke kode dan benar. Disposisi ada di `.planning/phases/12-ticket-lifecycle/12-REVIEW.md`, bagian "Codex critique of the phase diff (round 1)"; status perbaikan di `12-REVIEW-FIX.md`, bagian "Fix pass F4".

Perbaikan, masing-masing dengan test yang terlihat gagal sebelum perbaikan:

- D1: `src/lib/tickets/mutations.ts` (`runTicketMutation`) membaca `mergedIntoTicketId` di bawah row lock dan menolak perubahan status dengan `MERGED_SOURCE` bila ada sumber merge dalam batch; seluruh batch di-rollback. Assignee, prioritas, dan tag tetap bisa diubah. Kontrol status di `src/components/tickets/ticket-meta-header.tsx` menonaktifkan semua pilihan dengan alasan "This ticket was already merged."; `bulk-action-bar.tsx` memetakan kode baru. Test: `tests/integration/ticket-mutations.test.ts` (tunggal, massal, dan perubahan status yang menunggu lock merge lalu berjalan sesudah merge commit), E2E di `ticket-merge.spec.ts` dan `bulk-actions.spec.ts`.
- D2: `src/app/api/tickets/[id]/messages/route.ts` memanggil `findActiveMembership` segera sesudah sesi, sebelum membaca apa pun; cek di dalam transaksi tetap ada. 403 yang sama untuk id yang ada, id yang tidak ada, dan body tidak valid.
- D4: `merge-ticket-dialog.tsx` dan `ticket-picker.tsx` menyegarkan pilihan yang disimpan dari baris picker terbaru, dan "Review merge" membaca ulang baris itu lebih dulu. Tanpa perubahan server.
- D5: `src/lib/tickets/status-page-data.ts` (`loadStatusPageData`, `loadStatusAttachment`) membaca penanda merge dan baris dalam satu transaksi `REPEATABLE READ`; route lampiran memakai `loadStatusAttachment`. Test `tests/integration/status-read-snapshot.test.ts` meng-commit merge di antara dua pembacaan lewat seam.
- D3 tidak diubah (keputusan run K36): balasan QUEUED yang dipindah merge sampai ke kontak yang sama (merge menolak kontak berbeda) dengan thread target; dicatat di `deferred-items.md`.
- D6: catatan di `12-GATE.md` (butir terbuka 11) dikoreksi.

## Fakta yang sudah saya verifikasi

- Gerbang ulang sesudah F4, di commit `d61b370` (`12-GATE.md`, bagian "Rerun after Codex diff round 1 fixes"): `lint`, `typecheck`, `test` (274), integration tanpa egress (33 berkas, 290), E2E penuh (163 lolos, 1 skip lama, 0 gagal), dan `build` semuanya exit 0; `audit --prod` exit 1 dengan angka baseline. Integration penuh dan `test:egress` blocked (owner O-1).
- Predikat provenance di `status-visibility.ts` tidak berubah oleh perbaikan.

## Pertanyaan

1. Apakah D1, D2, D4, dan D5 benar-benar tertutup di kode? Untuk D1: adakah jalur lain yang masih bisa mengubah status sumber merge (auto-close, reopen saat balasan, snooze dan wake, seed demo, triage AI, action lain)? Apakah keputusan membiarkan assignee, prioritas, dan tag bisa diubah pada sumber merge menimbulkan masalah nyata (misalnya muncul di antrean agen)?
2. Apakah perbaikan membuka masalah baru? Perhatikan khususnya transaksi `REPEATABLE READ` di halaman publik (timeout, pool koneksi, retry serialisasi), urutan lock baru di `runTicketMutation`, dan sinkronisasi pilihan di dialog merge.
3. Apakah keputusan K36 (D3) masuk akal, atau ada dampak nyata yang terlewat?
4. HIGH yang tersisa: adakah yang membuat fase ini tidak layak masuk verifikasi?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan berkas dan baris, bukti, dampak, dan perbaikan konkret; lalu satu paragraf: apakah fase ini layak masuk verifikasi. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.000 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
