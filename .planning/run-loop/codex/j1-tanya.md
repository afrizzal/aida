# J1: resource Docker untuk test sesuai aturan J (satu putaran pendapat)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Batas mengikat

Aturan J di `.planning/run-loop/PIAGAM.md` (owner, 2026-11-11), kata per kata:

- nama project test berawalan aida-test- BUKAN aida- (cocok dengan aida-dev-db)
- ganti nama aida-egress-test menjadi aida-test-egress
- semua resource test berlabel aida.test=1
- pembersihan hanya yang cocok label DAN awalan aida-test-
- dilarang menyentuh project aida, aida-dev-db, smartcv-*, atau project lain mana pun
- dilarang docker system prune, docker volume prune, colima delete, dan apa pun di ~/.colima
- tag image test unik, misalnya aida-test:<sha>; dilarang menimpa tag yang sudah ada
- sebelum build image: cek ruang kosong di host dan VM Colima; jika di bawah 20 GB, berhenti dan lapor

Juga berlaku: aturan H (hapus sisa container test milik putaran itu saja), aturan I (CI hanya `ubuntu-latest`, tanpa jadwal baru), Larangan, dan tafsiran ketat J di piagam (container `aida-dev-db` yang sedang jalan tidak disentuh lagi). VM Docker dipakai bersama project lain.

## Fakta yang sudah diverifikasi orkestrator

- Testcontainers `12.0.3` (`testcontainers`, `@testcontainers/postgresql`). Lima tempat memanggil `new PostgreSqlContainer("pgvector/pgvector:pg16")` tanpa `withName` dan tanpa `withLabels`: `tests/integration/global-setup.ts`, `tests/e2e/global-setup.ts`, `tests/support/migration-harness.ts` (dipakai tiga test migrasi), `scripts/capture-demo-assets.ts`. Semua menghentikan container di teardown. Tidak ada pengaturan `TESTCONTAINERS_*`, jadi reaper Ryuk aktif dan tidak berlabel `aida.test=1`.
- `tests/integration/egress-isolation.test.ts`: `COMPOSE_PROJECT = "aida-egress-test"`, `beforeAll` menjalankan `up -d --build` (batas 480 detik), `afterAll` menjalankan `down -v --remove-orphans`. Juga memakai `docker compose run`.
- `docker-compose.egress-test.yml`: network `egress_internal` (`internal: true`, subnet tetap `10.90.0.0/24`), volume bernama `uploads_data`, bind mount `.dns-log`. Service hasil build: `dns-logger`, `stub-llm`, `migrate`, `app`, `worker`, `runner`, tanpa `image:`, jadi nama image bawaan project-service. Image tarikan: `pgvector/pgvector:pg16`, `greenmail/standalone:latest`, `node:22-alpine` (dipakai project lain juga, tidak boleh dihapus).
- `vitest.integration.config.ts` meng-include `tests/integration/**/*.test.ts`, jadi suite egress ikut terjaring `pnpm test:integration` (gerbang selama ini memakai `--exclude`). Plan 08-19 (Fase 8, belum dieksekusi) memindahkannya keluar.

## Rancangan yang diusulkan

1. `tests/support/docker-test-resources.ts`: `TEST_LABELS = { "aida.test": "1" }`; `testResourceName(kind)` menghasilkan `aida-test-<kind>-<runId>` (`runId` = waktu base36 plus 4 hex acak); `labeledPostgres(...)` membungkus `PostgreSqlContainer` dengan `.withName()` dan `.withLabels()`. Kelima tempat di atas memakainya.
2. Ryuk dimatikan (`TESTCONTAINERS_RYUK_DISABLED=true`, diset sebelum container pertama dibuat). Alasannya: container Ryuk adalah resource test tanpa label dan tanpa awalan. Penggantinya: teardown yang sudah ada, ditambah skrip pembersih (butir 3) untuk sisa setelah crash.
3. `scripts/test-docker-cleanup.mjs`: mendaftar container, network, volume, dan image dengan `--filter label=aida.test=1`, lalu hanya menghapus yang namanya berawalan `aida-test-` (untuk image: repository berawalan `aida-test`). Default dry-run; `--apply` untuk menghapus. Tanpa prune. Dipakai orkestrator di akhir putaran (aturan H).
4. Suite egress: project `aida-test-egress`; label `aida.test: "1"` pada setiap service, `build.labels`, network, dan volume; setiap service hasil build diberi `image: aida-test-egress-<service>:${AIDA_TEST_TAG}` dengan tag `<sha pendek>-<runId>`. Sebelum build: pastikan tag belum ada (`docker image inspect` harus gagal), lalu cek ruang: host lewat `fs.statfs` pada akar repo, VM lewat container sekali pakai berlabel dan berawalan yang menjalankan `df -Pk /` dengan image `pgvector/pgvector:pg16` yang sudah ada. Di bawah 20 GiB (dibaca ketat sebagai GiB): lempar galat "ruang tidak cukup" sebelum build. `afterAll`: `down -v --remove-orphans`, lalu hapus image bertag kita lewat skrip butir 3.
5. Migrasi dev (bukan test, prosedur orkestrator): container sekali pakai `aida-test-devdb-<runId>` berlabel, di port kosong selain 55432.

## Pertanyaan

1. Mematikan Ryuk atau mempertahankannya? Kalau dipertahankan, bagaimana memenuhi "semua resource test berlabel aida.test=1"? Kalau dimatikan, risiko apa yang tersisa dan apakah skrip butir 3 cukup?
2. Apakah `docker compose -p aida-test-egress down -v --remove-orphans` memenuhi "pembersihan hanya yang cocok label DAN awalan", atau harus diganti penghapusan eksplisit yang memeriksa label dan nama tiap resource?
3. Cek ruang VM lewat container sekali pakai: masuk akal, atau ada cara yang lebih baik tanpa menyentuh `~/.colima`? Apakah sama baiknya di runner `ubuntu-latest`?
4. Tag unik dan larangan menimpa: adakah celah (misalnya `compose build` yang tetap menimpa tag, atau `compose run` yang membangun ulang)?
5. Adakah resource Docker yang dibuat test atau skrip yang terlewat dari inventaris di atas, atau bagian rancangan yang melanggar aturan J, H, atau Larangan?

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat, lalu satu paragraf: apakah rancangan ini aman dikerjakan. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 900 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
