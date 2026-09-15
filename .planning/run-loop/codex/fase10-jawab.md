Rekomendasi utama saya: bangun di atas plugin organisasi Better Auth yang sudah terpasang, tetapi jangan menganggap endpoint bawaannya sudah memenuhi kontrak keamanan. Kelayakannya harus dibuktikan pada versi **1.6.22**; bila ada invariant yang tidak bisa ditegakkan pada semua jalur, gunakan alur aplikasi yang lebih sempit dan tutup jalur plugin yang bisa melewatinya. Jangan menutup requirement berdasarkan asumsi tentang perilaku library.

### 1. Undangan — AIDA-42

**Rekomendasi:** Pakai model dan kemampuan undangan plugin sebagai pilihan awal. Buat satu alur server untuk membuat, mencabut, dan menerima undangan; uji token sekali pakai, expiry, status, email akun penerima, dan peran pada server. Batasi admin mengundang `member` atau `admin`; hanya owner boleh memberikan `owner`. Simpan dan tampilkan tautan salin hanya kepada pengundang yang berwenang, termasuk bila SMTP tidak aktif.

Untuk orang yang belum punya akun, rancang onboarding berbasis undangan yang juga memungkinkan mereka membuat akun dan masuk sebelum menerima undangan. Jangan membuka pendaftaran publik secara umum. Tentukan sumber URL dasar tepercaya, jangan membangun link dari `Host` arbitrer; jangan log token atau membocorkannya lewat referrer.

**Alasan:** Menggunakan plugin mengurangi dua sumber kebenaran untuk keanggotaan. Alur akun baru diperlukan agar “mengundang orang” benar-benar bekerja.

**Risiko:** Belum terbukti apakah 1.6.22 menjamin konsumsi atomik, validasi email, serta batas peran untuk semua endpoint. Audit endpoint organisasi Better Auth yang dapat diakses langsung, termasuk penerimaan dan perubahan anggota, bukan hanya UI sendiri. Uji penerimaan serentak, undangan ganda atau dicabut, serta isolasi organisasi. Ulangi seluruh tes undangan setelah upgrade Better Auth.

**Status:** **Terverifikasi di kode:** plugin terpasang; `/api/auth` terbuka sementara pendaftaran publik diblokir oleh [proxy.ts](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.Ea9R6KImQX/src/proxy.ts). **Belum terverifikasi:** jaminan internal plugin dan kelayakan alur akun baru.

### 2. Deaktivasi dan peran — AIDA-43

**Rekomendasi:** Gunakan keberadaan baris `member` sebagai status aktif: deaktivasi menghapus keanggotaan, bukan akun global. Pada setiap request terlindungi, helper bersama harus membaca keanggotaan terbaru dari database berdasarkan user dan organisasi aktif, tanpa mengandalkan cookie cache untuk status keanggotaan. Pakai juga di app layout, semua action, API dan unduhan; inventarisasi endpoint Better Auth dan jalur yang memakai `requireSession` atau Prisma langsung. Atur ulang organisasi aktif secara aman bagi pengguna dengan keanggotaan lain.

Serialisasi *semua* perubahan yang dapat mengurangi jumlah admin/owner dengan lock baris organisasi dalam satu transaksi: cek otorisasi aktor dan jumlah admin/owner, ubah anggota, cabut undangan tertunda yang dikirimnya, lalu tulis audit. Pakai kunci dan aturan yang sama untuk endpoint plugin atau tutup bypass-nya. Tambahkan constraint unik `(organizationId, userId)` setelah memeriksa dan menangani duplikat lama. Tentukan aturan eksplisit untuk self-removal, owner, dan promosi; jangan izinkan admin mengubah owner atau mengangkat dirinya melewati kewenangan.

**Alasan:** Dua permintaan yang masing-masing hanya menghitung admin masih bisa sama-sama menghapus admin terakhir. Audit harus atomik dengan perubahan, bukan best-effort.

**Risiko:** “Request berikutnya ditolak” tidak otomatis membatalkan request atau SMTP yang sudah berjalan; definisikan batas tersebut dan uji interleaving. Penghapusan member juga harus menghentikan pembuatan dan pengiriman notifikasi berikutnya, termasuk job yang sudah antre. [AuditEvent](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.Ea9R6KImQX/prisma/schema.prisma:446) sekarang berbentuk audit AI; perlu perluasan skema yang tetap append-only dan menyimpan aktor, target, aksi, dan metadata minimal tanpa isi sensitif.

**Keputusan milik owner:** Tidak ada jika tetap memakai tiga peran yang sudah ada (`owner`, `admin`, `member`). Saya merekomendasikan **tidak menambah `viewer`**: seed menyebutnya opsional dan requirement menyerahkan keputusan teknis itu ke CONTEXT. Perluasan cakupan atau perubahan requirement adalah keputusan owner.

**Status:** **Terverifikasi di kode:** layout hanya memakai `requireSession`; cookie cache lima menit aktif; `member` belum punya constraint unik pasangan tersebut. Perilaku endpoint plugin dan seluruh bypass **belum terverifikasi**.

### 3. Notifikasi — AIDA-44

**Rekomendasi:** Satu `Notification` per penerima dan per kejadian nyata, dengan `organizationId`, `recipientUserId`, jenis, identitas kejadian stabil, referensi entitas generik, `readAt`, dan `archivedAt`. Indeks unik pada organisasi, penerima, jenis, dan ID kejadian mencegah duplikasi retry tanpa menggabungkan dua balasan yang berbeda. Semua model baru masuk `scopedDb`; setiap pembacaan dan mutasi juga wajib memfilter **penerima**, bukan hanya organisasi.

Buat notifikasi dalam transaksi yang sama dengan perubahan sumber, termasuk perubahan flag SLA; bila transaksi gagal keduanya rollback. Untuk event awal, rekomendasi penerima: assignee baru untuk assignment; assignee saat itu untuk balasan pelanggan dan SLA; anggota yang disebut untuk mention. Abaikan penerima tidak aktif dan hindari notifikasi assignment ke diri sendiri. Arsip menyembunyikan dari lonceng dan hitungan belum dibaca; tandai baca tetap tersimpan. Gunakan polling sederhana dengan interval yang ditetapkan, tanpa klaim realtime.

**Alasan:** Commit lalu enqueue atau insert menciptakan celah kehilangan notifikasi. ID kejadian, bukan ID tiket saja, memungkinkan beberapa peristiwa pada tiket yang sama.

**Risiko:** [assignTicket](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.Ea9R6KImQX/src/app/(app)/tickets/%5Bid%5D/actions.ts:198) saat ini menerima `assigneeId` tanpa verifikasi keanggotaan; wajib validasi server. Job SLA memakai dua update global: identifikasi transisi atomik agar tidak mengulang, termasuk tiket yang langsung breach dan flag yang di-reset. Inventarisasi semua jalur balasan pelanggan, termasuk email masuk dan portal publik. Pengguna tanpa assignee tidak mendapat notifikasi SLA atau balasan dengan kebijakan ini: nyatakan di CONTEXT.

**Status:** **Terverifikasi di kode:** implementasi assignment dan job SLA tersebut ada; `scopedDb` hanya menginjeksi organisasi untuk operasi tertentu dan tidak mengamankan penerima. Atomicitas desain baru **belum terverifikasi**.

### 4. Mention — AIDA-45

**Rekomendasi:** Autocomplete hanya anggota aktif organisasi. Simpan referensi ID pengguna yang stabil sebagai metadata terstruktur bersama catatan, dengan representasi teks yang lolos pipeline Markdown tersanitasi. Validasi ID, organisasi, dan keanggotaan di server; deduplikasi mention berulang dalam satu pesan. Hanya proses metadata mention ketika `visibility=INTERNAL`. Pada mode publik, tolak payload mention terstruktur dan token internal yang tersisip, termasuk setelah pengguna mengganti mode composer; teks `@nama` biasa tetap diperlakukan sebagai teks publik, bukan referensi anggota.

**Alasan:** Nama bisa sama atau berubah; parsing `@nama` saja tidak dapat mengidentifikasi penerima secara andal.

**Risiko:** Tentukan perilaku edit, anggota dihapus, input palsu, link Markdown, dan teks dalam blok kode. Uji HTML tersanitasi, payload HTTP langsung, pergantian mode, halaman status publik, dan isi SMTP pelanggan—bukan hanya UI. Email outbound worker sudah menyaring `PUBLIC`, tetapi itu tidak membuktikan seluruh jalur aman.

**Status:** **Terverifikasi di kode:** pesan dirender lewat [render.ts](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.Ea9R6KImQX/src/lib/markdown/render.ts), dan worker outbound menyaring visibilitas. Desain serialisasi mention **belum terverifikasi**.

### 5. Preferensi dan digest — AIDA-46

**Rekomendasi:** Simpan preferensi per organisasi, anggota, dan jenis kejadian; tetapkan default eksplisit. Gunakan pg-boss terjadwal untuk mengambil batch unread dan belum diarsip per penerima, dengan klaim database yang mencegah dua worker mengirim batch yang sama. Bekukan ID notifikasi dalam batch; cek ulang keanggotaan dan preferensi sebelum pengiriman. Tandai terkirim hanya setelah SMTP menerima; kegagalan sebelum handoff membuat batch dapat dicoba lagi. Subject konstan, misalnya “Pembaruan AIDA”; isi minimal dan tautan ke aplikasi, tanpa `AuditEvent.input`.

**Alasan:** Status job saja tidak cukup menjamin deduplikasi lintas retry atau worker.

**Risiko:** SMTP dan commit database bukan transaksi bersama: crash sesudah SMTP menerima tetapi sebelum status tercatat tetap bisa menyebabkan duplikat. Dokumentasikan jendela ambigu itu dan kebijakan retry; jangan menjanjikan exactly-once. Klaim yang kedaluwarsa juga tidak boleh membuat worker lama dan baru mengirim bersamaan. Uji kegagalan sebelum handoff, sesudah handoff, dua worker, perubahan preferensi dan deaktivasi. Uji email nyata tetap **item manual owner**.

**Status:** **Terverifikasi di kode:** pg-boss dan transporter SMTP ada. Protokol klaim serta sifat handoff SMTP pada implementasi baru **belum terverifikasi**.

### 6. Pemecahan plan dan wave

**Rekomendasi:** Setiap plan punya bukti yang dapat dijalankan sendiri, dengan data dan fixture sendiri:

1. **Wave 1:** membership guard, inventaris bypass, lock admin terakhir, audit dan tes konkurensi.
2. **Wave 2:** undangan dan onboarding; paralel dengan fondasi model notifikasi serta tes isolasi organisasi **dan penerima**.
3. **Wave 3:** emitter assignment, semua jalur balasan dan SLA; plan mention internal serta tes kebocoran.
4. **Wave 4:** UI lonceng dan Team, preferensi, digest dan fake SMTP; masing-masing menyertakan tes perilaku yang relevan.
5. **Wave 5:** E2E acceptance dan gerbang fase sesuai piagam, termasuk design-system dan item visual/manual yang jujur.

**Risiko:** “Bukti mandiri” tidak berarti semua plan bisa berjalan sebelum dependensinya; nyatakan dependensi dan fixture dengan jelas. Gunakan Testcontainers dan SMTP palsu, tanpa membuat tes stack Compose sungguhan. Jika suite wajib piagam terhalang keputusan container owner, catat **blocked/not run**, jangan menyatakannya lulus.

**Status:** **Belum terverifikasi:** kelayakan pembagian dan fixture sampai planner memeriksa harness yang ada.

### 7. Yang mudah terlewat

- **Status:** **Terverifikasi di kode.** `scopedDb` tidak mengintersepsi semua operasi atau raw SQL; nested write dan transaksi perlu dibuktikan satu per satu. Jangan menyimpulkan isolasi hanya karena model ditambahkan ke daftar.
- **Status:** **Belum terverifikasi.** Penerimaan undangan bersamaan dengan pencabutan atau deaktivasi pengundang harus punya urutan atomik yang jelas; member yang dinonaktifkan tidak boleh diam-diam masuk kembali lewat undangan lama.
- **Status:** **Belum terverifikasi.** Definisikan retensi notifikasi, timezone/jadwal digest, perilaku SMTP tidak aktif, dan apa yang terjadi saat penerima diaktifkan kembali. Ini pilihan teknis selama tidak mengurangi acceptance; perubahan cakupan adalah **keputusan owner**.
- **Status:** **Terverifikasi di dokumen.** Fase 08 dan 09 diparkir. Jangan mengasumsikan trusted IP atau CSP tersedia, jangan menambah inline script, dan catat pengujian undangan ulang setelah upgrade Better Auth.