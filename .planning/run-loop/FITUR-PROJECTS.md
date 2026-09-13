# Daftar fitur modul Projects

Sumbernya README publik gr8r-studio, nama halamannya, dan perilaku yang tampak di demo. Ini daftar perilaku, bukan spesifikasi visual. Di sana semuanya simulasi di browser. Di AIDA semuanya nyata: tersimpan di Postgres, multi-pengguna, ter-scope organisasi, memakai login Better Auth, dan punya test.

| Area | Perilaku | Bentuk di AIDA |
|---|---|---|
| Home | Ringkasan kerja: tugas mendatang, proyek, aktivitas | Halaman utama yang bisa dipilih di preferensi, ikut menampilkan tiket yang ditugaskan |
| Inbox dan Notifications | Kategori, filter belum dibaca, panel detail, filter notifikasi | Satu pusat notifikasi dari SEED-008. "Inbox" di AIDA tetap berarti tiket |
| My Tasks | Tugas milik sendiri lintas proyek, tampilan list dan lainnya | Halaman tersendiri |
| Projects | Grid dan daftar proyek, warna, urutan, arsip, proyek privat, anggota proyek | Halaman daftar dan detail, dengan overview dan progres |
| Task | Status backlog, todo, in progress, review, done. Assignee, tenggat, prioritas, label, subtask, komentar, lampiran, riwayat. Terbuka di drawer atau halaman penuh | Memakai pipeline lampiran dan markdown tersanitasi yang sudah ada |
| Board | Kolom per status, drag and drop, kolom bisa dilipat | Wajib ada alternatif keyboard |
| List | Kelompok yang bisa dilipat, composer tambah cepat, pilih massal | |
| Table | Kolom, edit langsung di sel | |
| Calendar | Tampilan bulan, pindah tanggal | |
| Timeline | Zoom, pengelompokan, geser jadwal | |
| Files | Grid dan daftar lampiran proyek | |
| Tampilan tersimpan | Pilihan tampilan per proyek | Tersimpan per pengguna, sejalan dengan SEED-005 |
| Command palette dan keyboard | Pencarian perintah, shortcut, menu konteks | Satu mekanisme dengan SEED-006 |
| Search | Hasil per kategori | Postgres FTS, mencakup task, proyek, orang, dan tiket |
| Members dan Teams | Daftar anggota, peran, undangan, tim | Anggota organisasi dari SEED-007, ditambah model Team |
| Activity | Linimasa aksi | Satu sumber untuk feed proyek dan riwayat task |
| Favorites dan Archive | Menandai dan mengarsipkan | |
| Onboarding | Wizard workspace, proyek pertama, template, undangan | Melengkapi `/setup`, tanpa menggantinya |
| Settings | Tema, aksen, kepadatan, ukuran sidebar, awal minggu, format tanggal, zona waktu, gerak, halaman awal, cara membuka task, ganti password | Preferensi per pengguna lewat token design system. Aksen tidak boleh melanggar aturan warna brand |
| Keadaan layar | Kosong, memuat, galat, responsif | Mengikuti pola AIDA |

Tidak termasuk: halaman design system, pilihan bahasa UI (di luar scope AIDA), dan data contoh.

Yang khas AIDA dan harus ada: tiket bisa menjadi task dan keduanya saling tertaut, status task kembali sebagai catatan internal tiket, dan saran AI selalu lewat gerbang manusia.

## Hasil penelusuran demo (2026-11-07, butir 0c)

Cara: Chromium headless lewat `@playwright/test` milik repo. Yang dibaca hanya yang dilihat pengunjung: judul, heading, nama aksesibel kontrol, dan potongan teks tampak. Bundle JS dan CSS tidak dibaca. Screenshot hanya disimpan di scratchpad sesi, tidak di repo. Semua perilaku di bawah ditulis ulang dengan kata sendiri, tanpa teks UI, data contoh, warna, atau tata letak dari demo. Navigasi demo berbasis state, satu URL untuk semua halaman.

### Perilaku yang belum tercatat di tabel atas

| Area | Perilaku | Bentuk di AIDA | Requirement |
|---|---|---|---|
| Home | Angka ringkas: proyek aktif dan yang berisiko, task terbuka dan yang milik saya, selesai minggu ini, terlambat. Task saya dalam tab mendatang, terlambat, selesai, bisa dicentang selesai di tempat. Tabel progres proyek. Tenggat mendatang dikelompokkan per hari. Aktivitas terbaru. Aksi cepat undang, proyek baru, task baru | Diperluas di Home, ditambah tiket yang ditugaskan | AIDA-81 |
| Overview workspace | Portofolio proyek, task per status, beban kerja per orang, milestone mendatang | Halaman tersendiri | AIDA-107 |
| Proyek | Ikon, warna, deskripsi, status proyek (misalnya perencanaan, berjalan, berisiko), tenggat, progres dari task, anggota | Kolom proyek | AIDA-100 |
| Proyek | Aksi: ubah, duplikat, salin link, ubah urutan di sidebar, arsip, hapus | Hapus dengan konfirmasi dan audit | AIDA-104 |
| Milestone | Milestone bertanggal per proyek, tampil di Overview dan Timeline | Model baru | AIDA-105 |
| Halaman proyek | Tab Overview, Board, List, Table, Calendar, Timeline, Files, Activity. Tambah anggota, pengaturan proyek, simpan tampilan | Halaman detail | AIDA-72, AIDA-80 |
| Daftar proyek | Cari, filter status, urutkan, tampilan grid, list, dan tabel | Halaman daftar | AIDA-72 |
| Task | Kunci berawalan proyek yang unik, tanggal mulai, estimasi waktu, label, deskripsi teks kaya (tebal, miring, daftar, heading, link) | Teks kaya lewat markdown tersanitasi | AIDA-101 |
| Task | Pengulangan: task berulang harian, mingguan, atau bulanan | Kejadian berikutnya dibuat saat selesai | AIDA-102 |
| Task | Aksi: duplikat, pindah proyek, favorit, salin link, buka layar penuh, arsip dan pulihkan, hapus | Hapus dengan audit | AIDA-103 |
| Tasks workspace | Semua task lintas proyek dalam list, board, atau tabel, dengan pengelompokan dan pilihan kolom. Calendar dan Timeline juga ada di level workspace | Mengikuti privasi proyek | AIDA-106 |
| Board | Opsi kolom, tambah cepat per kolom | | AIDA-75 |
| Table | Pilih kolom yang tampil, pengelompokan | | AIDA-76 |
| Calendar | Tampilan bulan dan minggu, tambah task di satu hari, hari ini, maju, mundur | | AIDA-77 |
| Notifikasi | Tab per jenis (mention, penugasan, komentar, pembaruan), tandai semua dibaca, toggle dibaca, peringatan proyek berisiko | Satu pusat notifikasi | AIDA-83 |
| Members | Peran owner, admin, member, guest. Cari, filter per peran, tab tim | Halaman Members | AIDA-87 |
| Undangan | Beberapa email sekaligus, dengan peran dan tim, plus salin link undangan | Memperluas AIDA-42 | AIDA-87 |
| Peran dan izin | Guest hanya melihat yang dibagikan kepadanya. Pengaturan peran mana yang boleh membuat proyek dan mengundang guest | Guest tanpa akses tiket | AIDA-110 |
| Tim | Halaman tim berisi proyek, task terbuka, dan anggota. Buat dan ubah tim | | AIDA-109 |
| Activity | Filter per jenis (status, komentar, proyek) dan per orang | | AIDA-84 |
| Favorit dan arsip | Halaman favorit untuk proyek dan task. Halaman arsip dengan tab task dan proyek, beserta keadaan kosong | | AIDA-108 |
| Workspace | Pindah antar workspace yang diikuti dan membuat workspace baru | Data selalu mengikuti workspace aktif | AIDA-111 |
| Profil | Nama, jabatan, warna avatar | Email tetap baca saja | AIDA-112 |
| Keamanan akun | Daftar sesi aktif dan keluar dari sesi lain. Two-factor authentication | TOTP lokal tanpa egress | AIDA-113, AIDA-114 |
| Preferensi | Halaman awal, zona waktu, tab awal saat membuka proyek | | AIDA-98 |
| Palette | Buat task dan proyek dengan satu tombol, cari, pindah workspace, ganti tema, chord navigasi, item terbaru | | AIDA-86 |
| Bantuan | Daftar shortcut, buka palette, ulangi onboarding | | AIDA-86, AIDA-88 |
| Keadaan layar | Halaman tidak ditemukan dan pemberitahuan offline | | AIDA-90 |

### Ada di demo, tidak dibangun

| Perilaku | Alasan |
|---|---|
| Paket, pembayaran, invoice, dan label paket workspace | Billing di luar scope `PROJECT.md` |
| Pilihan bahasa UI | Di luar scope, sudah tercatat di atas |
| Push notification browser | Web Push butuh layanan push vendor browser, egress pihak ketiga yang dilarang prinsip privacy-first. Email dan in-app tetap ada |
| Hapus workspace | `AuditEvent` append-only di level database, dan reset destruktif memang tidak ada. Arsip proyek tetap ada |
| Link publik untuk membagikan proyek ke luar workspace | Data tidak terekspos tanpa login. Berbagi di AIDA berarti salin link internal dan menambah anggota. Owner bisa meninjau ulang |
| Halaman design system, simulasi keadaan sistem, simulasi offline, link rusak sengaja, reset data demo | Alat khusus demo |
