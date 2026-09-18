Rekomendasi utama saya: **pecah pengerjaan menjadi tiga bagian, pertahankan seluruh acceptance, dan perlakukan keamanan link merge sebagai masalah provenance per link—bahkan ketika kedua tiket berasal dari kontak yang sama.** Pembatasan kontak saja mencegah kebocoran antar-kontak, tetapi belum tentu memenuhi kalimat yang membatasi apa yang sebelumnya terlihat pada *masing-masing link*.

Label **terverifikasi di kode** di bawah berarti dasar faktanya saya periksa; usulan perilaku dan hasil pengujiannya belum terverifikasi.

### 1. Pemecahan fase

**Rekomendasi:** Pecah secara berurutan: **12a relasi, merge, snooze, feed; 12b status kustom dan jeda SLA dalam satu rangkaian migrasi; 12c usulan KB**. Buat sedikit plan per bagian, tambah hanya bila batas tiga tugas atau bukti mengharuskan. Jangan menandai Fase 12 selesai sampai kedelapan requirement dan enam kriteria terbukti.

**Alasan:** Status dan jeda SLA saling bergantung; memisahkannya menjadi perubahan deploy yang berdiri sendiri berisiko meninggalkan perilaku `pending` yang tidak konsisten. KB relatif mandiri. Piagam membolehkan fase dipecah tanpa membuang isi.

**Risiko:** Merge tetap besar untuk 12a; pemecahan administratif tidak mengurangi kebutuhan bukti lintas bagian. **Owner:** perubahan cakupan atau teks requirement milik owner; pemecahan kerja tanpa pengurangan cakupan diizinkan piagam.  
**Status:** terverifikasi di dokumen; kelayakan ukuran plan belum terverifikasi.

### 2. Merge — AIDA-53

**Rekomendasi:** Pada versi pertama, **tolak merge beda `contactId`**, dengan validasi server di bawah lock kedua tiket dalam urutan ID. Tetapi tetap pertahankan asal pesan dan batas visibilitas per token: link sumber dan target masing-masing hanya menampilkan pesan yang sebelumnya bisa diakses link itu, ditambah balasan baru yang secara eksplisit ditujukan kepadanya. Jangan redirect token sumber secara buta ke token target.

Satu transaksi memeriksa organisasi, kontak, sumber/target valid dan belum merged; memindahkan pesan beserta keterkaitan lampiran; menutup sumber sebagai duplicate; menyimpan alias/provenance; dan mencatat audit. Tentukan penanganan merge berantai, balasan email ke thread lama, follow-up, dan CSAT pada sumber maupun target. Konfirmasi UI tidak menggantikan validasi server.

**Alasan:** Saat ini halaman publik mengambil semua pesan `PUBLIC` tiket, route lampiran memeriksa tiket dan `PUBLIC`, sedangkan CSAT hanya satu per tiket. Setelah pesan dipindah, mengalihkan dua token ke target tanpa pembatasan akan memperluas akses. Penolakan beda kontak adalah fallback yang diterima, tetapi saya tidak menganggapnya izin untuk mengabaikan batas per-link yang tertulis.

**Risiko:** Provenance dan penerima balasan baru menambah kompleksitas; `authorContactId` saja tidak membuktikan kepada siapa balasan agen ditujukan. Merge bersamaan dengan reply atau merge lain perlu forced-order test, termasuk dua kontak yang ditolak dan dua token kontak sama dengan riwayat berbeda. Jangan hilangkan atau timpa CSAT tanpa keputusan perilaku yang eksplisit.

**Audit — keputusan owner:** D-07 mengunci `AuditEvent` untuk AI, sementara AIDA-53 secara literal meminta `AuditEvent`. Saya menyarankan **jangan mengisi kolom AI palsu**; catat peristiwa merge lengkap pada `TicketAuditEvent` dalam transaksi, tetapi **jangan klaim acceptance literal terpenuhi** tanpa keputusan owner tentang perubahan teks requirement atau penyelesaian lain yang kompatibel dengan D-07. Audit memuat ID sumber/target, aktor, waktu, dan perubahan relevan, bukan isi tiket.  
**Status:** terverifikasi di kode dan dokumen; rancangan provenance belum terverifikasi.

### 3. Relasi dan feed — AIDA-52, AIDA-55

**Rekomendasi:** Dukung `duplicate_of`, `related_to`, dan `child_of`; tampilkan label kebalikan dari sisi lain. Terapkan **satu relasi per pasangan tak berurutan**, sehingga `A related B` dan `B related A` tidak bisa ganda atau sekaligus bertentangan dengan tipe lain. Larang self-link dan lintas organisasi; `child_of` mempunyai arah, maksimal satu parent per child, dan tidak boleh membentuk siklus. Hubungan duplicate hasil merge dibuat otomatis dan tidak boleh dihapus hingga merusak jejak merge.

Feed agen membaca `TicketAuditEvent` dan pesan sebagai dua sumber, digabung menurut `(createdAt, jenis, id)` untuk urutan stabil; sertakan merge, snooze/bangun, relasi, state, dan assignment. Audit relasi harus terlihat pada kedua tiket tanpa membocorkan data organisasi lain.

**Alasan:** Constraint pasangan kanonis menutup duplikasi konkuren; satu parent dan larangan siklus membuat hierarki dapat dijelaskan.

**Risiko:** Cek siklus dengan read biasa dapat lolos pada penulisan paralel; serialisasi perubahan hierarki per organisasi atau mekanisme DB yang setara harus dibuktikan, bukan hanya pre-check. Batas satu parent adalah pilihan desain teknis saya, bukan bunyi eksplisit acceptance. **Owner:** jika batas itu dianggap mengurangi cakupan produk yang dimaksud, keputusan milik owner.  
**Status:** jenis dan acceptance terverifikasi di dokumen; kemampuan implementasi konkuren belum terverifikasi.

### 4. Snooze — AIDA-54

**Rekomendasi:** Gunakan `snoozedUntil` nullable sebagai atribut terpisah dari state. Job pg-boss berkala memilih yang jatuh tempo dan melakukan update bersyarat; kedua jalur reply pelanggan membangunkan dalam transaksi dan lock tiket yang sama dengan D-17. Auto-generated email tidak membangunkan. Auto-close memeriksa `snoozedUntil IS NULL` **pada update final**, bukan hanya saat memilih kandidat. Sediakan filter eksplisit snoozed dan aksi bangunkan manual.

**Alasan:** Snooze ortogonal terhadap workflow dan tidak perlu status khusus. Job berkala yang idempoten pulih setelah worker restart.

**Risiko:** Job lama tidak boleh membatalkan snooze yang baru diperpanjang; update harus memeriksa deadline terkini. Uji kedua urutan race reply/job, snooze ulang/job dan snooze/auto-close. Jelaskan zona waktu input dan tampilan. **Owner:** tidak ada perubahan cakupan yang saya usulkan.  
**Status:** D-17 dan mekanisme auto-close terverifikasi di kode/dokumen; implementasi snooze belum ada.

### 5. Status kustom — AIDA-56, AIDA-97

**Rekomendasi:** Buat state per organisasi dengan ID stabil dan group tetap `open`, `pending`, `resolved`, `closed`. Migrasikan **lima nilai lama menjadi lima state terpisah**: `NEW` dan `OPEN` sama-sama group `open` tetapi tidak dilebur. Tambahkan default global per organisasi dan state tujuan yang jelas untuk transisi otomatis ke group `open` dan `closed`; jangan memilih state pertama berdasarkan urutan tampilan. Group sebuah state sebaiknya tetap setelah dibuat.

Migrasi data dan pembaca sebagai satu perubahan yang koheren: raw SQL SLA, auto-close, reopen, triage, filter, chip, pencarian, CSAT, halaman publik, fixture, dan Insight yang relevan. Saved view `version: 1` dipetakan per organisasi ke **ID state lama yang sesuai**, lalu menjadi `version: 2`; jangan memetakan `NEW` ke seluruh group open. Tetapkan pula kompatibilitas URL filter lama.

Hapus state hanya setelah reassignment tiket dalam transaksi; pertahankan referensi audit historis. Saved view yang mereferensikan state terhapus harus tetap terlihat dan menampilkan referensi hilang sesuai D-05, bukan diam-diam memperluas hasil. Default tidak boleh dihapus tanpa pengganti.

**Alasan:** Menyatukan `NEW` dan `OPEN` akan kehilangan makna data serta mengubah saved view. Insight yang saya periksa membaca `resolvedAt` dan flag SLA; acceptance tetap menuntut pengujian perilakunya.

**Risiko:** Reassignment lintas group harus menjalankan semua efek status dan SLA; penggantian state bersamaan dengan tiket masuk harus diserialkan. Migrasi harus menguji organisasi kosong maupun berisi data, filter yang rusak/tidak dikenal tanpa kehilangan diam-diam, dan mempertahankan indeks serta CHECK migrasi sebelumnya. UI warna state perlu tetap terbaca pada light/dark dan tidak mengandalkan warna saja. **Owner:** keputusan yang mengubah requirement milik owner; detail default teknis dapat diputuskan dalam batasnya.  
**Status:** enum, lima nilai, saved-view v1, dan efek mutasi terverifikasi di kode; daftar seluruh pembaca perlu diaudit ulang saat planning.

### 6. Jeda SLA — AIDA-57

**Rekomendasi:** Jeda hanya saat group `pending`. Simpan `pauseStartedAt` dan akumulasi durasi untuk perhitungan ulang; pada transisi keluar pending, di bawah lock, tambahkan tepat durasi jeda ke kedua due timestamp dan akumulasi, lalu kosongkan awal jeda. Perpindahan antar-state pending tidak memulai ulang interval. Worker mengecualikan pending dalam SQL dan perubahan state/jeda atomik dengan update tiket.

Untuk tiket yang sudah `PENDING` saat migrasi, gunakan **waktu migrasi** sebagai awal jeda tanpa mengubah deadline saat itu. Setelah restart, waktu awal tetap tersimpan di DB.

**Alasan:** Model ini tidak memerlukan job untuk memulai atau mengakhiri jeda dan memungkinkan deadline bergeser tepat sekali per interval. Akumulasi juga diperlukan karena perubahan prioritas kini menghitung ulang deadline dari `createdAt`.

**Risiko:** Definisikan perilaku ketika prioritas atau kebijakan SLA berubah selama jeda, serta ketika first response terjadi saat pending: hitung ulang dengan durasi jeda historis dan interval aktif secara konsisten, tanpa menggeser dua kali. Pertahankan semantik flag yang sudah terpasang; “tidak menaikkan flag saat pending” tidak otomatis berarti menghapus breach sebelumnya. Uji worker nyata terhadap transisi konkuren, beberapa jeda, restart, migrasi, dan perubahan prioritas. **Owner:** tidak ada perubahan requirement yang saya usulkan.  
**Status:** penghitungan wall-clock, reset prioritas, dan worker terverifikasi di kode; model akuntansi di atas belum terverifikasi.

### 7. Usulan KB — AIDA-18

**Rekomendasi:** Agent memilih satu atau lebih tiket resolved dalam organisasi dan meminta proposal; server memeriksa membership aktif dan provider AI. Simpan proposal sebagai draft yang hanya dapat dilihat/diedit oleh pihak berwenang. Admin secara eksplisit menyetujui dan menerbitkan; artikel lama dimigrasikan sebagai published. Jalur listing, retrieval, embedding, re-embed, dan job yang sudah antre harus mengecualikan draft.

Kirim teks tiket melalui `src/lib/llm/complete.ts`, batasi ukuran input, pagar sebagai data tak tepercaya, validasi output, dan tampilkan sumber tiket kepada reviewer. Human review harus mencakup penghapusan informasi pelanggan dan pemeriksaan fakta; redaksi secret bukan anonimisasi menyeluruh.

**Alasan:** `createKbArticle` saat ini langsung menyimpan lalu mengantre embedding, sehingga sekadar menyembunyikan draft di UI tidak cukup.

**Risiko:** Fencing mengurangi risiko prompt injection, bukan jaminan model mematuhi instruksi. Periksa race publish/embedding dan upaya publish oleh non-admin; uji AI mati dan provider palsu tanpa egress nyata. **Owner:** pilihan apakah penggunaan konten pelanggan untuk KB membutuhkan kebijakan atau persetujuan tambahan, bila mengubah cakupan/kebijakan proyek, milik owner.  
**Status:** jalur KB, redaksi prompt, dan ketiadaan draft terverifikasi di kode; perlindungan menyeluruh belum terverifikasi.

### 8. Yang mudah terlewat

**Rekomendasi:** Buat matriks transisi dan forced-order test untuk **merge, reply, auto-close, snooze, state, dan SLA**; sertakan penulisan audit pada transaksi yang sama. Jalur server baru memeriksa `findActiveMembership`; jalur lama yang belum diperbaiki tetap AIDA-43 terbuka. Pertahankan O-1: tidak ada test stack compose; E2E menyatakan hasil yang terlihat. Review UI mengikuti design system dan visual pass manusia tetap item manual.

**Risiko:** Enam fitur yang masing-masing benar dapat tetap salah saat berjalan bersamaan. Khusus merge, ticket ID dalam email threading, lampiran, CSAT, dan token lama harus diuji sebagai satu kontrak; jangan menyimpulkan aman hanya dari halaman status.  
**Status:** batas membership, audit, dan O-1 terverifikasi di konteks Fase 11; cakupan race lengkap belum terverifikasi.