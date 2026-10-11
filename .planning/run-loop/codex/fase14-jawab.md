Rekomendasi utama saya: bekukan kontrak privasi, identitas task, dan semantik aktivitas sebelum membagi plan. Tiga hal itu saling memengaruhi: alias lama, riwayat, dan lampiran dapat membocorkan proyek privat meskipun query task biasa sudah aman.

**Status di bawah** membedakan fakta yang saya periksa dari rancangan yang belum dibuktikan. Saya tidak menjalankan pengujian.

### 1. Model data dan integritas

**Rekomendasi.** Gunakan model terpisah untuk Project, ProjectMember, Task, Comment, TaskAttachment, Label, Milestone, Team, TeamMember, ProjectTeam, dan favorit proyek/task. Gunakan `Task` dengan `parentId` untuk subtask; rekomendasi awal satu tingkat. Simpan `organizationId` pada setiap model, termasuk tabel penghubung, dan daftarkan pada `scopedDb`.

Tambahkan FK komposit ke target unik: `(organizationId, projectId)`, dan untuk relasi yang harus berada di proyek yang sama `(organizationId, projectId, taskId)`. Terapkan itu pada parent, komentar, lampiran, milestone, dan label bila label khusus proyek. CHECK mencakup parent bukan diri sendiri, tanggal valid, nilai positif, serta enum/status yang sah. CHECK biasa **tidak** dapat membuktikan parent bukan subtask atau mencegah siklus: satu tingkat butuh desain struktural atau trigger dengan protokol penguncian, bukan validasi aplikasi saja.

**Alasan.** `Attachment` saat ini mewajibkan `messageId`; model task terpisah menghindari perubahan semantik lampiran tiket. Gunakan ulang penyimpanan, batas ukuran, pemeriksaan tipe, dan staging yang ada.

**Risiko.** FK organisasi saja tidak mencegah relasi lintas proyek. Keanggotaan Better Auth belum unik per pengguna-organisasi, sehingga FK langsung ke satu baris `member` dapat menghasilkan identitas ambigu. Pastikan penghapusan anggota mencabut akses walaupun baris ProjectMember tersisa. **Owner:** jika pembatasan satu tingkat dianggap mengurangi cakupan subtask, minta keputusan sebelum membekukannya.

**Status:** `terverifikasi di kode` untuk bentuk `Attachment`, `scopedDb`, dan pola FK komposit; integritas rancangan `belum terverifikasi`.

### 2. Proyek privat

**Rekomendasi.** Default konservatif: hanya anggota organisasi aktif yang juga anggota langsung proyek atau anggota tim yang ditugaskan boleh membaca/mengubah proyek privat; owner/admin tidak otomatis menembus privasi. Batasi perubahan anggota, privasi, dan hapus kepada pengelola proyek yang ditentukan eksplisit. Buat pembuat proyek otomatis menjadi anggota/pengelola.

Gunakan satu kebijakan server bersama yang menghasilkan **predikat akses untuk query** dan pemeriksaan untuk mutasi, bukan helper boolean yang mudah dilupakan. Terapkan pada detail, daftar, agregat, komentar, unduhan lampiran, aktivitas, alias, dan operasi lintas proyek. Gunakan `scopedDb` plus term organisasi eksplisit pada operasi yang tidak dicakupnya. Mutasi dan pencabutan akses perlu protokol lock yang sama agar pemeriksaan tidak kedaluwarsa sebelum commit.

Pindah memerlukan akses ubah ke **kedua** proyek. Pindahkan seluruh pohon task secara atomik; tolak pemindahan subtask tunggal yang membuat relasi silang. Hapus atau petakan milestone dan label sumber secara eksplisit. Riwayat dan alias harus memeriksa izin tujuan saat ini; riwayat yang mengandung informasi sumber juga harus disaring/redaksi atau mensyaratkan akses ke sumber.

**Alasan.** Filter organisasi tidak membuktikan privasi proyek, dan otorisasi sebelum transaksi menyisakan perlombaan pencabutan akses.

**Risiko.** Team assignment otomatis memberi akses ke semua anggota tim; penambahan anggota tim kemudian juga memberi akses. RLS bisa menjadi pertahanan tambahan, tetapi koneksi, transaksi, worker, dan peran DB harus diuji; jangan mengklaim perlindungan RLS tanpa itu. **Owner:** kebijakan bypass owner/admin dan dampak akses lewat tim perlu ditetapkan sebagai kebijakan produk, terutama bila mengubah cakupan izin yang sudah mengikat.

**Status:** `terverifikasi di kode` bahwa `scopedDb` bukan pemeriksaan privasi dan keanggotaan ganda mungkin secara skema; kebijakan dan protokol `belum terverifikasi`. Buktikan tanpa mock dengan dua organisasi, anggota langsung/tim, bukan anggota, jalur baca/tulis, pencabutan dan perpindahan paralel.

### 3. Aktivitas dan audit hapus

**Rekomendasi.** Satu sumber aktivitas Projects dengan actor, aksi, identitas entitas, nilai sebelum/sesudah yang dibatasi, dan `batchId`; tulis dalam transaksi yang sama dengan mutasi. Buat append-only melalui DB. Simpan identitas proyek/task historis tanpa FK cascade ke entitas yang dapat dihapus; pisahkan akses feed dari penyimpanan audit. Tentukan retensi dan redaksi data sensitif sejak awal.

Definisikan satu record per **entitas yang berubah** dalam bulk, dan satu record untuk setiap mutasi proyek/task yang berhasil; tetapkan perlakuan no-op serta mutasi anggota, favorit, komentar, dan lampiran secara eksplisit. Perpindahan harus satu kejadian task, dengan konteks sumber/tujuan yang tidak bocor.

**Alasan.** D-07 mempertahankan `AuditEvent` khusus AI. Berbeda dari AIDA-53 yang menyebut **`AuditEvent`**, AIDA-103/104 mengatakan “audit event”; secara literal tabel aktivitas append-only dapat menjadi kandidat audit, tetapi semantik dan aksesnya tetap perlu diputuskan.

**Risiko.** Riwayat bertahan bukan berarti aman ditampilkan setelah akses berubah atau proyek dihapus. **Owner:** hubungkan dengan 12-o1 dan minta penegasan apakah record aktivitas itu memenuhi audit hapus, siapa yang boleh membacanya, dan berapa lama disimpan. Jangan mengklaim bagian audit selesai sebelum keputusan bila dianggap mengubah acceptance.

**Status:** `terverifikasi di kode` untuk D-07, model audit AI, dan rumusan requirement; kecukupan desain `belum terverifikasi`.

### 4. Kunci task

**Rekomendasi.** Counter per proyek dinaikkan atomik dalam transaksi; prefix dinormalisasi dan dicadangkan unik per organisasi. Gunakan **satu ruang nama kunci** untuk kunci aktif dan alias, dengan unique `(organizationId, normalizedKey)`; setiap entri menunjuk ke identitas task stabil. Jangan pernah memakai ulang kunci yang sudah diterbitkan. Saat pindah, alokasikan kunci tujuan dan pertahankan kunci lama sebagai alias dalam transaksi yang sama.

Perubahan prefix berlaku untuk task baru; kunci yang telah terbit tetap stabil. Duplikat mendapat identitas dan kunci baru.

**Alasan.** Dua tabel unik terpisah tidak mencegah kunci aktif bertabrakan dengan alias. Tidak memakai ulang prefix mencegah tautan lama diarahkan ke task lain.

**Risiko.** Penghapusan butuh tombstone kunci agar tidak dipakai ulang; resolver harus memeriksa akses task saat ini sebelum mengungkap redirect atau keberadaan. Format, batas panjang, collision, dan overflow perlu kontrak.

**Status:** pola counter tiket `terverifikasi di kode`; rancangan kunci dan konkurensinya `belum terverifikasi`.

### 5. Task berulang

**Rekomendasi.** Simpan aturan dan tanggal lokal dasar, frekuensi harian/mingguan/bulanan, serta zona waktu IANA eksplisit per seri; default UTC sampai preferensi pengguna tersedia. Untuk bulanan, pertahankan *hari jangkar*: tanggal 31 menjadi hari terakhir bulan pendek, lalu kembali ke 31 jika tersedia. Jika hanya tanggal tanpa jam, gunakan tipe tanggal kalender, bukan tengah malam UTC yang dapat bergeser hari.

Pada transisi ke `done`, kunci task/seri; buat penerus dalam transaksi yang sama. Beri penerus `predecessorId` unik per organisasi, sehingga satu occurrence hanya dapat menghasilkan satu penerus, termasuk saat retry atau reopen lalu selesai lagi. Tentukan aturan penyalinan tanggal, durasi, assignee, dan pengulangan; status penerus kembali terbuka.

**Alasan.** Counter atau antrean saja tidak menjamin sekali; constraint unik adalah pagar terakhir. Preferensi tampilan pengguna tidak boleh diam-diam mengubah jadwal bersama.

**Risiko.** DST dan tanggal tanpa due date perlu perilaku eksplisit; perubahan zona seri setelah dibuat harus didefinisikan. Jika ada jam lokal di kemudian hari, tentukan penanganan jam yang hilang/ganda. **Owner:** pilihan zona default bersama bila dianggap kebijakan produk.

**Status:** ketiadaan preferensi fase ini dan acceptance zona waktu `terverifikasi di dokumen`; algoritme dan constraint `belum terverifikasi`.

### 6. Operasi untuk Fase 15

**Rekomendasi.** Sediakan service bertipe di `src/lib/projects/` dengan actor dan organisasi dari konteks server, hasil sukses atau kode penolakan stabil. Cakup list/detail, create/edit, perubahan status/tanggal, reorder, pindah, dan bulk. Validasi tanggal di server **dan** CHECK database. Bulk atomik: validasi semua ID dan izin, kunci dalam urutan stabil, lalu ubah dan catat aktivitas.

Mulai dengan posisi integer berjarak dan rebalance dalam transaksi; serialkan reorder per proyek/kelompok dan gunakan versi untuk menolak perubahan dari tampilan basi. Pindah status sekaligus memperbarui posisi. Tentukan apakah list dan board berbagi urutan atau memakai urutan terpisah.

**Alasan.** Pecahan tanpa aturan tabrakan dan rebalance tidak otomatis menyelesaikan konkurensi. Kode penolakan memungkinkan UI membedakan konflik, input salah, dan akses ditolak.

**Risiko.** Lock urutan harus mencakup grup sumber dan tujuan dalam urutan deterministik; bulk besar perlu batas. Hindari membocorkan apakah ID privat benar-benar ada.

**Status:** kebutuhan operasi dan otorisasi `terverifikasi di dokumen`; API dan mekanisme `belum terverifikasi`.

### 7. Progres dan status proyek

**Rekomendasi.** Progres proyek = jumlah task tingkat atas yang `done` dibagi jumlah task tingkat atas yang tidak diarsipkan; proyek kosong = 0%. Progres task = subtask `done` dibagi subtask aktif; tanpa subtask = 0%. Status parent tetap eksplisit, tidak berubah otomatis. Hitung dari data, tanpa kolom progres yang diedit.

Usulkan status proyek tetap: `planning`, `active`, `at_risk`, `completed`, `on_hold`. Status proyek eksplisit dan independen dari progres.

**Alasan.** Menghitung parent dan subtask sekaligus membuat pekerjaan yang dipecah berbobot ganda.

**Risiko.** Parent `done` dengan subtask belum selesai dapat menghasilkan angka yang terlihat bertentangan; dokumentasikan dan uji, termasuk task arsip dan pemulihan. **Owner:** pilihan rumus dan status adalah usulan produk; eskalasi bila dinilai mengubah cakupan requirement.

**Status:** requirement progres turunan `terverifikasi di dokumen`; rumus dan status `belum terverifikasi`.

### 8. Arsip, favorit, duplikat, pindah, hapus

**Rekomendasi.** Arsip sebagai status reversibel, mengecualikan default list; task arsip tetap punya riwayat. Favorit unik per pengguna-entitas dan tetap tunduk pada akses saat dibaca. Duplikat proyek selalu membuat identitas, prefix, counter, dan kunci baru; salin metadata dan struktur label/milestone. Opsi dengan task menyalin task/subtask, status dan penugasan yang masih sah, dengan pemetaan relasi; jangan salin komentar, lampiran, favorit, aktivitas, atau anggota/tim selain pembuat secara default. Duplikat task mengikuti prinsip sama.

Hapus perlu parameter konfirmasi eksplisit pada service, bukan sekadar dialog UI; lakukan pemeriksaan izin, pencatatan dan perubahan secara atomik. Pilihan awal: tombstone dan sembunyikan dari seluruh jalur biasa, dengan kebijakan pembersihan file yang dinyatakan jelas.

**Risiko.** Tombstone bukan otomatis penghapusan permanen; jangan mengklaim memenuhi makna hapus jika retensi belum disepakati. File di luar transaksi DB memerlukan cleanup yang dapat diulang dan penanganan kegagalan. Perpindahan tidak boleh meninggalkan favorit atau metadata sumber yang membocorkan proyek.

**Owner:** makna hapus, retensi/akses audit, dan isi duplikasi bila dianggap keputusan cakupan produk.

**Status:** kebutuhan arsip, dua opsi duplikasi dan konfirmasi `terverifikasi di dokumen`; perilaku terperinci `belum terverifikasi`.

### 9. Tim tanpa Fase 10

**Rekomendasi.** Bangun tim hanya dari pengguna yang saat itu anggota organisasi; periksa keanggotaan lagi setiap akses dan saat penugasan. Gunakan pemeriksaan konservatif untuk hak admin ketika ada baris peran ganda. Tunda guest, undangan, pilihan peran pembuat proyek, dan integrasi notifikasi ke fase yang mensyaratkannya; jangan membuat peran guest semu.

**Risiko.** Penghapusan atau perubahan keanggotaan bersamaan dengan operasi membutuhkan koordinasi; lock baris yang ada saja juga harus dikaji terhadap penyisipan baris duplikat baru. Fase 16 tetap terhalang Fase 10, bukan sekadar bergantung pada tabel Team.

**Status:** `terverifikasi di kode` untuk pembacaan konservatif dan ketiadaan keunikan yang disebut; protokol perlombaan `belum terverifikasi`.

### 10. Pemecahan plan dan urutan

**Rekomendasi.** Sekitar **10–12 plan dalam 5 wave**, bukan satu plan per requirement:

1. Bekukan matriks akses, invariant, kejadian, identitas/kunci, tanggal, dan kontrak penghapusan; catat butir owner.
2. Skema, migrasi dan constraint; lalu service otorisasi serta pengujian isolasi.
3. CRUD proyek/tim/task, aktivitas dan lampiran; plan terpisah dengan kontrak bersama.
4. Kunci/pindah/duplikasi; pengulangan; reorder/bulk/progres.
5. Uji lintas fitur dan seluruh tujuh kriteria, termasuk grep clean-room dan jalur integrasi Fase 15.

Gunakan Postgres nyata/Testcontainers dan sinkronisasi deterministik dengan barrier/lock untuk race, tanpa `sleep`. Uji penolakan FK langsung, rollback aktivitas, akses dan pencabutan, serta migrasi mempertahankan objek SQL buatan tangan.

**Risiko.** Plan paralel yang masing-masing mengubah skema atau mendefinisikan aktivitas akan bertabrakan. Keputusan audit owner dapat menghalangi klaim acceptance hapus; kerjakan bagian independen sambil tetap menyatakan batasnya.

**Status:** tujuh kriteria dan batas fase `terverifikasi di dokumen`; jumlah plan dan kelayakan wave `belum terverifikasi`.

### 11. Yang mudah terlewat

**Rekomendasi.** Bekukan juga:

- Semantik aktivitas pada create, no-op, bulk, cascade, recurrence, dan perubahan keanggotaan; jangan diam-diam mengecualikan operasi yang disebut “every mutation”.
- Akses lampiran saat upload **dan setiap download**, termasuk setelah pindah atau pencabutan; staging perlu cleanup saat transaksi gagal.
- Pengujian kebocoran melalui hitungan, pencarian mendatang, alias, pesan galat, dan riwayat yang tersisa setelah hapus.
- Konten markdown dan nama file sebagai input tidak tepercaya; pilih jalur render aman yang sesuai, termasuk kebijakan gambar remote.
- Penghapusan task yang sudah memiliki penerus recurrence, serta perilaku arsip parent terhadap subtask.
- Batas dan indeks untuk list, aktivitas, pengurutan dan agregat; jangan mengandalkan `scopedDb` untuk `aggregate`, raw SQL, atau operasi lain yang tidak dicakup.

**Alasan.** Kebocoran biasanya muncul di jalur turunan dan di perbatasan transaksi, bukan hanya pada detail proyek.

**Risiko.** Aktivitas append-only yang menyimpan teks lengkap bisa mempertahankan data sensitif sesudah hapus; minimalkan isi dan tetapkan retensi. **Owner:** retensi dan hak akses audit.

**Status:** celah operasi `scopedDb` dan pipeline markdown/lampiran `terverifikasi di kode`; cakupan perlindungan Projects `belum terverifikasi`.