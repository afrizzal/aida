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
