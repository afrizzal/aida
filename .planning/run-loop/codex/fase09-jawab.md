Rekomendasi utama: **jangan menutup AIDA-33 atau AIDA-35 hanya dengan test komponen**. Keduanya mensyaratkan bukti stack sungguhan; jika bukti itu terhalang aturan Docker, implementasi dan test lain tetap bisa maju, tetapi acceptance terkait harus tetap terbuka. Keputusan teknis di bawah adalah pendapat untuk dipertimbangkan; **keputusan owner** saya tandai secara eksplisit.

1. **Backup terjadwal — AIDA-33**

   **Rekomendasi:** pilih service backup dalam compose, berbasis image yang menyediakan `pg_dump`, dengan jadwal dan retensi yang dikonfigurasi operator. Gunakan volume backup terpisah, direktori sementara per run, manifest/status, lalu publikasi set secara atomik hanya setelah dump dan arsip tervalidasi. Default contoh: harian, simpan 7 set berhasil, dan ada sakelar off. Catat kegagalan secara persisten dan tampilkan ke admin; kegagalan menulis status sendiri juga harus terlihat melalui log dan pemeriksaan kesehatan operasional. Ini pilihan teknis, bukan angka yang diwajibkan requirement.

   Untuk konsistensi, gunakan **kunci file yang immutable**, tulis file lengkap sebelum referensi DB dikomit, dan tunda penghapusan fisik selama backup aktif. Ambil daftar referensi dari snapshot DB yang sama dengan dump, lalu arsipkan file tersebut, termasuk logo yang direferensikan snapshot. File hilang atau checksum tidak cocok menggagalkan seluruh set. Koordinasi penghapusan harus tahan crash dan berlaku untuk semua jalur tulis/hapus; sekadar “dump lalu tar semua file” tidak cukup. Alternatif snapshot filesystem bersama DB boleh dipilih hanya jika mekanisme dan batas konsistensinya dibuktikan.

   **Risiko:** protokol lintas DB/filesystem mudah berlubang pada rollback, crash, backup bersamaan, dan pembersihan file yatim; backup di disk yang sama tidak melindungi dari kehilangan server. Dokumentasikan salinan off-host sebagai tugas operator, izin akses, kapasitas, zona waktu, restore, dan kebutuhan kunci enkripsi aplikasi.

   **Terverifikasi di kode:** penyimpanan lokal memakai `writeFile` dan `unlink`; public intake menyimpan file sebelum membuat record; backup sekarang menjalankan dump dan tar secara terpisah ([storage](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/src/lib/attachments/local-file-storage.ts), [intake](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/src/app/api/public/intake/route.ts), [backup.sh](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/scripts/backup.sh)). **Belum terverifikasi:** seluruh jalur mutasi dan kelayakan teknis service yang diusulkan.

2. **Test backup/restore — AIDA-33 dan 38**

   **Rekomendasi:** test permanen dengan Testcontainers dan direktori sementara untuk menguji snapshot, add/replace/delete yang disinkronkan pada titik tertentu, kegagalan tiap komponen, retensi, dan perbandingan isi setelah restore. Itu bukti penting, tetapi **belum cukup sendirian** untuk frasa acceptance “restores … into an isolated stack”. Tambahkan bukti restore menggunakan stack compose terisolasi dan artefak produksi, termasuk volume dan wiring aktual.

   **Risiko:** project compose baru belum diizinkan secara jelas. Penggunaan nama `aida` pun tidak otomatis aman dari race atau resource milik proses lain. **Keputusan owner:** pertanyaan izin project test tetap terbuka; sampai ada cara yang jelas sah dan aman, tandai bukti stack sebagai *blocked/not run*, bukan passed. Testcontainers yang diwajibkan piagam tetap mengikuti pengecualian run yang disebut pengguna.

   **Terverifikasi di dokumen:** acceptance dan temuan race Fase 08 tercantum di [REQUIREMENTS.md](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/.planning/REQUIREMENTS.md:23) dan [08-REVIEWS.md](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/.planning/phases/08-security-hardening/08-REVIEWS.md).

3. **Logo — AIDA-34**

   **Rekomendasi:** simpan file immutable di volume uploads, referensi per organisasi di setting, dan masukkan referensi itu dalam protokol backup. Izinkan PNG, JPEG, WebP berdasarkan sniffing byte; tolak SVG; misalnya maksimum 1 MiB dan batasi dimensi/decode. Admin saja boleh upload/hapus. Route publik harus tercantum eksplisit di `PUBLIC_PREFIXES`, hanya menyajikan logo yang benar-benar dirujuk, menetapkan MIME, `nosniff`, dan cache dengan URL berversi; fallback nama tetap ada. Sidebar dapat memakai area logo terbatas dengan `object-contain`, nama tetap terbaca, serta fallback Sparkles.

   Untuk `/request`, pertahankan resolusi organisasi yang digunakan intake sampai ada keputusan tenancy lebih luas. Untuk status valid, gunakan organisasi tiket; untuk token tidak valid, gunakan fallback generik agar tidak mengungkap organisasi. Uji isolasi organisasi dan cache saat replace/hapus.

   **Risiko:** design system menyebut Sparkles sebagai ikon sidebar dan melarang penggantian kecuali rebranding; memperkenalkan logo adalah perluasan yang diminta requirement, tetapi pola itu perlu catatan migrasi. **Terverifikasi di kode/dokumen:** status saat ini memilih `findFirst()` sebelum mencari tiket; limiter saat ini `count` lalu `create` ([status page](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/src/app/(public)/status/[token]/page.tsx), [limiter](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/src/lib/rate-limit/check-rate-limit.ts), [design system](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/.planning/DESIGN-SYSTEM.md)).

   Untuk throttle, **jangan mengklaim limiter sekarang tahan spoofing atau atomik**. Pakai pembatas yang atomik dan identitas konservatif di batas tepercaya, dengan perilaku gagal tertutup yang diuji; bila solusi aman memerlukan keputusan yang belum selesai di Fase 08, parkir bagian itu alih-alih menduplikasi desain keamanan yang belum direview. **Belum terverifikasi:** desain pembatas baru dan dampak bebannya.

4. **Password URL — AIDA-35**

   **Rekomendasi:** pilih **(c) dengan validasi eksplisit**: compose menerima `POSTGRES_PASSWORD` mentah untuk DB dan `DATABASE_URL` yang sudah di-encode untuk migrate/app/worker. Sediakan generator lokal yang menghasilkan keduanya dari satu password, plus validasi bahwa komponen yang didekode cocok; tolak konfigurasi yang tidak konsisten. Encode juga user dan nama database sesuai konteks URL. Ini memenuhi syarat bahwa URL benar sudah terlihat pada `compose config`; entrypoint atau perakitan di Prisma saja tidak membuktikan syarat tersebut.

   Test menangkap output `compose config` **dalam memori**, parse URL tiap service, bandingkan komponen yang didekode, dan hanya laporkan nama service serta pass/fail; jangan tampilkan output, error mentah, trace, atau variabel berisi password. Boot stack dengan password sintetis yang sama tetap wajib; buktikan koneksi worker secara positif, bukan hanya proses hidup.

   **Risiko:** dua variabel dapat menyimpang; format `.env`, karakter `$`, newline, dan quoting perlu test. Audit skrip backup/restore dan compose egress agar tidak diam-diam memakai kontrak lama. **Terverifikasi di kode:** tiga service compose interpolasi password mentah; egress memakai URL fixture sendiri ([docker-compose.yml](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/docker-compose.yml), [egress compose](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/docker-compose.egress-test.yml)). **Belum terverifikasi:** kompatibilitas lengkap generator dan semua pemanggil.

5. **Satu `<h1>` — AIDA-36**

   **Rekomendasi:** halaman memegang `<h1>` dalam `<main>`; judul top bar menjadi teks biasa dengan tampilan tetap. Tambahkan judul halaman yang belum punya, termasuk keadaan loading/error yang benar-benar dirender, dan uji setiap route app, termasuk route dinamis dengan fixture. Ini memberi judul kontekstual pada landmark utama.

   **Risiko:** judul top bar bisa berbeda dari judul halaman atau hilang pada state khusus. **Terverifikasi di kode:** top bar dan halaman app sama-sama merender heading; dua `<h1>` dalam file status publik berada pada **cabang berbeda**, sehingga bukan bukti dua heading bersamaan ([status page](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/src/app/(public)/status/[token]/page.tsx)). **Belum terverifikasi:** inventaris setiap state route.

6. **Guard seed dan demo — AIDA-37**

   **Rekomendasi:** ikuti definisi acceptance secara literal: tenant ada bila ada organisasi **atau** user; abaikan empat kategori infrastruktur yang disebut requirement. Seed CLI menolak sebelum tulisan apa pun bila tenant ada. Demo boot: kosong → seed; tepat organisasi demo dan semua user identitas demo → skip; selain itu → refuse. Identifikasi menggunakan identitas stabil dan konfigurasi yang divalidasi, bukan sekadar jumlah tiket atau nama tampilan. Uji konfigurasi identitas yang berubah dan state parsial; jangan menyebut state parsial sebagai seed sukses.

   Koordinasikan pemeriksaan dan penulisan dengan bootstrap `/setup`, bootstrap environment, dan proses demo lain; guard berupa dua `count` tanpa perlindungan tetap punya race. Test hitung semua tabel dengan inventaris skema dan snapshot yang konsisten; hentikan heartbeat atau kendalikan penulis infrastruktur agar perbandingan bermakna. Tambahkan pemeriksaan stdout/stderr dan error untuk password.

   **Terverifikasi di kode:** `bootstrapFromEnv()` berjalan sebelum demo boot dan dapat menulis; seed memanggil pembuatan identitas sebelum guard tiket ([instrumentation](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/src/instrumentation.ts), [seed](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/prisma/seed.ts)). **Risiko/belum terverifikasi:** apakah semua jalur pembuatan tenant bisa berbagi protokol penguncian; jika tidak, klaim bebas race tidak layak.

7. **Bukti Fase 1 dan STATE — AIDA-39/41**

   **Rekomendasi:** petakan setiap kriteria Fase 1 ke SUMMARY/UAT historis dan bukti yang masih relevan; jalankan ulang cek yang tersedia pada commit bernama, catat command, hasil, dan keterbatasannya. Pisahkan “UAT historis tercatat pass” dari “diverifikasi ulang sekarang”; cek manusia yang belum pernah dibuktikan tetap terbuka. Audit setiap todo/caveat STATE terhadap kode dan dokumen sumber, termasuk item owner.

   **Risiko:** bukti sekarang tidak membuktikan keadaan persis saat fase dikirim. **Terverifikasi di dokumen:** UAT historis mencatat sembilan pass, dan folder Fase 1 tidak memiliki verification ([01-UAT.md](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/.planning/milestones/v1.0.0-phases/01-foundation/01-UAT.md)). **Belum terverifikasi:** commit historis tepat untuk setiap hasil; ekspor ini tidak memiliki riwayat git.

8. **SEED-010 — AIDA-40**

   **Rekomendasi:** installer diuji dengan fixture rilis lokal dan executable `curl`/`docker` palsu yang merekam argumen serta menolak panggilan jaringan tak terduga; uji instalasi, upgrade, backup/restore, error, permission, dan rerun tanpa menimpa rahasia. Password DB dapat berupa random hex yang aman dalam URL; tetap uji kontrak AIDA-35 dengan karakter reserved secara terpisah. Pastikan paket rilis memuat **semua** berkas yang dirujuk compose, termasuk konteks build, Caddyfile dan skrip, atau gunakan image rilis yang benar-benar tersedia.

   `check-version` dapat disiapkan dan diuji dengan fixture base/head, tetapi **keputusan owner:** nomor baseline dan kebijakan bump sebelum rilis. Jangan menganggap `1.0.0` sudah dirilis. **Keputusan owner:** handle/tim sah untuk CODEOWNERS dan akun/konfigurasi Repobeats; jangan memasukkan nama orang untuk melewati piagam. Widget pihak ketiga juga perlu keputusan owner tentang eksposur pembaca dan klaim privasi; catat item manual bila bergantung akun. Uji clean VM tetap manual bila belum ada bukti.

   **Terverifikasi di dokumen/kode:** seed menginginkan unduhan rilis dan verifikasi clean VM; compose sekarang memakai `build:`, dan package belum punya `version` ([SEED-010](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/.planning/seeds/SEED-010-repo-health-installer-version-gate.md), [package.json](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/package.json)). **Belum terverifikasi:** bentuk aset rilis yang nantinya tersedia.

9. **Benturan Fase 08**

   **Rekomendasi:** catat kontrak akhir Fase 09 per berkas bersama dan daftar plan 08 yang harus direbase/review ulang: non-root dan izin volume backup/logo, CSP dan `img-src`, identitas throttle, perubahan URL serta egress. Pertahankan temuan review siklus 3 sebagai syarat terbuka; jangan mengeksekusi plan 08 lama secara mekanis atau menganggapnya sudah aman.

   **Risiko:** Fase 09 dapat memperkenalkan route, service, volume, dan akses jaringan yang tidak tercakup bukti 08. **Terverifikasi di dokumen:** Fase 08 diparkir dengan empat temuan HIGH pada siklus terakhir ([08-REVIEWS.md](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/.planning/phases/08-security-hardening/08-REVIEWS.md)).

10. **Pemecahan plan dan wave**

   **Rekomendasi:** Wave 1: kontrak URL/config; guard seed/demo; audit STATE dan bukti Fase 1; kerangka repo-health. Wave 2: protokol file immutable dan logo; backup/scheduler setelah kontrak URL dan file disepakati; heading dan inventaris route. Wave 3: restore dan bukti stack, installer terhadap artefak final, lalu gate fase dan UI checklist. Pisahkan plan yang blocked owner dari pekerjaan independen.

   **Bukti mandiri:** masing-masing plan memiliki test perilaku dan catatan hasil; plan stack memiliki matriks `passed/failed/blocked` yang menunjuk hasil sumber. **Risiko:** wave hanyalah urutan usulan; dependensi tepat dan kelayakan paralel **belum terverifikasi**.

11. **Yang mudah terlewat**

   **Terverifikasi di kode:** skrip restore memakai operasi destruktif dan seed saat ini menyarankan `docker compose down -v`; instruksi pemulihan harus menghindari teardown luas pada VM bersama. Compose juga memuat `APP_ENCRYPTION_KEY`, sehingga restore data terenkripsi perlu mempertimbangkan pemulihan kunci tersebut ([restore.sh](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/scripts/restore.sh), [docker-compose.yml](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.yRqne73ARE/docker-compose.yml)).

   **Risiko/belum terverifikasi:** restore harus memvalidasi manifest dan path arsip sebelum menyentuh target, menghentikan penulis yang relevan, dan menjelaskan perilaku saat restore hanya separuh berhasil. Backup dan log dapat berisi data tenant; status admin tidak boleh membocorkan isi atau rahasia. Gate `test:egress` juga memerlukan guard resource sebagaimana temuan review 08; hasil yang terhalang tidak boleh menyamarkan kegagalan test lain.