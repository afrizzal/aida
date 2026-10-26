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

Status: tugas 1 sampai 3 selesai di `5071f65` (typecheck exit 0, `pnpm lint` exit 0, `pnpm test` 52 berkas dan 855 test lolos, termasuk 17 test baru). Orkestrator menjalankan test Docker dengan `AIDA_TEST_RUN_ID` miliknya, lalu `pnpm test:docker-cleanup --run <runId>` (dry run, lalu `--apply`) di akhir putaran.


1. `tests/support/docker-test-resources.ts`: `runId`, label, nama, ledger, `labeledPostgres()` (nama, label, tmpfs), Ryuk mati. Test unit untuk nama, label, dan `runId`.
2. Lima pemanggil `PostgreSqlContainer` memakai helper (integration global setup, E2E global setup dengan perbaikan K110, harness migrasi, `scripts/capture-demo-assets.ts`).
3. `scripts/test-docker-cleanup.mjs`: default dry-run, `--run <runId>` wajib, `--apply` untuk menghapus, `--list-others` hanya melapor. Test unit untuk penyaring (label, run, awalan) dengan keluaran docker tiruan.
4. Suite egress: project `aida-test-egress`, label di semua service, network, volume, dan `build.labels`; `image:` bertag run; lock; cek tag; cek ruang; cek subnet; `compose build`, lalu `up --no-build` dan `run --no-build`; log DNS per run; teardown lewat skrip pembersih. Keluarkan dari include integration.
5. Verifikasi: `pnpm typecheck`, `pnpm lint`, `pnpm test`, lalu `pnpm test:integration` (Testcontainers, tanpa build image) dengan cek bahwa setiap container yang dibuat berlabel dan berawalan, dan tidak ada volume anonim baru. `pnpm test:egress` termasuk butir 0a2, bukan J1.
6. Kritik diff oleh Codex (putaran 2 topik J1), perbaikan, lalu J1 selesai.
