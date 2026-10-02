# Fase 12.2 Usulan artikel KB dari tiket yang selesai: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

Konteks: Fase 12.2 di `.planning/ROADMAP.md` (satu kriteria sukses), AIDA-18 di `.planning/REQUIREMENTS.md` (generasi lewat `src/lib/llm/`, mati bila AI mati, meredaksi rahasia, teks tiket sebagai input tak tepercaya, tidak ada yang tayang tanpa aksi admin). Kamu sudah memberi rekomendasi untuk area ini di `.planning/run-loop/codex/fase12-jawab.md` area 7. Fase 12 dan 12.1 sudah dieksekusi (status kini tabel `TicketState` dengan group; lihat `.planning/phases/12.1-ticket-lifecycle-custom-states-and-sla-pause/12.1-CONTEXT.md`). Batas mengikat: `.planning/run-loop/PIAGAM.md` (tidak boleh memanggil API LLM berbayar sungguhan di test; test memakai fake). UI mengikuti `.planning/DESIGN-SYSTEM.md`. Hasilnya menjadi `12.2-CONTEXT.md`.

## Area abu-abu

Untuk setiap area: rekomendasi, alasan, risiko, status `terverifikasi di kode` atau `belum terverifikasi`; tandai keputusan milik owner.

1. **Model data:** status draft pada `KbArticle` (`prisma/schema.prisma`, model `KbArticle`) atau tabel usulan terpisah; hubungan ke tiket sumber; apa yang terjadi pada embedding dan pencarian KB untuk draft (draft tidak boleh dipakai jawaban AI atau tampil publik).
2. **Pemicu dan pilihan tiket:** siapa memicu (admin memilih tiket yang selesai, atau usulan otomatis), group mana yang sah sebagai "selesai" (RESOLVED/CLOSED), batas jumlah tiket, dan tenancy.
3. **Generasi aman:** jalur `src/lib/llm/` yang ada (redaksi di `complete.ts`), teks tiket sebagai data tak tepercaya (pemisahan instruksi, keluaran yang divalidasi), sitasi ke tiket sumber, catatan audit AI (`AuditEvent` khusus AI, Fase 11 D-07), dan perilaku saat AI mati atau provider gagal.
4. **Gerbang manusia:** review, edit, setujui, tolak; tidak ada yang tayang tanpa aksi admin; konkurensi dua admin; apa yang terjadi pada draft yang ditolak.
5. **Job dan worker:** generasi sinkron atau lewat pg-boss; batas waktu; retry; idempotensi.
6. **Pemecahan plan dan urutan**, dan apa yang perlu dibekukan dulu.
7. **Yang saya lewatkan.**

## Format jawaban

Bahasa Indonesia. Paling banyak sekitar 1.300 kata. Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
