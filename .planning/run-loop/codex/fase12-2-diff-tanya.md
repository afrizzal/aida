# Fase 12.2 Usulan artikel KB dari tiket yang selesai: kritik diff fase (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang dikritik

Kode Fase 12.2 (AIDA-18) sudah dieksekusi (12 plan), di-review empat bagian, dan diperbaiki dalam empat batch. Berkas produk yang berubah: dua migrasi `prisma/migrations/20261111100000_kb_proposals` dan `20261112100000_kb_proposal_final_fence`, `prisma/schema.prisma`; `src/lib/kb/` (`proposal-contract.ts`, `proposal-request.ts`, `proposal-sources.ts`, `proposal-review.ts`, `proposal-queries.ts`, `proposal-prompt.ts`, `proposal-schema.ts`, `proposal-copy.ts`, `proposal-outcome.ts`, `proposal-entry.ts`, `proposal-editor.ts`, `proposal-arrival.ts`, `proposal-queue.ts`, `generate-proposal.ts`, `create-article.ts`, `article-reads.ts`); `src/lib/llm/` (`errors.ts`, `complete.ts`, adapter `openai.ts`, `anthropic.ts`, `ollama.ts`); `src/lib/worker/index.ts`, `src/lib/worker/jobs/kb-embed-article.ts`, `kb-proposal-generate.ts`; `src/lib/queue/boss-client.ts`; `src/lib/membership.ts`; `src/lib/markdown/render.ts`; halaman dan action di `src/app/(app)/kb/` dan titik masuk di `src/app/(app)/tickets/` serta `src/components/kb/`, `src/components/tickets/`; `src/app/globals.css`; `README.md`; test di `tests/`.

Konteks: `.planning/phases/12.2-ticket-lifecycle-knowledge-from-resolved-work/` (`12.2-CONTEXT.md`, `12.2-UI-SPEC.md` dengan amandemen A1 sampai A8, `12.2-REVIEWS.md`, SUMMARY tiap plan, `12.2-GATE.md`, `12.2-REVIEW*.md` dengan bagian "Orchestrator dispositions", `12.2-REVIEW-FIX.md`, `deferred-items.md`), `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Code review GSD empat bagian (statis): 2 Critical (temuan yang sama dari dua reviewer: gambar remote di Markdown buatan AI dimuat saat admin membuka review, sehingga injeksi lewat tiket bisa membocorkan teks), 23 Warning, 28 Info. Disposisi dan keputusan run K54 sampai K57 ada di akhir `12.2-REVIEW.md`; K53 (pembungkus emphasis) diputuskan saat eksekusi.
- Perbaikan F1 sampai F4 (sekitar 44 commit, dicatat di `12.2-REVIEW-FIX.md`): integrasi penuh tanpa egress 738 lolos sesudah F2; unit 640 lolos sesudah F4; run gabungan E2E lima spec 50 lolos sesudah satu merah yang dicatat (spec lama membaca Setting tanpa filter organisasi); typegen, typecheck, lint exit 0. Gerbang penuh belum diulang sesudah perbaikan; akan dijalankan sesudah putaran ini.
- Yang sengaja ditunda atau ditolak tercatat di `deferred-items.md` dan tabel disposisi (antara lain CSP seluruh aplikasi, `scopedDb` untuk operasi tertentu, kunci unik `member` sebagai butir owner 12.2-o4, audit untuk panggilan gagal K49, outbox K50).

## Pertanyaan

Untuk setiap temuan: berkas dan baris, bukti, dampak, dan perbaikan konkret. Severity HIGH (artikel atau chunk lahir tanpa aksi admin, teks tiket memicu aksi atau bocor ke pihak luar atau organisasi lain, data salah atau hilang, deadlock, melanggar piagam), MEDIUM, atau LOW.

1. Gerbang manusia dan injeksi: apakah ada jalur dari teks tiket ke aksi, ke publikasi, ke permintaan jaringan pihak luar (gambar, tautan, apa pun yang dimuat browser atau server), atau ke organisasi lain, sesudah perbaikan K54 dan K57?
2. Tenancy dan otorisasi: setiap action, loader, dan job; kunci `FOR SHARE` baris member; `unstable_rethrow`; modul baru `article-reads.ts`.
3. Konkurensi dan job: urutan lock member, usulan, artikel; epoch, lease, dan retry pg-boss (`retryDelay` di `proposal-queue.ts`); job embed dengan kunci artikel, cek teks dan model; migrasi pagar baris final.
4. Lapisan LLM: tenggat per panggilan dan default Ollama 120 detik (K55) terhadap triage dan draf balasan yang sudah ada; `num_ctx`; klasifikasi error menurut kelas; apakah perubahan `complete()` mengubah perilaku jalur AI lama.
5. Test yang tidak bisa gagal atau lolos karena timing, dan test yang bergantung pada data spec lain.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah fase siap ke gerbang dan verifier. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.200 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
