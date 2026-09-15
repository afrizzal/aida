Rekomendasi utama: gunakan **audit tiket terpisah**, satu service mutasi transaksional, dan protokol kunci baris yang juga dipakai kedua jalur balasan pelanggan. Risiko terbesar Fase 11 bukan UI, melainkan balapan auto-close dan otorisasi pada jalur baru.

Status di bawah membedakan fakta yang saya baca dari rancangan yang masih harus dibuktikan. Semua pilihan teknis tetap keputusan Claude; hal yang mengubah cakupan atau piagam milik owner.

### 1. Saved views — **terverifikasi di kode**

Simpan `organizationId`, `ownerId`, nama, visibilitas, filter JSON berversi, `position`, dan timestamps. Buat skema Zod bersama untuk membaca URL dan menyimpan filter; parser sekarang belum memakai Zod. Simpan `view`, `statuses`, `tagId`, `cf`, dan `q`; jangan simpan `limit` karena itu ukuran halaman, bukan definisi view. `mine` selalu berarti pengguna yang membuka view.

Setiap anggota boleh membuat view private atau shared. Pemilik dan admin boleh mengubah atau menghapus shared; hanya pemilik boleh mengubah private. Enforcement harus di server. Nama unik **per pemilik untuk private, per organisasi untuk shared**, dengan constraint database yang sesuai; urutkan `position`, lalu nama/ID sebagai tie-breaker. Hindari fitur reorder dulu bila belum diperlukan: posisi awal dan urutan deterministik cukup.

Jika tag atau definisi custom field hilang, **jangan diam-diam membuang filter**: tampilkan view sebagai rusak, jelaskan rujukan yang hilang, dan minta pengguna memperbaikinya. Validasi referensi saat simpan *dan* buka. Uji dengan PostgreSQL nyata: dua organisasi dan dua pengguna, termasuk akses berdasarkan ID langsung, perubahan visibilitas, collision nama, serta referensi terhapus.

**Risiko:** filter status tersimpan memakai enum; AIDA-56 harus memigrasikannya dan menguji view yang sudah ada. Parser URL saat ini juga menerima `limit` yang tidak dibatasi; validasi baru perlu batas aman tanpa mematahkan load-more.

**Owner:** tidak diperlukan untuk pilihan teknis ini.

### 2. Aksi massal — **terverifikasi di kode**

Pilih **(b) tabel audit tiket baru**, terdaftar di `scopedDb`, dengan trigger database append-only. Simpan organisasi, ID tiket, aktor atau identitas sistem, jenis aksi, nilai sebelum/sesudah yang minimal, waktu, dan ID batch untuk korelasi. Jangan isi kolom AI dengan data palsu atau melonggarkan kontrak `AuditEvent`.

Pakai satu service domain untuk aksi satu tiket dan massal, menerima transaction client; server action lama menjadi pembungkus. Jangan memanggil server action lama di dalam transaksi: ia mengambil client sendiri dan melakukan revalidation. Tetapkan maksimal **100 ID unik**, validasi payload di server, kunci tiket dalam urutan ID yang konsisten, dan tolak seluruh batch bila satu tiket/tag/assignee tidak valid atau di organisasi lain. Pilihan no-op harus eksplisit: saya sarankan tetap satu audit per tiket yang dipilih, dengan nilai sebelum/sesudah sama, agar memenuhi acceptance secara tidak ambigu.

Perubahan prioritas wajib menghitung ulang SLA dari `createdAt` dan mereset flag seperti sekarang. Assignee harus anggota organisasi saat transaksi berlangsung; `null` berarti unassign. Tag harus milik organisasi; tentukan add yang sudah ada dan remove yang tidak ada sebagai no-op.

Buktikan rollback dengan Testcontainers: paksa kegagalan **setelah** setidaknya satu mutasi dan audit berhasil di dalam transaksi, lalu periksa tidak ada perubahan tiket, relasi tag, maupun audit yang tersisa. Uji juga batch lintas organisasi, duplikat ID, konkurensi, dan efek SLA.

**Risiko:** trigger append-only dapat berbenturan dengan cascade saat organisasi dihapus; kebijakan retensi/penghapusan harus dirancang dan diuji, bukan diasumsikan. `scopedDb` yang ada tidak otomatis mengamankan nested write atau raw SQL.

**Owner:** retensi/penghapusan audit hanya jika harus mengubah kebijakan produk atau piagam; desain teknis biasa bukan keputusan owner.

### 3. Command palette — **sebagian terverifikasi di kode**

Gunakan registry client dengan `id` stabil, label, grup, predicate konteks, dan aksi; modul mendaftarkan dan melepas command saat mount/unmount. Context berasal dari route dan state halaman, bukan inspeksi DOM. Pastikan duplikat ID ditolak, cleanup saat navigasi, dan command yang sudah tidak relevan tidak dapat dijalankan. Ini menyediakan satu mekanisme untuk Fase 16 tanpa membangun abstraksi plugin besar sekarang.

Pencarian memanggil endpoint/server action yang memeriksa keanggotaan, lalu FTS yang ada dengan `orgId` dari sesi dan limit server; debounce dan abaikan respons kedaluwarsa. Daftarkan navigasi, cari/buka tiket, buka pembuatan tiket, dan ganti saved view. Jangan kirim semua tiket atau view private pengguna lain ke client.

E2E berbasis hasil: palette terbuka dengan kedua kombinasi; masing-masing grup menghasilkan navigasi, hasil pencarian, pembuatan, atau filter view yang benar. Uji juga context berubah saat berpindah halaman dan isolasi FTS.

**Risiko:** FTS yang ada membatasi kandidat sebelum filter inbox lain diterapkan; jangan mengklaim semua kombinasi pencarian sudah lengkap tanpa membuktikannya.

**Owner:** tidak diperlukan.

### 4. Keyboard — **sebagian terverifikasi di kode**

Saran peta awal: `g` lalu `i` untuk inbox, `j/k` memilih tiket berikut/sebelumnya dalam daftar yang sedang dimuat, `Enter` membuka, dan pada detail `a/s/t/r/n` membuka kontrol assign/status/tag/reply/note. `?` membuka bantuan; chord kedaluwarsa setelah **1 detik** dan batal saat blur, navigasi, Escape, atau input lain. Dokumen harus menjelaskan batas daftar yang dimuat dan perilaku fokus.

Gunakan satu dispatcher global, tetapi pertahankan handler lokal untuk navigasi dan penyuntingan komponen. Dispatcher menghormati `defaultPrevented`, modifier, key repeat, IME (`isComposing`), input, textarea, select, contenteditable, editor, serta dialog/popover aktif. `⌘K`/`Ctrl+K` adalah pengecualian eksplisit untuk membuka palette saat mengetik, tetapi jangan mencuri tombol dari dialog lain; definisikan Escape dan pemulihan fokus. Uji interaksi handler lokal, fokus, dan penggunaan pembaca layar; jangan memakai shortcut browser seperti `Ctrl+L`.

**Risiko:** shortcut huruf tunggal dapat bertabrakan dengan navigasi virtual pembaca layar; selain pengujian otomatis, perlu pemeriksaan aksesibilitas manual yang dicatat sebagai item manusia. Design system tetap mewajibkan token, `sidebar-*`, dan visual review dark mode.

**Owner:** tidak diperlukan; hasil visual dan aksesibilitas manusia tidak boleh direkayasa.

### 5. Auto-close — **sebagian terverifikasi di kode**

`0 = mati` diwajibkan AIDA-51. Saya sarankan default `0`, konfigurasi admin, jadwal harian, dan batas **100 tiket per organisasi per run**, dengan urutan deterministik dan kesempatan adil antarorganisasi. Saat diaktifkan, simpan waktu aktivasi dan mulai menghitung periode sepi paling awal dari waktu itu. Ini mencegah ribuan tiket lama tertutup langsung; UI harus menjelaskan konsekuensinya.

Definisikan awal sepi sebagai nilai terbaru dari `resolvedAt`, waktu aktivasi, dan balasan pelanggan yang relevan; catatan internal tidak mengulang periode. Tiket tanpa `resolvedAt` tidak ditutup otomatis dan perlu dicatat untuk perbaikan data. Jangan mengubah `resolvedAt` menjadi waktu close: ia menandai waktu resolusi.

**Balapan nyata:** kedua jalur balasan saat ini menghitung `shouldReopen` dari status yang dibaca sebelum transaksi. Conditional update pada worker saja tidak cukup. Kedua jalur balasan dan worker perlu mengunci baris tiket yang sama, lalu membaca ulang status dan memutuskan perubahan di dalam transaksi. Worker memeriksa ulang status, setting dan batas waktu di bawah kunci; status serta audit ditulis atomik. Uji kedua urutan balapan dengan dua transaksi terkoordinasi, retry, dan eksekusi berulang. Audit hanya dibuat untuk perubahan yang benar-benar terjadi.

Untuk pemberitahuan, pilih **tidak mengirim dan tidak menyediakan toggle dulu**: acceptance menyebut notice opsional, sedangkan piagam menyatakan apa pun yang sampai ke pelanggan melewati manusia. Jalur email yang ada memang memakai antrean, tetapi enqueue dan status kirim perlu analisis kegagalan tersendiri; template tetap tidak dengan sendirinya menyelesaikan aturan tersebut.

**Risiko:** Fase 12 wajib menambahkan pengecualian snooze dan state group beserta test, sesuai tabel risiko roadmap. Perubahan setting bersamaan dengan job juga harus diuji di bawah protokol penguncian yang dipilih.

**Owner:** pemberitahuan otomatis tanpa gerbang manusia memerlukan keputusan owner karena berpotensi mengubah piagam; jangan menganggap toggle sebagai persetujuan owner.

### 6. Celah warisan — **terverifikasi di kode**

Fase 11 wajib menutup celah pada **setiap jalur data barunya**: periksa keanggotaan aktif di server sebelum memakai organisasi dari sesi, termasuk palette search, saved views, bulk, dan settings. Memperbaiki `getScopedDb` secara terpusat adalah pilihan sederhana jika semua pemanggilnya kompatibel; uji sesi lama setelah membership dicabut. Periksa juga route baru yang tidak memakai helper itu.

Perbaiki `assignTicket` lama melalui service bersama dan validasi membership assignee, termasuk upaya lewat server action langsung. Catat bahwa ini **belum menutup AIDA-43 secara keseluruhan**: fase 10 masih perlu membuktikan seluruh halaman, API, unduhan lampiran, dan konsekuensi deaktivasi.

**Risiko:** pemeriksaan awal request saja tidak otomatis menyelesaikan balapan penghapusan membership dengan transaksi; tentukan dan uji jaminan konkurensinya.

**Owner:** keputusan membuka kembali fase yang diparkir tetap milik owner.

### 7. Plan dan wave — **belum terverifikasi**

Saya sarankan **tiga plan**, masing-masing dengan bukti mandiri:

1. Keanggotaan, audit tiket, service satu/massal, dan rollback.
2. Saved views, palette, keyboard, docs, dan E2E per kelompok.
3. Auto-close, setting, perbaikan kedua jalur balasan, dan test race.

Wave 1: plan 1. Wave 2: plan 2 dan 3 setelah kontrak audit serta otorisasi tersedia. Bila plan 2 terlalu besar untuk direview, pecah saved views dan keyboard/palette menjadi dua; jangan mengorbankan acceptance demi jumlah plan.

Gunakan unit test dan Testcontainers, tanpa test yang menyalakan stack compose. E2E menyatakan hasil yang diamati. Plan yang berubah setelah review harus direview lagi; jika tiga siklus habis dengan HIGH, parkir sesuai piagam.

**Risiko:** pembagian ini masih perlu diperiksa terhadap dependensi implementasi nyata dan durasi test.

**Owner:** O-1 soal compose tetap terbuka; rencana ini tidak memutuskannya.

### 8. Yang mudah terlewat — **sebagian terverifikasi di kode**

- Seleksi massal harus jelas hanya mencakup ID yang dipilih, bukan seluruh hasil filter; kosongkan atau tampilkan seleksi yang bertahan saat filter berubah.
- Pada saved view shared, filter `q` bisa berisi informasi sensitif; tampilkan bahwa pencarian tersimpan dapat dibaca anggota organisasi. Tetapkan batas panjang untuk nama, query, nilai custom field, dan jumlah status.
- Uji migrasi database pada data berisi tiket dan `AuditEvent`, termasuk trigger baru. Jangan mengklaim isolasi hanya dari mock.
- Pengiriman audit dan perubahan tiket harus berada pada transaksi yang sama; revalidation dan UI sukses hanya setelah commit.
- Catat requirement lintas fase yang tetap terbuka: migrasi saved view dan auto-close di Fase 12, serta pemakaian registry di Fase 16.

**Owner:** perubahan cakupan atau requirement apa pun tetap milik owner; rincian validasi dan perilaku di atas adalah rekomendasi teknis.