# J1: resource Docker test sesuai aturan J

Butir antrean J1, turunan keputusan owner 2026-11-11 butir 5 (aturan J di `PIAGAM.md`). Pertanyaan Codex: `codex/j1-tanya.md`; jawaban: `codex/j1-jawab.md` (model gpt-6.1-terra, effort xhigh): 2 kritis, 3 tinggi, 1 sedang. Semua diterima, dengan keputusan run K108 sampai K113 di bawah.

## Fakta yang diverifikasi di mesin ini (2026-11-11)

- Testcontainers 12.0.3: `TESTCONTAINERS_RYUK_DISABLED === "true"` dibaca saat reaper dibuat (`reaper/reaper.js:33`), jadi cukup diset di `process.env` sebelum container pertama. `stop()` menghapus container beserta volumenya (`removeVolumes: true`, `started-generic-container.js:100`). API `withName`, `withLabels`, `withTmpFs` ada.
- `pgvector/pgvector:pg16` mendeklarasikan `VOLUME /var/lib/postgresql/data`, jadi tanpa mount eksplisit setiap container membuat volume anonim tanpa label. `node:22-alpine` tidak punya `VOLUME`.
- Image dasar semua build (`Dockerfile`, dua fixture egress) adalah `node:22-alpine`. Image itu, `pgvector/pgvector:pg16`, dan `greenmail/standalone:latest` sudah ada di daemon.
- Docker Compose 5.5.0; daemon di VM Colima (Ubuntu 24.04, root `/var/lib/docker`, driver overlayfs). VM dipakai banyak project lain (puluhan network `mis-*`, `mais-*`, `nakama-*`). Subnet egress `10.90.0.0/24` tidak bertabrakan dengan network yang terlihat saat ini.

## Keputusan

| ID | Temuan Codex | Keputusan |
|---|---|---|
| K108 | Kritis 1: `down -v` dan pembersih per label serta awalan tidak membuktikan kepemilikan putaran | Setiap run punya `runId` (`<waktu base36>-<16 hex acak>`), diwariskan lewat `AIDA_TEST_RUN_ID`. Setiap resource berlabel `aida.test=1` dan `aida.test.run=<runId>`. Pembersihan eksplisit: daftar per label `aida.test=1` dan `aida.test.run=<runId>`, periksa ulang awalan nama `aida-test-` tepat sebelum hapus, urutan container lalu network lalu volume lalu tag image (per `repo:tag`, tidak pernah per ID). Tanpa `down -v` dan tanpa sapu semua `aida-test-*`; sisa run lain hanya dilaporkan. Nama project egress persis `aida-test-egress`; kalau sudah ada resource dengan label project itu, berhenti dan lapor (serialisasi). |
| K109 | Kritis 2: volume anonim dan resource implisit | Postgres (Testcontainers dan service `db` egress) memasang tmpfs di `/var/lib/postgresql/data`, jadi tidak ada volume anonim. Volume `uploads_data` diberi label. Container cek ruang memakai `node:22-alpine` dengan `--pull never`. Cache BuildKit dan image dasar tarikan adalah state daemon bersama yang tidak bisa diberi label; test tidak menghapusnya (tanpa `builder prune`). Tafsiran ini dilaporkan ke owner di `LAPORAN.md`. |
| K110 | Tinggi 3: Ryuk | Ryuk dimatikan lewat `TESTCONTAINERS_RYUK_DISABLED=true` di modul helper sebelum container pertama. Setiap resource yang dibuat dicatat ID-nya di ledger `${TMPDIR}/aida-test-runs/<runId>.jsonl`. Setup E2E memulai container di dalam blok yang menjamin `stop()` bila migrasi gagal. |
| K111 | Tinggi 4: tag unik belum menjamin tidak menimpa | Tag `aida-test-egress-<service>:<runId>`. Build terpisah (`compose build`) sesudah semua cek, lalu `up --no-build` dan `run --no-build`. Cek tag membedakan "No such image" dari galat lain (galat lain: berhenti). Lock eksklusif `${TMPDIR}/aida-test-docker.lock` (dibuat dengan O_EXCL, berisi PID dan runId); lock basi tidak dihapus otomatis, tetapi dilaporkan. |
| K112 | Tinggi 5: cek ruang belum membuktikan filesystem yang diukur | Host: `statfs` pada direktori rumah dan akar repo, ambil yang terkecil (disk VM Colima berada di filesystem direktori rumah; tanpa membaca `~/.colima`). VM: container sekali pakai `aida-test-df-<runId>` berlabel menjalankan `df -Pk /` (filesystem overlay di root Docker). Ambang 20 GiB untuk keduanya; gagal membaca atau di bawah ambang: berhenti sebelum build. Di `ubuntu-latest` aturan yang sama berlaku; belum terbukti di CI. |
| K113 | Sedang 6: cakupan lain | Gerbang compose utama (akhir Fase 08, 13, 17) menjadi butir antrean J2, bukan J1. Sebelum `up`, cek tidak ada network yang tumpang tindih dengan `10.90.0.0/24`; kalau ada, berhenti. Direktori log DNS per run (`mkdtemp` di `${TMPDIR}`, lewat variabel `AIDA_TEST_DNS_LOG_DIR`). Suite egress dikeluarkan dari `vitest.integration.config.ts`; replan plan 08-19 harus memperhitungkannya. Jadwal lama `integration.yml` bukan jadwal baru (aturan I). |

## Tugas

Status: tugas 5 selesai (integration exit 0, 94 berkas, 1297 test; bukti di `RUN-LOG.md` putaran J1-4). Tugas 4 selesai sebelumnya (suite egress, unit 876 lolos). Tugas 1 sampai 3 selesai di `5071f65` (typecheck exit 0, `pnpm lint` exit 0, `pnpm test` 52 berkas dan 855 test lolos, termasuk 17 test baru). Orkestrator menjalankan test Docker dengan `AIDA_TEST_RUN_ID` miliknya, lalu `pnpm test:docker-cleanup --run <runId>` (dry run, lalu `--apply`) di akhir putaran.


1. `tests/support/docker-test-resources.ts`: `runId`, label, nama, ledger, `labeledPostgres()` (nama, label, tmpfs), Ryuk mati. Test unit untuk nama, label, dan `runId`.
2. Lima pemanggil `PostgreSqlContainer` memakai helper (integration global setup, E2E global setup dengan perbaikan K110, harness migrasi, `scripts/capture-demo-assets.ts`).
3. `scripts/test-docker-cleanup.mjs`: default dry-run, `--run <runId>` wajib, `--apply` untuk menghapus, `--list-others` hanya melapor. Test unit untuk penyaring (label, run, awalan) dengan keluaran docker tiruan.
4. Suite egress: project `aida-test-egress`, label di semua service, network, volume, dan `build.labels`; `image:` bertag run; lock; cek tag; cek ruang; cek subnet; `compose build`, lalu `up --no-build` dan `run --no-build`; log DNS per run; teardown lewat skrip pembersih. Keluarkan dari include integration.
5. Verifikasi: `pnpm typecheck`, `pnpm lint`, `pnpm test`, lalu `pnpm test:integration` (Testcontainers, tanpa build image) dengan cek bahwa setiap container yang dibuat berlabel dan berawalan, dan tidak ada volume anonim baru. `pnpm test:egress` termasuk butir 0a2, bukan J1.
6. Kritik diff oleh Codex (putaran 2 topik J1), perbaikan, lalu J1 selesai.

## Codex putaran 2 (kritik diff)

Pertanyaan `codex/j1-r2-tanya.md`, jawaban `codex/j1-r2-jawab.md` (model gpt-6.1-terra, effort xhigh): 1 kritis, 4 tinggi, 2 sedang. Putaran 3 (terakhir) untuk topik J1 tersisa.

| ID | Temuan Codex | Keputusan |
|---|---|---|
| K114 | Kritis 1: teardown egress membersihkan semua resource run, termasuk container integrasi dengan run id yang sama, dan tetap berjalan walau lock gagal diambil | Diterima. Pembersih mendapat cakupan awalan tambahan (`--scope`, harus berawalan `aida-test-`); teardown egress hanya membersihkan nama berawalan `aida-test-egress` (container, network `aida-test-egress_*`, volume, tag `aida-test-egress-*`), dan hanya kalau invokasi ini memegang lock. Test unit untuk cakupan dan jalur lock gagal. |
| K115 | Tinggi 2: cek tag lalu build tidak atomik; cek project hanya per label Compose | Diterima sebagian. Jaminan atomik terhadap proses yang tidak mematuhi lock tidak mungkin di Docker; tag memuat 16 hex acak run id, jadi tabrakan hanya terjadi bila run id dipakai ulang dengan sengaja. Batas ini ditulis di sini dan di `LAPORAN.md`. Ditambah: cek nama fisik network `aida-test-egress_egress_internal` dan volume `aida-test-egress_uploads_data`; kalau ada, berhenti. |
| K116 | Tinggi 3: resource implisit dan ledger | Diterima. `up --no-build --pull never` dan `run --rm --pull never`. Tag dicatat `created` hanya sesudah build berhasil; sesudah `up`, container, network, dan volume project dicatat ke ledger. GreenMail tidak punya `VOLUME` (diperiksa 2026-11-11: `null`). Apakah build menarik atau memperbarui image dasar diukur di 0a2 (daftar image sebelum dan sesudah) dan dilaporkan. K109 tetap tafsiran yang menunggu owner. |
| K117 | Tinggi 4: jalur gagal setup dan pelaporan sisa | Diterima. Helper menghentikan container bila pencatatan ledger gagal sesudah start; global setup integrasi menghentikan container bila migrasi gagal; setup E2E membuat direktori uploads sebelum container. Pembersih: inspeksi "No such" berarti sudah hilang; galat inspeksi lain dihitung gagal (exit 1). |
| K118 | Tinggi 5: cek ruang belum membuktikan lokasi | Diterima. Ruang VM diukur di dua tempat dan diambil yang terkecil: `df -Pk /` di container (penyimpanan snapshot image) dan `df -Pk` pada `DockerRootDir` dari `docker info`, di-bind-mount read-only ke container sekali pakai. Gagal membaca salah satu: berhenti. Sisi host: filesystem direktori rumah dan repo; letak disk VM Colima di bawah direktori rumah adalah bawaan Colima dan tidak diverifikasi karena `~/.colima` tidak boleh dibaca (batas tertulis). |
| K119 | Sedang 6: test belum membuktikan beberapa klaim | Diterima. Test df dua baris dengan kolom rusak; `hostFreeBytes` dengan `statfs` yang bisa disuntik dan test nilai terkecil; bukti empiris pewarisan run id tanpa id dari orkestrator (satu berkas test migrasi, ledger diperiksa). |
| K120 | Sedang 7: socket di `~/.colima` berpotensi bertentangan dengan bunyi aturan J | Tidak diterima sebagai larangan. Aturan B (disetujui owner) mewajibkan `docker info` setiap putaran, dan perintah itu sendiri tersambung ke socket yang sama di `~/.colima`; bacaan harfiah akan melarang aturan B. Run tetap hanya tersambung ke socket, tanpa membaca, membuat, mengubah, atau menghapus berkas di sana. Dilaporkan ke owner sebagai tafsiran yang perlu dikonfirmasi (`LAPORAN.md` bagian 3). |

### Tugas putaran perbaikan

7. K114 sampai K119 di kode dan test unit.
8. Bukti: typecheck, lint, unit; satu berkas test migrasi tanpa `AIDA_TEST_RUN_ID` (pewarisan run id); `pnpm test:integration` penuh dengan run id orkestrator; pembersih menemukan 0 sisa.
Status: tugas 7 dan 8 selesai (`pnpm typecheck` dan `pnpm lint` exit 0; `pnpm test` 53 berkas, 881 test; satu berkas test migrasi tanpa `AIDA_TEST_RUN_ID` exit 0, 39 test, satu ledger untuk proses global setup dan worker; `pnpm test:integration` exit 0, 94 berkas, 1297 test, 4 container, 0 sisa, daftar container dan volume tidak berubah).

9. Codex putaran 3 (terakhir) atas perbaikan. Kalau masih ada temuan tinggi: perbaiki yang jelas, catat sisanya sebagai batas, dan laporkan ke owner; tidak ada putaran 4.

## Codex putaran 3 (terakhir)

Pertanyaan `codex/j1-r3-tanya.md`, jawaban `codex/j1-r3-jawab.md` (model gpt-6.1-terra, effort xhigh): 1 kritis, 2 tinggi, 1 sedang. Batas 3 putaran untuk topik J1 sudah habis.

Pesan galat Docker yang sebenarnya di daemon ini (diperiksa 2026-11-11 dengan nama yang tidak ada):

- container: `Error response from daemon: No such container: <nama>`
- network: `Error response from daemon: network <nama> not found`
- volume: `Error response from daemon: get <nama>: no such volume`
- image: `Error response from daemon: No such image: <repo:tag>`
- socket mati: `failed to connect to the docker API at unix:///...: ... connect: no such file or directory`

| ID | Temuan Codex | Keputusan |
|---|---|---|
| K121 | Kritis 1: lock diambil sebelum preflight; kalau preflight berhenti karena resource yang sudah ada (misalnya tag dengan label run yang sama), `afterAll` tetap membersihkan dan bisa menghapus resource itu | Diterima. Teardown egress hanya berjalan kalau invokasi ini sudah memulai `compose build`. Pembersihan memakai daftar tepat milik invokasi ini, bukan awalan: tag dari config, nama fisik network dan volume dari config (yang sudah dibuktikan belum ada saat preflight), dan ID container project dari `compose ps -a` sesudah lock dipegang. Setiap ref diinspeksi ulang (label test, label run, awalan) sebelum dihapus. |
| K122 | Tinggi 2: awalan `aida-test-egress` juga cocok dengan `aida-test-egress-other_*` | Diterima, tertutup oleh K121 (daftar tepat). Test unit baru: resource project lain berawalan sama dan berlabel run sama tidak disentuh. |
| K123 | Tinggi 3: pola `no such` terlalu luas; galat socket "no such file or directory" ikut dianggap hilang | Diterima. Ketiadaan dikenali hanya dari pesan daemon khusus jenis yang memuat ref itu (daftar di atas); galat lain, termasuk socket, dihitung gagal. Berlaku untuk pembersih, `assertNamesAbsent`, dan `tagState`. Test unit memakai pesan nyata di atas, termasuk pesan socket mati. |
| K124 | Sedang 4: ledger dan bukti K116, K118 | Diterima. Sesudah `up`, network dan volume dicatat `created` hanya bila inspeksi berhasil; kode keluar `compose ps` diperiksa; container probe ruang dan negative-control dicatat `planned`. `run` sudah memakai `--pull never` (keputusan K116 memang tidak menyebut `--no-build` untuk `run`; image negative-control tidak di-build). Batas K118 sisi host dan K109 ditulis di `LAPORAN.md` bagian 3. |

### Tugas penutupan

10. K121 sampai K124 di kode dan test unit; typecheck, lint, unit, dan integration.
Status: tugas 10 selesai (`pnpm typecheck` dan `pnpm lint` exit 0; `pnpm test` 53 berkas, 887 test; `pnpm test:integration` exit 0, 94 berkas, 1297 test; 0 sisa; daftar container dan volume tidak berubah).

11. Karena putaran Codex habis, perubahan sesudah putaran 3 direview oleh reviewer independen (subagen, tanpa konteks percakapan) sebelum J1 ditutup, mengikuti praktik K39 Fase 12. Temuan yang jelas diperbaiki; sisanya dicatat sebagai batas dan dilaporkan.
12. J1 ditutup dengan batas tertulis (K109, K115, K118, K120) dan bukti egress menyusul di 0a2.
