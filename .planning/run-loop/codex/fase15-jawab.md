Temuan terpenting: kontrak Fase 14 menyediakan fondasi yang kuat, tetapi **belum menyediakan semua bentuk query yang dibutuhkan Fase 15**. Terutama, daftar proyek belum mendukung pencarian, filter status, dan sort di server; query task workspace belum cukup untuk Timeline berbasis rentang. Ini perlu masuk plan sebagai pekerjaan kontrak dan service, bukan disembunyikan dengan filter pada halaman yang baru dimuat.

1. **Struktur rute dan server action**

   **Rekomendasi:** Sediakan daftar dan detail proyek, serta satu URL kanonis untuk task. Navigasi dari tampilan kerja dapat membuka URL task yang sama sebagai drawer; akses langsung atau reload menampilkan halaman penuh. Gunakan komponen isi dan loader yang sama, dengan otorisasi ulang pada kedua jalur. Uji back/forward, refresh, tautan lama setelah task dipindah, penutupan drawer, dan pengembalian fokus.

   Action mengambil actor dari `getSessionActor`, meneruskan hasil bertipe service, dan memakai pemetaan hasil terpusat ala `resolveActionOutcome`. `NOT_FOUND` untuk objek privat yang tak terbaca harus sama dengan objek tidak ada. Pada exception, panggil `unstable_rethrow` sebelum mengembalikan `UNKNOWN`; jangan menganggap `UNKNOWN` berarti transaksi gagal. Nonaktifkan pengulangan aksi berisiko sampai data dimuat ulang.

   **Alasan:** Pola proposal sudah memisahkan penolakan, pesan, fokus, dan revalidasi sesudah commit. **Risiko:** routing drawer dapat meninggalkan state latar yang basi; revalidasi gagal sesudah commit juga tidak boleh dilaporkan sebagai kegagalan mutasi. **Status:** terverifikasi di kode untuk pola action dan hasil Fase 14; mekanisme rute drawer yang diusulkan belum terverifikasi.

2. **Drag and drop dan keyboard**

   **Rekomendasi:** Mulai dengan interaksi pointer yang kecil dan kontrol keyboard eksplisit seperti “pindahkan ke status/tanggal” dan “pindahkan sebelum/sesudah”, memakai operasi server yang sama. Sediakan nama kontrol, instruksi, pengumuman hasil, fokus yang stabil, pembatalan, dan penanganan gerak terbatas. Bila implementasi pointer sendiri tidak andal pada perangkat sentuh dan edge scrolling, evaluasi library sebelum memilih; pin versi dan periksa lisensi, ukuran bundle, aksesibilitas, serta audit sesuai piagam.

   **Alasan:** Keyboard tidak perlu meniru gerakan fisik untuk menghasilkan perubahan yang setara. `reorderTask` menerima status dan anchor dalam grup proyek; ia tidak menerima versi. **Risiko:** anchor basi, item di luar halaman, dan pengurutan workspace lintas proyek: rank bukan urutan global workspace. Jangan menjanjikan urutan global yang tidak didukung.

   E2E harus memindahkan task yang setara lewat mouse dan keyboard pada Board, Calendar, dan Timeline, lalu reload dan memeriksa status/urutan atau tanggal sebenarnya; sertakan penolakan, fokus, dan pengumuman. **Status:** terverifikasi di kode untuk kontrak reorder; kualitas implementasi sendiri atau library, lisensi dan ukuran library **belum terverifikasi**.

3. **Table dan edit sel**

   **Rekomendasi:** Gunakan editor sesuai tipe dengan validasi awal untuk umpan balik, tetapi service tetap penentu. Kirim `expectedVersion` untuk operasi yang mensyaratkannya; pada `CONFLICT`, pertahankan input pengguna, tampilkan bahwa data berubah, dan tawarkan muat ulang sebelum mencoba lagi. Jangan menimpa otomatis. Simpan pilihan kolom dan grouping per pengguna dan proyek sebagai bagian pengaturan tampilan.

   **Alasan:** Task memiliki `version`, dan edit biasa memakai pemeriksaan versi. **Risiko:** tidak semua operasi sama: `reorderTask` dan `bulkUpdateTasks` mengunci data tanpa menerima versi, sehingga UI tidak boleh menjanjikan deteksi konflik yang sama untuk semuanya. Pilihan kolom, filter, dan grouping harus berlaku atas seluruh hasil, bukan hanya halaman yang sedang terlihat. **Status:** terverifikasi di kode untuk versi dan pengecualian tersebut; desain penyimpanan pilihan kolom belum terverifikasi.

4. **Calendar dan Timeline**

   **Rekomendasi:** Pakai `YYYY-MM-DD` sebagai tanggal kalender, tanpa mengonversinya menjadi waktu lokal. Gunakan UTC untuk menentukan “hari ini” hingga preferensi AIDA-98 tersedia. Tentukan dan dokumentasikan tanggal yang ditampilkan Calendar, perilaku task tanpa tanggal, dan aturan geser rentang Timeline: geser kedua ujung dengan selisih hari tetap; task bertanggal satu ujung tetap satu ujung. Validasi batas tanggal dan rentang di server. Render dengan grid/CSS dan aritmetika tanggal terbatas; simpan zoom dan grouping agar bertahan reload. Sertakan milestone di Timeline.

   **Alasan:** Kontrak Fase 14 menetapkan tanggal kalender dan default UTC. **Risiko:** `listWorkspaceTasks` hanya memfilter **due date**, sehingga task yang rentangnya melintasi jendela Timeline, atau hanya punya start date, bisa hilang. Perlu query overlap dan paging yang benar, bukan mengambil sebagian lalu memfilter di browser. Uji pergantian hari, DST, akhir bulan/tahun, tanggal tanpa zona, dan pergeseran rentang. **Status:** terverifikasi di kode untuk format, UTC, dan keterbatasan query; kecukupan rendering tanpa library belum terverifikasi.

5. **Tampilan tersimpan**

   **Rekomendasi:** AIDA-80 mensyaratkan penggunaan model SEED-005 karena Fase 11 sudah selesai. Perluas model `SavedView` secara kompatibel dengan pembeda jenis, proyek, pemilik, serta payload tampilan berversi; pertahankan perilaku dan data inbox. Batasi tampilan proyek per pengguna, dan cek akses proyek saat menyimpan maupun membuka. Validasi versi, jenis view, kolom, filter, referensi, dan ukuran payload di server; versi tak dikenal atau referensi yang tidak valid harus menghasilkan keadaan yang jelas dan gagal tertutup, bukan memperluas hasil.

   **Alasan:** Model saat ini hanya berisi filter inbox, tanpa `projectId`, dan service-nya mendukung view bersama. **Risiko:** migrasi, indeks keunikan, privasi, dan perubahan perilaku inbox. Jangan menciptakan model baru terpisah tanpa menyelesaikan kewajiban AIDA-80. **Status:** terverifikasi di kode untuk model dan service saat ini; rancangan migrasi belum terverifikasi.

6. **Tingkat workspace**

   **Rekomendasi:** Gunakan `listWorkspaceTasks` dan `listWorkspaceMilestones` sebagai titik awal, lalu perluas service untuk query yang belum tersedia. Predikat akses harus berada di **setiap query** yang menghasilkan data, hitungan, cursor, atau `hasMore`, sebelum paging; jangan menyimpan daftar ID proyek terbaca untuk dipakai sebagai otorisasi berikutnya. Gunakan keyset stabil dan pembanding unik untuk setiap sort yang ditawarkan.

   **Alasan:** Implementasi saat ini mengecualikan proyek privat yang tidak terbaca dan memakai keyset berdasarkan ID; ia tidak memberi urutan rank global. **Risiko:** grouping, pencarian, dan agregat dari halaman parsial bisa menyesatkan atau membocorkan keberadaan data. Uji database nyata untuk dua dunia yang hanya berbeda pada proyek tersembunyi, termasuk seluruh halaman, cursor, dan hasil setelah akses dicabut. Terapkan prinsip sama pada pencarian/sort daftar proyek; posisi internal tetap tidak terekspos. **Status:** terverifikasi di kode untuk query yang ada; query tambahan belum terverifikasi.

7. **Files**

   **Rekomendasi:** Grid dan list memakai `listProjectAttachments`; setiap unduhan melewati route autentikasi yang memanggil `getTaskAttachmentForDownload` pada saat permintaan. Jangan mengirim storage key ke browser. Default unduhan sebagai attachment, `nosniff`, cache privat/no-store, dan nama file aman. Untuk pratinjau, mulai dari metadata; inline hanya untuk tipe yang telah dievaluasi aman dengan perlindungan respons yang sesuai.

   **Alasan:** Lookup lampiran tiket yang ada hanya berbasis organisasi dan tidak cukup untuk privasi proyek. **Risiko:** izin dicabut atau task dipindah setelah daftar dibuka; akses sebelumnya bukan izin permanen. Uji ID hilang dan privat dengan respons setara, termasuk setelah pencabutan. **Status:** terverifikasi di kode untuk kedua lookup; keamanan route dan pratinjau Projects yang diusulkan belum terverifikasi.

8. **Pemecahan plan dan urutan**

   **Rekomendasi:** Bekukan lebih dulu matriks rute, akses dan penolakan; semantik tanggal, query/paging dan urutan; skema saved view serta migrasinya; kemudian state, fokus, keyboard, responsif dan dark mode dalam UI-SPEC. Pecah implementasi menjadi: fondasi query dan saved view; shell proyek/task; List dan bulk; Board; Table; Calendar dan Timeline; Files dan workspace; lalu integrasi serta gerbang fase. Jalankan checklist design system §9 dan catat visual pass manusia sebagai item manual.

   **Alasan:** Keenam kriteria dan seluruh acceptance harus punya pemilik plan dan bukti, termasuk favorit/arsip dari kedua halaman serta persistensi zoom. **Risiko:** Fase 14 memiliki aturan amendment kontrak: perubahan kontrak dan `contract.ts` harus dicatat bersama; jangan diam-diam menambah perilaku yang bertentangan. **Status:** terverifikasi di dokumen untuk gerbang dan aturan amendment; rincian plan belum terverifikasi.

9. **Yang mudah terlewat**

   **Rekomendasi:** Tetapkan perilaku arsip, task berulang saat dipindah ke DONE, batas bulk 100, subtugas satu tingkat, isi markdown yang tersanitasi, serta loading, kosong, galat, dan hilangnya akses saat layar terbuka. Bulk harus menjelaskan bahwa hasilnya atomik dan memperbarui seleksi setelah hasil diketahui; verifikasi sifat atomiknya pada jalur implementasi sebelum membuat klaim UI. Pastikan tampilan dan copy mengikuti design system AIDA dan clean-room, serta jangan mengklaim visual pass manusia.

   **Risiko:** klik ulang setelah `UNKNOWN` bisa menggandakan efek; drag ke DONE dapat membuat task berulang baru; filter pada data yang hanya sebagian dimuat menghasilkan hasil salah. **Status:** terverifikasi di kontrak untuk batas bulk, rekursi, dan aturan arsip; perilaku lengkap UI dan atomisitas yang ditampilkan masih perlu diverifikasi.

**Keputusan milik owner:** status item 14-o1 mengenai akses dan pemulihan proyek privat, serta 14-o2 mengenai kecukupan audit setelah penghapusan, tetap menunggu owner. Fase 15 harus mengikuti default kontrak saat ini tanpa menganggap pertanyaan tersebut sudah diputuskan. Perubahan cakupan fitur, lisensi, atau `REQUIREMENTS.md` juga milik owner; pilihan teknis di atas adalah rekomendasi untuk diputuskan pelaksana dalam batas itu.