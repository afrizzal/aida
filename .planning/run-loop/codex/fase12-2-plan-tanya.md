# Fase 12.2 Usulan artikel KB dari tiket yang selesai: review plan (siklus 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

12 plan di `.planning/phases/12.2-ticket-lifecycle-knowledge-from-resolved-work/12.2-01-PLAN.md` sampai `12.2-12-PLAN.md` (6 wave) untuk AIDA-18. Keputusan mengikat: `12.2-CONTEXT.md` (D-01 sampai D-17, keputusan run K48, butir owner), dari brainstorm denganmu di `.planning/run-loop/codex/fase12-2-jawab.md`. Kontrak UI: `12.2-UI-SPEC.md` (disetujui). Peta pola: `12.2-PATTERNS.md` (temuan C1 sampai C8). Batas run: `.planning/run-loop/PIAGAM.md`.

## Fakta yang sudah saya verifikasi

- Wave: 1: 01, 02, 03; 2: 04, 05, 06; 3: 07, 08; 4: 09, 10; 5: 11; 6: 12. Orkestrator mengeksekusi plan satu per satu di checkout utama.
- Plan checker GSD putaran 1 (dua irisan) menemukan 3 blocker di plan 11 dan 4 warning; semuanya dicek ke kode dan diperbaiki di `34b4042`: stub LLM E2E (`tests/e2e/support/llm-stub.ts`) mendapat mode chat 404 dan isi bukan JSON, rekaman isi request chat, dan `holdChat()` agar status Generating terlihat pasti; `afterClaim` di plan 07 berjalan di dalam transaksi klaim yang belum commit (ditambah `beforeClaim`); snapshot sumber di plan 04 adalah seq PUBLIC terbesar sungguhan milik tiket, bukan seq terbesar yang dibaca; seam observer di simpan dan tolak (plan 05); batas pemotongan plan 02 dibuat bisa dipenuhi. Pemeriksaan ulang checker (iterasi 2) menyatakan ketujuhnya tertutup, tanpa blocker, dengan 2 warning pada butir berikutnya.
- CONTEXT D-01 dikoreksi (`97d2e4b`): aksi KB lama `src/app/(app)/kb/actions.ts` memakai `requireOrgAdmin()` yang melempar error, bukan "tanpa cek peran". Plan baru memakai `getSessionActor` lalu `findActiveMembership` dan `isAdminRole` dengan kode penolakan bertipe.
- Dua warning yang diketahui dan belum masuk plan (akan diperbaiki bersama temuanmu di replan): `snapshotSeq Int?` di plan 01 (sekitar baris 104) dan `number | null` di plan 04, sedangkan `Message.seq` adalah `BigInt @default(autoincrement())` (`prisma/schema.prisma:345`), satu sequence untuk seluruh database; dan plan 01 masih mendefinisikan `snapshotSeq` sebagai "seq terbesar yang dibaca", berbeda dari plan 04 dan 07. Tidak perlu melaporkannya lagi kecuali ada akibat lain.
- Test tidak boleh memanggil API LLM sungguhan; integrasi memakai adapter tiruan, E2E memakai stub protokol Ollama di 127.0.0.1. Test egress dan stack compose blocked (owner O-1).

## Pertanyaan

Untuk setiap temuan: plan dan task, bukti (berkas dan baris), dampak, dan perbaikan konkret. Severity HIGH (acceptance gagal, melanggar piagam, celah keamanan atau tenancy, sesuatu tayang tanpa aksi admin, teks tiket bisa memicu aksi atau bocor), MEDIUM, atau LOW.

1. **Kontradiksi internal.** Tiga fase sebelumnya diparkir karena kelas ini: acceptance atau grep yang menunjuk berkas lain dari tempat aksi menaruh kodenya; test atau E2E yang mengharapkan hasil yang bertentangan dengan plan lain atau dengan UI-SPEC; helper test yang tidak bisa mengamati perilaku PostgreSQL sebenarnya; verifikasi yang menjalankan kode yang baru dibangun plan sesudahnya.
2. **Gerbang manusia dan mesin status.** Apakah benar-benar mustahil sebuah `KbArticle` atau `KbChunk` lahir dari usulan tanpa aksi "Approve and publish" admin aktif (trigger pagar status, CHECK, transaksi publish, retry slug)? Apakah usulan tidak pernah mencapai RAG, Insight, halaman publik, atau embedding sebelum terbit? Apakah konflik versi dan race (dua publish, publish lawan tolak, dua simpan, dua job) terbukti dengan test yang terikat PID, tanpa sleep?
3. **Generasi aman.** Teks tiket hanya di `prompt`, terpagar sebagai data tak tepercaya; hanya pesan PUBLIC; batas input dan penanda pemotongan; validasi keluaran (penanda sitasi, gema pagar, sitasi di luar T1 sampai T5); redaksi lewat `complete()`; satu `AuditEvent` per generasi; AI mati; kegagalan provider bertipe (timeout Ollama lewat fetch kustom, 404, bukan JSON) tanpa teks mentah provider di UI; tiket yang berubah setelah generasi (D-08). Adakah jalur prompt injection yang bisa memicu aksi, menerbitkan, atau membocorkan data organisasi lain?
4. **Job dan worker.** Klaim dengan lease 10 menit, pemeriksaan ulang kelayakan sebelum membaca teks, restart, job ganda, idempotensi, dan tidak ada transaksi terbuka saat `complete()`. Adakah jendela di mana usulan macet selamanya, atau provider dipanggil dua kali untuk satu generasi?
5. **Migrasi dan skema (plan 01).** Indeks unik baru `(organizationId, id)` pada `Ticket` dan `KbArticle`, FK komposit, nilai enum baru `AuditActionType` (`ADD VALUE` terisolasi), objek tulisan tangan lama tetap ada, `migrate dev --create-only` di database terpisah dalam `aida-dev-db`. Termasuk soal `snapshotSeq Int?` di atas.
6. **Pelanggaran piagam.** Checkpoint manusia, scope dibuang, `prisma db push`, `.env`, `rm -rf` (menghapus `.next/` adalah butir owner yang terbuka), egress baru, container selain `aida` dan `aida-dev-db`, email nyata, panggilan LLM sungguhan, nama orang atau path rumah, klaim lulus untuk hasil merah, atau penilaian visual rekaan.

## Format jawaban

Bahasa Indonesia. Daftar temuan dari yang paling berat, lalu satu paragraf: apakah plan siap dieksekusi. Tandai setiap klaim `terverifikasi di plan/kode` atau `belum terverifikasi`. Paling banyak sekitar 1.500 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
