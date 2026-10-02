Rekomendasi utama saya: **simpan usulan dalam tabel terpisah, lalu buat artikel KB hanya melalui aksi terbit eksplisit oleh admin**. Ini mengubah rekomendasi awal saya di area 7: setelah membaca jalur KB yang ada, pemisahan tersebut memberi batas yang lebih mudah dibuktikan daripada menambahkan status draft ke `KbArticle`.

Label **terverifikasi di kode** berarti fakta yang menjadi dasar rekomendasi sudah saya baca; rancangan dan hasil pengujiannya sendiri belum terverifikasi.

### 1. Model data dan isolasi draft

**Rekomendasi:** Buat `KbProposal` dengan status `GENERATING`, `DRAFT`, `REJECTED`, `PUBLISHED`, dan `FAILED`; simpan versi, aktor, waktu, serta relasi banyak-ke-banyak ke tiket sumber. Terapkan batas organisasi pada proposal, setiap relasi, dan artikel hasilnya, termasuk constraint database jika memungkinkan. Saat terbit, transaksi yang sama harus mengubah proposal menjadi `PUBLISHED` dan membuat tepat satu `KbArticle` yang mengacu balik ke proposal.

Proposal tidak punya `KbChunk`, tidak masuk daftar artikel, pencarian RAG, Insight, atau re-embed. Hanya artikel hasil penerbitan yang diantrekan untuk embedding. Artikel lama tetap berlaku tanpa migrasi status.

**Alasan:** [create-article.ts](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/src/lib/kb/create-article.ts) langsung menyimpan artikel dan mengantre embedding. Pencarian [RAG](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/src/lib/rag/retrieve.ts) dan [Insight](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/src/lib/insight/kb-gap.ts) membaca chunk tanpa filter status publikasi. Tabel terpisah menghindari keharusan memodifikasi semua jalur itu untuk mengecualikan draft.

**Risiko:** Penerbitan dan pengantrean embedding saat ini terpisah; kegagalan antrean setelah commit tidak boleh menghasilkan artikel ganda ketika admin mencoba lagi. Perlu mekanisme pengantrean yang dapat dipulihkan. Jangan mengasumsikan halaman publik KB sudah ada hanya karena requirement melarang publikasi tanpa review.

**Keputusan owner:** model ini pilihan implementasi; kebijakan penggunaan konten pelanggan untuk KB tetap milik owner.  
**Status:** terverifikasi di kode untuk alur artikel dan pembaca chunk; rancangan baru belum terverifikasi.

### 2. Pemicu dan pilihan tiket

**Rekomendasi:** Koreksi rekomendasi lama saya yang mengizinkan agent memicu: mulai dengan **owner/admin yang aktif memilih 1–5 tiket secara manual**. Server memvalidasi seluruh pilihan dalam organisasi yang sama, tanpa diam-diam membuang tiket yang tidak sah. Terima group `RESOLVED` dan `CLOSED`, bukan nama state; tolak tiket sumber hasil merge dan arahkan pengguna ke tiket tujuan. Tidak ada generasi otomatis.

Periksa status ketika permintaan dibuat **dan sebelum teks diambil untuk generasi**. Jika tiket dibuka kembali atau digabung sebelum generasi, gagalkan dengan alasan yang dapat ditindaklanjuti. Simpan penanda versi atau snapshot sumber agar reviewer tahu apabila sumber berubah setelah generasi; perubahan sumber tidak otomatis menerbitkan atau menulis ulang draft.

**Alasan:** `CLOSED` mencakup pekerjaan yang sebelumnya selesai dan kemudian ditutup. Pilihan manual membatasi biaya serta risiko mengirim data yang tidak diharapkan. Batas lima adalah usulan operasional, bukan tuntutan AIDA-18.

**Risiko:** Tiket tujuan merge dapat memuat pesan dari beberapa sumber; provenance dan kelayakan kontennya harus terlihat bagi reviewer. Pemeriksaan awal saja tidak mengatasi perubahan konkuren.

**Keputusan owner:** apakah `CLOSED` dan batas lima sesuai maksud produk; kebijakan internal note dan konten pelanggan.  
**Status:** group dan `mergedIntoTicketId` terverifikasi di [schema.prisma](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/prisma/schema.prisma); kebijakan pilihan dan penanganan race belum terverifikasi.

### 3. Generasi aman

**Rekomendasi:** Lewatkan prompt ke `complete()` dengan instruksi sistem terpisah dari blok teks tiket yang dipagari sebagai **data tak tepercaya**. Sertakan hanya subject dan pesan relevan yang dibatasi jumlah serta panjangnya; jangan otomatis mengirim lampiran. Default konservatif: pesan publik saja, dengan pemberitahuan jika pemotongan menghilangkan bagian thread. Validasi panjang judul/isi, struktur, dan ID sitasi terhadap himpunan tiket yang benar-benar dikirim; sitasi tampil sebagai tautan internal untuk reviewer, bukan detail pelanggan pada artikel terbit. Klaim yang tidak punya sumber tidak otomatis dianggap benar.

`complete()` meredaksi prompt, tetapi regex yang ada hanya mencakup pola tertentu dan **bukan anonimisasi PII**. Jangan menaruh teks tiket di parameter `system`, yang tidak melewati redaksi tersebut. Reviewer harus menghapus informasi pelanggan dan memeriksa fakta sebelum terbit. Render Markdown melalui jalur sanitasi yang ada.

Tambahkan jenis `AuditEvent` khusus generasi AI dengan provider/model aktual, input yang telah diredaksi, dan output sesuai kontrak audit yang ada. Catat tindakan manusia secara terpisah dengan aktor dan ID; jangan mengisi kolom AI dengan nilai palsu. Batasi akses audit dan jangan log prompt/output atau error provider mentah.

**Risiko:** Prompt fencing dan validasi bentuk bukan jaminan melawan instruksi jahat atau halusinasi. Audit yang menyimpan prompt/output tetap dapat menyimpan PII atau rahasia yang lolos redaksi; sifat append-only membuat retensi menjadi keputusan penting.

**Keputusan owner:** kebijakan retensi dan akses audit, serta izin penggunaan konten pelanggan; jangan menganggap redaksi regex menyelesaikan kebijakan itu.  
**Status:** alur `complete()` dan keterbatasan regex terverifikasi di [complete.ts](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/src/lib/llm/complete.ts), [redact.ts](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/src/lib/llm/redact.ts), dan D-07 Fase 11; perlindungan baru belum terverifikasi.

### 4. Gerbang manusia

**Rekomendasi:** Hanya owner/admin dengan membership aktif dapat membaca, mengedit, menolak, atau menerbitkan usulan. Review menampilkan isi, sumber, dan peringatan perubahan sumber. Tombol **Setujui dan terbitkan** adalah satu aksi eksplisit; menyimpan edit saja tidak menerbitkan.

Gunakan versi proposal dan update bersyarat dalam transaksi: dua admin yang mengedit atau menerbitkan versi sama tidak boleh saling menimpa atau membuat dua artikel. Yang kalah mendapat pesan konflik dan harus memuat ulang. Penolakan bersifat terminal, tetap tersimpan untuk audit, dan tidak dapat diterbitkan; generasi ulang membuat proposal baru.

**Risiko:** Penerbitan atas versi lama yang sedang ditinjau admin lain dapat melewatkan perubahan penting. Kegagalan embedding setelah terbit perlu terlihat dan dapat dicoba ulang tanpa menerbitkan ulang.

**Keputusan owner:** retensi proposal ditolak dan apakah perlu alasan penolakan wajib.  
**Status:** helper membership dan peran tepat `owner`/`admin` terverifikasi di [membership.ts](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/src/lib/membership.ts); mekanisme review belum terverifikasi.

### 5. Job dan worker

**Rekomendasi:** Gunakan pg-boss dengan proposal sebagai catatan status yang persisten. Periksa `aiEnabled` saat permintaan dan lagi tepat sebelum pemanggilan provider; saat mati, jangan mulai panggilan dan tampilkan status yang jelas. Panggilan yang sudah berjalan saat sakelar dimatikan tidak otomatis batal: definisikan itu secara eksplisit, dan jangan otomatis menerbitkan hasilnya.

Tetapkan batas waktu panggilan, misalnya 30 detik, untuk **semua** adapter; pada kode yang saya baca OpenAI dan Anthropic memilikinya, sedangkan batas Ollama belum terlihat. Retry terbatas hanya untuk kegagalan sementara, misalnya maksimal dua retry; kesalahan konfigurasi dan output tidak valid menjadi `FAILED` dengan opsi coba lagi manual. Gunakan ID proposal dan conditional claim untuk mencegah dua worker menyimpan dua hasil. Buat pengantrean dapat dipulihkan bila proses mati setelah penyimpanan proposal.

**Risiko:** Timeout tidak membuktikan provider berhenti memproses; retry bisa menyebabkan dua panggilan berbayar walaupun hanya satu hasil disimpan. Batasi klaim idempotensi pada penyimpanan, kecuali provider benar-benar mendukung kunci idempotensi.

**Keputusan owner:** batas biaya dan jumlah retry bila berdampak pada operasional.  
**Status:** pola worker dan pengecekan ulang AI terverifikasi di [ai-triage.ts](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/src/lib/worker/jobs/ai-triage.ts); timeout menyeluruh dan pemulihan antrean belum terverifikasi.

### 6–7. Urutan dan hal yang mudah terlewat

**Rekomendasi:** Bekukan dahulu definisi tiket selesai, sumber yang boleh dikirim, batas input, retensi, dan semantik sakelar AI. Lalu rencanakan berurutan:

1. Skema proposal, tenancy, transisi, dan perlindungan konkurensi.
2. Seleksi sumber, prompt, validasi, audit, worker, serta pemulihan antrean.
3. Review/edit/terbit/tolak dan UI mengikuti [DESIGN-SYSTEM.md](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.7P10Ckmg16/.planning/DESIGN-SYSTEM.md).
4. Bukti lintas alur: isolasi organisasi sungguhan, race dua admin dan perubahan tiket, draft tak masuk RAG/Insight, AI mati, kegagalan provider, serta pemulihan enqueue. Test provider memakai **fake**, tanpa API LLM berbayar sungguhan.

Perhatian tambahan: slug artikel dapat bertabrakan saat penerbitan bersamaan; tangani constraint database dan retry secara aman. Tinjau juga akses langsung lewat URL dan server action, bukan hanya penyembunyian tombol. Cek tampilan mobile, dark mode, keyboard, dan pembaca layar tetap memerlukan bukti sesuai design system.

**Keputusan owner:** kebijakan dan batas yang disebut di atas; urutan plan dapat diputuskan pelaksana selama seluruh acceptance tetap utuh.  
**Status:** risiko slug dan kebutuhan fake terverifikasi di kode/piagam; kecukupan rencana dan bukti belum terverifikasi.