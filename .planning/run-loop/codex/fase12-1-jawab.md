Rekomendasi utama saya: gunakan `stateId` sebagai sumber kebenaran, pertahankan group state tetap, dan perlakukan migrasi state serta jeda SLA sebagai satu perubahan deploy. Saya juga perlu mengoreksi rekomendasi sebelumnya: **aturan untuk timer yang sudah selesai harus dibekukan secara eksplisit**; akumulasi jeda tunggal hanya cukup bila kedua tenggat memang terus digeser dengan aturan yang sama.

### 1. Model data dan integritas

**Rekomendasi.** Simpan `Ticket.stateId` saja; baca group melalui `TicketState`. Worker dapat memakai `UPDATE ... WHERE EXISTS` dengan relasi state dan organisasi. Jadikan group sebuah state tidak dapat diubah. Gunakan FK komposit `(organizationId, stateId)` ke pasangan unik pada `TicketState`, dengan keduanya `NOT NULL` dan penghapusan dibatasi. Ini menegakkan kepemilikan organisasi di database, termasuk untuk SQL mentah.

Jika pengukuran kemudian membuktikan denormalisasi diperlukan, dua FK `(stateId, group)` dan `(stateId, organizationId)` **dapat** mencegah drift dan lintas organisasi bila kolomnya non-null, pasangan tujuan unik, dan aksi update/delete tidak membuka celah. Satu FK tiga kolom `(organizationId, stateId, group)` lebih mudah diaudit. Ini menambah sinkronisasi dan constraint tanpa kebutuhan kinerja yang sudah terbukti.

Simpan konfigurasi per organisasi dengan referensi FK untuk peran `new`, `reopen`, `autoClose`, `mergeClose`, dan `resolve`. Migrasi awal: `NEW`, `OPEN`, `CLOSED`, `CLOSED`, `RESOLVED`. Beberapa peran boleh menunjuk state yang sama. Batasi `new` dan `reopen` ke group `open`, `resolve` ke `resolved`, dan kedua tujuan close ke `closed`; pastikan selalu ada tepat satu konfigurasi lengkap. Inisialisasi juga saat organisasi baru dibuat.

**Alasan.** Kode perlu group untuk keputusan semantik dan ID tertentu untuk tujuan otomatis. Default baru dan tujuan reopen tidak harus sama.

**Risiko.** FK tenant saja tidak menjamin group peran benar atau konfigurasi selalu tersedia; ini perlu constraint dan/atau transaksi yang diuji. **Owner:** pembatasan default ke group `open` adalah pilihan perilaku; jika dianggap mengurangi cakupan AIDA-97, parkir untuk owner.

**Status:** model dan pembaca saat ini **terverifikasi di kode**; rancangan constraint dan seluruh jalur pembuatan organisasi **belum terverifikasi**.

### 2. Migrasi data

**Rekomendasi.** Dalam migrasi atomik dan dengan penulis aplikasi/worker lama dihentikan:

1. Buat tabel state dan konfigurasi; isi **lima state per setiap organisasi**, termasuk organisasi tanpa tiket.
2. Tambahkan `stateId` dan kolom jeda nullable; petakan setiap enum per organisasi tanpa melebur `NEW` dan `OPEN`. Untuk `PENDING`, tetapkan satu waktu migrasi yang konsisten sebagai awal jeda, tanpa mengubah tenggat.
3. Konversi setiap saved view valid v1 ke v2 dengan ID yang tepat dan pertahankan seluruh filter lain. Untuk nilai tidak dikenal atau JSON rusak, **gagalkan migrasi dengan diagnostik**; jangan membuang nilai atau memperluas hasil.
4. Verifikasi kelengkapan, pasang `NOT NULL`, FK dan constraint; baru hapus kolom status serta enum setelah semua dependensi hilang. Jangan membangkitkan ulang migrasi lama atau menghapus indeks, CHECK, trigger dan `searchVector` buatan tangan.

URL lama perlu parser kompatibilitas: nilai enum valid dipetakan ke state migrasi yang sesuai pada organisasi aktif. Pertahankan identitas pemetaan lama secara stabil meski state diganti nama; bila state itu dihapus, tampilkan filter hilang, bukan semua tiket. URL baru memakai ID. Definisikan perilaku campuran URL lama/baru dan nilai tak dikenal secara fail-closed.

Bukti Testcontainers: jalankan migrasi penuh sampai tepat sebelum fase ini, isi beberapa organisasi—termasuk kosong—tiket tiap enum, view pribadi/shared dan audit; jalankan migrasi baru, bandingkan isi dan jumlah per organisasi, tenggat, flag, JSON lain dan riwayat; cek constraint lama, penolakan lintas organisasi, rollback pada data rusak, serta fresh install.

**Risiko.** Migrasi gagal pada data rusak membutuhkan perbaikan data sebelum deploy; konversi JSON tidak boleh diam-diam melewati record. Deploy campuran kode lama/baru tidak aman.

**Owner:** tidak ada, selama preservasi data dan cakupan requirement dipertahankan.  
**Status:** struktur v1 dan lima enum **terverifikasi di kode/dokumen**; SQL migrasi, isi data nyata, dan strategi URL **belum terverifikasi**.

### 3. Pembaca status

**Rekomendasi.** Bekukan matriks ini dan uji setiap baris:

| Pembaca | Dasar keputusan |
|---|---|
| Buat tiket | Peran `new`; mulai jeda bila pilihan default pending diperbolehkan |
| Balasan pelanggan | Group `resolved/closed` → peran `reopen`; bangunkan snooze sesuai aturan sekarang |
| Auto-close | Kandidat group `resolved`, masih memeriksa `resolvedAt` dan snooze; tujuan `autoClose` |
| Merge | Tujuan `mergeClose`; tutup jeda sumber, pertahankan isolasi status link |
| Snooze/wake | Tolak snooze group `closed`; wake hanya mengubah snooze, bukan state |
| Mutasi tunggal/massal | State ID yang dipilih, divalidasi tenant; efek lifecycle berdasarkan perubahan group |
| Worker SLA | Group `open` dan timer aktif; `pending`, `resolved`, `closed` tidak dinaikkan |
| CSAT dan tampilan publik | Group `resolved/closed` menentukan kelayakan; tampilkan **label group publik tetap**, bukan nama state internal |
| Filter, chip, palette | Filter state memakai ID; chip agen memakai nama state; periksa juga filter berbasis group dan perintah palette |
| Triage AI dan fixture demo | Triage tidak boleh menyimpulkan identitas state dari enum; fixture memetakan lima identitas awal dan menjaga invariant SLA |
| Feed dan audit | Render enum lama dari tabel copy; event baru memakai ID, dengan strategi state terhapus pada area 4 |
| Insight | Pertahankan semantik `resolvedAt` dan flag; uji hasil agregasi sebelum/sesudah migrasi |

**Risiko.** Pindah antar-state dalam group terminal jangan otomatis menimpa `resolvedAt`: itu menggeser jadwal auto-close dan metrik. Pindah antar-state open juga jangan dianggap reopen. Halaman sumber merge harus tetap menampilkan label netral “Combined”, tanpa membocorkan state target. Styling khusus `NEW` pada daftar juga perlu keputusan pengganti; group `open` tidak identik dengan `NEW`.

**Owner:** tampilan label group publik adalah rekomendasi privasi konservatif; perubahan kebijakan privasi atau cakupan produk milik owner.  
**Status:** jalur merge, reopen, mutasi, CSAT, halaman publik dan Insight **terverifikasi di kode**; audit menyeluruh semua pembaca dan perilaku triage **belum terverifikasi**.

### 4. Pengelolaan state

**Rekomendasi.** Gate admin/owner di server dengan membership aktif dan scope organisasi; validasi nama, ID, group, urutan, dan warna. Gunakan palet token tetap yang ditambahkan ke design system untuk light/dark, label teks selalu terlihat, serta uji kontras dan keyboard. Delapan token adalah contoh, bukan kewajiban.

Untuk hapus, serialkan perubahan konfigurasi state dan semua penulis tiket pada organisasi dengan protokol lock yang sama dan urutan lock tetap. Dalam satu transaksi: validasi pengganti, ganti peran yang menunjuk state itu, reassignment setiap tiket melalui efek transisi yang sama, tulis audit, lalu hapus. FK `RESTRICT` menjadi pagar terakhir, bukan satu-satunya mekanisme race. Tolak atau proses khusus sumber merge bila reassignment akan mengeluarkannya dari group `closed`.

Saved view tetap menyimpan ID terhapus dan menampilkan referensi hilang ala D-05; jangan otomatis menggantinya atau menghapus filter. Audit lama tetap memakai renderer enum. Untuk event baru, pilih ID dengan marker “state dihapus” setelah penghapusan; rename akan menampilkan nama terkini. Ini sesuai kontrak audit saat ini yang menyimpan ID dan enum, bukan nama bebas.

**Risiko.** Reassignment besar dalam satu transaksi dapat mengunci banyak tiket; ukur dan tetapkan batas yang tidak membuang acceptance. Audit ID tidak mempertahankan nama historis; jika itu diwajibkan, kontrak audit perlu dirancang ulang. Lock per organisasi harus dipatuhi semua jalur termasuk intake dan worker.

**Owner:** jika ada batas volume yang mengurangi kemampuan hapus, atau perubahan kontrak/persyaratan audit, keputusan milik owner.  
**Status:** kontrak audit append-only dan D-05 **terverifikasi di kode/dokumen**; protokol konkurensi **belum terverifikasi**.

### 5. Jeda SLA

**Rekomendasi.** Simpan `pauseStartedAt` dan akumulasi durasi jeda dalam satuan presisi yang aman. Setiap transisi memperoleh lock tiket **sebelum mengambil waktu efektif**. Saat masuk pending, mulai jeda; pending ke pending tidak mengubahnya. Saat keluar, `delta = waktu_keluar − pauseStartedAt`, tambahkan delta tepat sekali ke kedua due timestamp dan akumulasi, lalu kosongkan awal jeda secara atomik.

Karena acceptance menyebut **setiap due time** bergerak sebesar total jeda, saya memilih kedua tenggat tetap digeser sekalipun first response sudah terjadi. Konsekuensinya tenggat first response menjadi tenggat ter-normalisasi, bukan snapshot historis saat respons. Dengan aturan ini, prioritas baru menghitung `createdAt + target baru + akumulasi jeda yang sudah ditutup`; jeda aktif baru ditambahkan saat keluar. Jika tenggat yang selesai harus dibekukan sebagai fakta historis, perlu akumulasi per timer atau data ekuivalen dan penafsiran acceptance harus dipastikan—satu akumulasi tidak cukup.

First response saat pending tetap dicatat dan membersihkan flag sesuai jalur saat ini; interval pending tetap berlangsung. Perubahan kebijakan sendiri mengikuti snapshot target tiket saat ini; perubahan prioritas mengambil target terbaru dan menghitung ulang seperti di atas. Pertahankan flag yang sudah ada saat masuk pending; perubahan prioritas saat ini memang membersihkan flag, jadi tetapkan dan uji perilaku itu secara eksplisit.

Snooze **tidak** menjeda SLA secara mandiri; jika tiket juga pending, jeda berasal dari group pending. Merge sumber pending menutup interval sebelum menjadi closed. Setelah restart, `pauseStartedAt` tetap di DB. Migrasi memulai jeda pada waktu migrasi.

Worker nyata harus mengecualikan pending dalam **kedua** UPDATE dan memeriksa kondisi pada baris terkini setelah menunggu lock. Uji handler sebenarnya dengan injeksi jam terkontrol, bukan sleep: beberapa interval tepat, first response di tengah jeda, prioritas saat jeda, restart handler, merge, serta dua urutan race worker/transisi menggunakan dua koneksi. Uji juga batas `<` versus `=` dan tampilan SLA saat pending agar tenggat yang belum digeser tidak terlihat terus berjalan.

**Risiko.** Hasil agregasi flag saat prioritas berubah dan semantik tenggat setelah respons bisa mengejutkan; jangan mengklaim akuntansi terbukti sebelum uji lintas timer. Race pada join/UPDATE perlu dibuktikan terhadap PostgreSQL, bukan diasumsikan dari unit test.

**Owner:** bila semantik historis timer atau snooze dimaksudkan berbeda sehingga mengubah acceptance/cakupan, parkir keputusan itu.  
**Status:** rumus lama, dua UPDATE worker dan reset prioritas **terverifikasi di kode**; rumus baru dan pengujian race **belum terverifikasi**.

### 6. Pemecahan plan dan urutan

**Rekomendasi.** Bekukan lebih dulu matriks pembaca, peran, semantik kedua timer, kontrak URL/audit dan protokol lock. Targetkan **empat plan berurutan**:

1. Skema, migrasi data, konfigurasi peran dan bukti migrasi.
2. Transisi bersama, SLA, worker, merge/reply/auto-close dan uji konkurensi.
3. Seluruh pembaca, filter, saved view, publik, demo dan audit.
4. Admin UI, penghapusan/reassignment, E2E dan gerbang fase.

Plan 1–3 boleh memiliki commit antara untuk pekerjaan, tetapi **bukan deploy independen**: kode lama dan skema baru tidak boleh berjalan bersama. Pisahkan plan bila ukuran atau dependensi membutuhkannya, tanpa melepas acceptance. Testcontainers, isolasi tenant tanpa mock, E2E tiap aksi admin, checklist design system dan gerbang piagam tetap diperlukan; egress/compose yang terhalang O-1 harus dilaporkan sebagai blocked, bukan lulus.

**Risiko.** Empat plan mungkin terlalu besar, khususnya plan 2 dan 3; matriks dependensi dapat menuntut lebih. **Owner:** perubahan cakupan atau kriteria sukses milik owner.  
**Status:** acceptance dan gerbang **terverifikasi di dokumen**; ukuran plan **belum terverifikasi**.

### 7. Yang mudah terlewat

**Rekomendasi.** Uji pembuatan organisasi baru setelah migrasi; interaksi hapus state dengan tiket masuk dan perubahan peran; state ID milik tenant lain pada semua endpoint; prioritas pada sumber merge; serta efek pindah antar-state dalam group yang sama pada `resolvedAt`, flag, dan audit. Uji kegagalan transaksi di tengah reassignment. Pastikan `TicketState` masuk cakupan `scopedDb` dan worker tetap dapat menggunakan import relatif.

**Risiko.** Pengujian parsial dapat membuktikan migrasi tetapi melewatkan race runtime atau kebocoran nama state lewat payload publik. Visual pass tetap item manusia, bukan hasil rekaan. Isu audit merge AIDA-53 yang masih terbuka tidak otomatis selesai oleh fase ini.

**Owner:** penutupan atau perubahan requirement tetap mengikuti bukti dan aturan piagam.  
**Status:** isu AIDA-53 dan batas audit **terverifikasi di dokumen**; kelengkapan daftar race **belum terverifikasi**.