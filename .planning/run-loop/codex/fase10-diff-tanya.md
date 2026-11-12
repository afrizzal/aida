# Fase 10 Tim: kritik diff fase (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini.

## Yang direview

Diff kode Fase 10 (undangan, peran, nonaktivasi anggota, notifikasi, digest email, mention), dari 17 plan ditambah lima batch perbaikan code review. Tanpa riwayat git, pakai daftar berkas di bawah dan dokumen fase.

- Keputusan fase: `.planning/phases/10-team/10-CONTEXT.md`, bagian "Update 2026-11-13" (V-01 sampai V-30, butir owner O-4 sampai O-10) dan amandemen R10-1 di akhir (cookie cache sesi sengaja dimatikan).
- Code review empat bagian: `.planning/phases/10-team/10-REVIEW.md` (bagian a dan Dispositions K159 sampai K177), `10-REVIEW-b.md`, `10-REVIEW-c.md`, `10-REVIEW-d.md`.
- Laporan perbaikan: `.planning/phases/10-team/10-REVIEW-FIX.md` (F1 sampai F5) dan `deferred-items.md`.
- Gerbang sebelum perbaikan: `.planning/phases/10-team/10-GATE.md`.
- Berkas produk utama: `src/lib/workspace-members/*`, `src/app/(auth)/invite/[token]/*`, `src/app/(app)/settings/team/*`, `src/lib/notifications/*`, `src/lib/worker/jobs/notification-digest.ts`, `src/lib/worker/jobs/sla-flag.ts`, `src/lib/worker/index.ts`, `src/lib/mentions/*`, `src/lib/markdown/render.ts`, `src/app/api/tickets/[id]/messages/route.ts`, `src/app/api/members/mentionable/route.ts`, `src/app/api/notifications/route.ts`, `src/app/(app)/notification-actions.ts`, `src/components/notification-bell.tsx`, `src/components/tickets/composer.tsx`, `src/lib/fresh-session.ts`, `src/lib/session.ts`, `src/lib/authz.ts`, `src/lib/page-access.ts`, `src/lib/app-url.ts`, `src/lib/auth.ts`, `src/proxy.ts`, `src/lib/rate-limit/public-limits.ts`, `scripts/backup/lib.sh`, `scripts/backup/aida-backup.sh`, `prisma/migrations/20261115100000_team_foundation/migration.sql`.

## Fakta yang sudah saya verifikasi

- Sesudah F5 (`897687b`): `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test` 116 berkas 2125 lolos, `pnpm test:integration` penuh 135 berkas 1881 lolos 0 gagal.
- E2E penuh terakhir di `2418e4c` (sebelum F1 sampai F5): 292 lolos, 0 gagal. Sesudah F1 sampai F5 hanya spec E2E terkait yang diulang (36, 52, 3, 55 lolos per batch). E2E penuh belum diulang.
- `pnpm test:egress` blocked (ruang VM Colima 13,2 GiB, aturan J butuh 20). `pnpm audit --prod` exit 1 dengan 10 high, sama dengan Fase 9 (butir owner 08-o3).
- Code review: 0 critical, 19 warning, 31 info; semua warning diterima sebagai K159 sampai K177 dan diperbaiki dengan test yang terlihat gagal lebih dulu.

## Pertanyaan

1. Apakah K159 sampai K177 benar-benar tertutup? Apakah perbaikannya membuka masalah baru?
2. **K159 (keamanan):** `/invite` kini mengirim `Referrer-Policy: same-origin` (sebelumnya `no-referrer`), dan route accept menerima Origin hanya bila sama persis dengan origin `BETTER_AUTH_URL` atau salah satu origin persis di `BETTER_AUTH_TRUSTED_ORIGINS` (daftar yang sama dengan cek origin Better Auth; wildcard dilewati). Jalur sebelumnya (`Origin: null` plus fetch metadata) dihapus. Apakah ini aman terhadap CSRF penerimaan undangan dan kebocoran token, dan apakah memakai daftar trusted origins melebarkan permukaan serangan?
3. **K170:** balasan SMTP 5xx apa pun menutup batch digest (baris digest CANCELED, notifikasinya di-stamp, tetap di lonceng), termasuk 535 (kata sandi SMTP salah) yang menutup batch semua member di run itu. Apakah 535 seharusnya diperlakukan sebagai sementara?
4. **d-IN-7:** composer menahan Send publik pertama dan menampilkan catatan ganti mode alih-alih langsung mengirim bila masih ada mention. Apakah ini aman dan masuk akal, atau ada jalur yang tetap mengirim nama member ke pelanggan?
5. **K164:** penolakan bertipe `MEMBERSHIP_ENDED` di 66 server action; batas yang tercatat: member tanpa peran admin masih mendapat galat "Forbidden" yang dilempar `requireOrgAdminScope`. Apakah ada server action yang masih bisa menulis sesudah keanggotaan berakhir?
6. Masih adakah temuan HIGH di Fase 10 yang belum tercatat? Terutama isolasi tenant, otorisasi peran (owner terakhir, baris `member` ganda menurut V-26), undangan, privasi notifikasi dan digest, dan mention yang sampai ke pelanggan.

Tinjau hanya diff Fase 10 dan dampaknya. Jangan membuka review menyeluruh ulang atas fase lain.

## Format jawaban

Bahasa Indonesia. Temuan dari yang paling berat (HIGH, MEDIUM, LOW), masing-masing dengan berkas dan baris. Lalu satu paragraf: apakah Fase 10 siap ke gerbang ulang dan verifier. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 800 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
