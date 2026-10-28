# Fase 08 Keamanan: review plan siklus 4 (satu-satunya, khusus R3-1 sampai R3-4)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Latar

Fase 8 diparkir sesudah siklus 3 dengan 4 HIGH (R3-1 sampai R3-4) dan 1 MEDIUM (R3-5), lihat `.planning/phases/08-security-hardening/08-REVIEWS.md` bagian "Cycle 3 (last)". Owner melepas parkir pada 2026-11-11 dengan syarat: **satu siklus review saja, khusus empat HIGH itu**. Kalau masih ada HIGH, tidak ada siklus ke-5: Fase 8 dipecah (upgrade dependensi, CSP, non-root, dan rate limit dulu; alat test Docker belakangan), lalu dilaporkan ke owner.

Brief replan yang mengikat ada di `08-REVIEWS.md` bagian "Owner decisions 2026-11-11 and replan brief (cycle 4)". Isinya:
- aturan I (tanpa biaya GitHub) dan aturan J (resource Docker test), keduanya di `.planning/run-loop/PIAGAM.md` bagian Aturan owner, butir J beserta tafsiran run di bawahnya;
- pemakaian ulang alat J1 (`.planning/run-loop/J1-RENCANA.md`, keputusan K108 sampai K124, dengan batas tertulis K109, K115, K118, K120);
- pemetaan temuan ke plan.

## Yang direview

Delapan plan yang direvisi (bagian "Revision 4" di setiap plan):
- `08-05` (CI: pemicu tanpa jadwal baru, workflow `egress.yml` terpisah, Dependabot);
- `08-09` (image non-root: tag per run, cek sebelum build, hapus per `repo:tag`);
- `08-14` (harness container di project per run `aida-test-`, di atas J1; "Interface changes for dependent plans");
- `08-16` (gerbang akhir fase, verifier matriks bukti mekanis, gerbang compose di project `aida-test-gate-`);
- `08-19` (dikurangi ke guard yang belum dibuat J1; aturan pencatatan `pnpm test:egress`);
- `08-21`, `08-22`, `08-23` (pemakai harness).

Kode J1 yang dirujuk plan: `tests/support/docker-test-labels.ts`, `tests/support/docker-test-resources.ts`, `tests/support/docker-test-preflight.ts`, `scripts/test-docker-cleanup.ts`, `tests/integration/egress-isolation.test.ts`, `docker-compose.egress-test.yml`.

## Fakta yang sudah diverifikasi orkestrator

- Semua 23 plan Fase 8 lolos validator frontmatter dan struktur. `check.verify-failure-directions 8`: ok, 128 perintah, semuanya punya `<fails_when>`. `check.verify-command-paths 8`: tidak ada yang ditandai.
- Grep atas semua plan Fase 8: tidak ada perintah Docker atau Compose dengan `-p aida`, `down -v`, `--remove-orphans`, atau prune di luar kalimat larangan.
- Kode J1: `pnpm typecheck` dan `pnpm lint` exit 0; `pnpm test` 891 test; `pnpm test:integration` 1297 test dengan container berlabel, tanpa sisa.
- `pnpm test:egress` (butir 0a2) berhenti di preflight sebelum build: ruang kosong VM Docker 13,9 GiB, di bawah 20 GiB. Tidak ada yang dibuat atau tertinggal. Owner belum memutuskan (0a2).
- `caddy:2` tidak ada di daemon (`docker image inspect` exit 1). Harness tidak pernah menarik image (owner item 08-o2).

## Pertanyaan

1. Untuk masing-masing R3-1, R3-2, R3-3, dan R3-4: apakah temuan itu tertutup di plan yang direvisi? Sebut plan dan bagiannya. Kalau belum, apa yang kurang?
2. Apakah revisi membuka HIGH baru? Yang dimaksud: jalur yang menyentuh project `aida`, `aida-dev-db`, atau project lain; resource test tanpa label dan awalan; tag yang bisa ditimpa; pelanggaran aturan I; status `passed` palsu ketika langkah `blocked`; plan yang membuat eksekutor menebak atau berhenti; atau test kunci yang tidak bisa gagal.
3. Dengan blocker yang ada (ruang VM dan `caddy:2`), apakah plan masih bisa dieksekusi wave demi wave dengan hasil jujur (bagian tanpa Docker lolos, bagian container `blocked`), atau ada plan yang macet atau berputar tanpa akhir?

R3-5 (MEDIUM) dan hal di luar empat HIGH hanya disebut kalau berat. Jangan membuka review menyeluruh ulang.

## Format jawaban

Bahasa Indonesia. Untuk R3-1 sampai R3-4, beri satu baris status: tertutup, sebagian, atau terbuka. Lalu temuan baru dari yang paling berat. Akhiri dengan satu paragraf: apakah Fase 8 siap dieksekusi, atau harus dipecah menurut keputusan owner. Tandai klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 1.000 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
