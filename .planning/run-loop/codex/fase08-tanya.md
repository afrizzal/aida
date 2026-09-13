# Fase 08 Security Hardening: brainstorm area abu-abu (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git.

Konteks: Fase 08 di `.planning/ROADMAP.md`, requirement AIDA-25 sampai AIDA-32 di `.planning/REQUIREMENTS.md`, dan temuan v1 di `.planning/milestones/v1.0.0-phases/07-launch-readiness/07-SECURITY-PASS.md`. Batas mengikat ada di `.planning/run-loop/PIAGAM.md`, terutama Aturan teknis AIDA, aturan package baru, dan Larangan. Hasil brainstorm ini akan menjadi `08-CONTEXT.md`.

## Fakta yang sudah saya verifikasi

**Audit.** `pnpm audit --prod` exit 1: 7 critical, 52 high. Modul critical dan high, beserta dependensi langsung yang membawanya:

| Dependensi langsung | Modul rentan (versi perbaikan) |
|---|---|
| `shadcn@^4.12.0` (di `dependencies`) | `proxy-addr` critical (>=2.0.8), `@modelcontextprotocol/sdk` (>=1.32.0), `body-parser` (>=2.4.0), `undici` (>=7.30.1), `systeminformation` (>=5.33.16), `js-yaml`, `brace-expansion`, `nanoid`, `postcss`, `zod@3` |
| `next@16.2.11` | `next` sendiri, critical dan high (>=16.4.1), `sharp@0.34.5` (>=0.35.5), `postcss`, `browserslist` |
| `better-auth@1.6.22` | `better-auth` sendiri, critical dan high (>=1.7.7), `drizzle-orm` (>=0.45.2), `mysql2` (>=3.22.0), `vitest` beserta `vite`, `nanoid`, `source-map-js` |
| `prisma@7.8.0` | `fast-uri` lewat `@prisma/dev` (>=3.1.7) |
| `imapflow@1.4.6` | `ip-address` lewat `socks` (>=10.3.1) |
| `html-to-text@10.0.0` | `deepmerge-ts@7` (>=8.0.0) |
| `nodemailer@9.0.3` | dirinya sendiri (>=9.1.0) |
| `zod@4.4.3` | dirinya sendiri (>=4.6.6) |

`shadcn` hanya dipakai di `src/app/globals.css` (`@import "shadcn/tailwind.css"`), yaitu saat build CSS. Tidak ada impor JS di `src/`. `Dockerfile` memakai output `standalone` Next.js.

**Container.** Stage `runner` di `Dockerfile` berbasis `node:22-alpine`, tanpa baris `USER`. `app` menulis upload ke volume `uploads_data:/data/uploads`. `migrate` adalah service sekali jalan. Healthcheck `app` menjalankan `wget -qO- http://127.0.0.1:3000/api/health` setiap 10 detik dari dalam container. `scripts/backup.sh` membaca upload lewat `docker compose run app tar`.

**CSP.** Belum ada sama sekali. Dokumentasi Next.js 16.2.9 lewat Context7: nonce dibuat di `proxy.ts`, dikirim lewat header `x-nonce` dan `Content-Security-Policy`, semua halaman wajib dirender dinamis, dan Next menempelkan nonce ke script framework secara otomatis. `src/proxy.ts` sudah punya `proxy()`, `PUBLIC_PREFIXES`, `BLOCKED_PUBLIC_ROUTES`, dan matcher yang mengecualikan `_next/static`, `_next/image`, `favicon.ico`. Root layout memakai `ThemeProvider` dari `next-themes` dan `Toaster` dari `sonner`. UI memakai primitive shadcn berbasis Radix.

**IP klien.** Ketiga route publik POST (`intake`, `csat`, `follow-up`) mengambil token paling kiri `x-forwarded-for`, dengan fallback `"unknown"`. `Caddyfile` tidak menyetel `trusted_proxies`, sehingga Caddy menimpa XFF dengan IP peer. Hanya `caddy` yang membuka port.

**Route publik.** `/api/health` melakukan satu query `SystemSetting` per panggilan dan tidak punya rate limit. `/api/public/status/[token]/attachments/[id]` tidak punya rate limit. `csat` dan `follow-up` memanggil `findUnique` atas token dan `formData()` sebelum `checkRateLimit`. `follow-up` hanya punya batas per file (`MAX_BYTES`), tidak ada batas total.

**Oracle error.** Empat `catch` mengembalikan `String(e.message).slice(0, 200)`: `testLlmConnection` dan `testEmbeddingConnection` di `src/app/(app)/settings/actions.ts`, serta `testImapConnection` dan `testSmtpConnection` di `src/app/(app)/settings/email/actions.ts`.

**Font.** `src/app/layout.tsx` memakai `next/font/google` Inter dengan variabel `--font-inter`. `globals.css` sudah punya fallback `system-ui, sans-serif`. `DESIGN-SYSTEM.md` tidak menyebut nama font. Screenshot dan hero GIF di `docs/assets` dibuat dengan Inter.

**Lain-lain.** Belum ada `.github/dependabot.yml`. `ci.yml` punya satu job `build`. `website/` adalah project pnpm terpisah. `addTag` memvalidasi `trim` sebelum `getScopedDb()`.

## Area abu-abu

Untuk setiap area, pilih opsi, sebut risikonya, dan tandai kalau keputusannya sebenarnya milik owner.

1. **Strategi dependensi.** (a) Pindahkan `shadcn` ke `devDependencies`, karena hanya dipakai saat build. Apakah ini perbaikan sah atau mengakali audit, dan bukti apa yang perlu, misalnya isi `.next/standalone`? (b) Naikkan `next` ke >=16.4.1 dan `better-auth` ke >=1.7.7, termasuk risiko skema Better Auth berubah. (c) `pnpm.overrides` untuk dependensi transitif (`fast-uri`, `ip-address`, `deepmerge-ts@8` yang mayor, `sharp@0.35`), atau residual yang dijustifikasi. Urutan dan cara mengujinya.
2. **CSP.** Nonce ketat dengan `strict-dynamic`, atau `script-src 'self'` tanpa nonce. `style-src`: nonce bisa memblokir atribut `style` inline yang dipakai Radix untuk posisi popover, jadi pertimbangkan `'unsafe-inline'` khusus style atau `style-src-attr`. Script inline `next-themes` butuh nonce. Tentukan juga `connect-src`, `img-src` (blob dan data untuk pratinjau lampiran), `frame-ancestors`, dan apakah perlu mode report-only. Halaman publik ikut kena.
3. **Container non-root.** `USER node` dari image dasar, atau user khusus. Upgrade volume `uploads_data` lama yang dimiliki root: (a) service init sekali jalan yang menjalankan `chown`, (b) entrypoint root yang `chown` lalu turun hak dengan `su-exec`, sebuah package apk baru, (c) instruksi manual di `docs/OPERATIONS.md`. Apakah Next standalone menulis ke `.next/cache` saat runtime sehingga butuh direktori yang bisa ditulis?
4. **IP klien tepercaya.** Saya condong ke `TRUSTED_PROXY_HOPS` (default 1 untuk Caddy) dengan pembacaan XFF dari kanan, dan perilaku tanpa XFF dituliskan dengan jelas. Route handler Next tidak punya akses ke IP socket. Serang rancangan ini, termasuk kasus `app:3000` diekspos langsung.
5. **Throttle `/api/health` tanpa memutus healthcheck.** Opsi: (a) kecualikan request tanpa XFF, yaitu loopback; (b) cache hasil health di memori beberapa detik plus rate limit per IP; (c) gabungan keduanya. Pertimbangkan juga amplifikasi query DB.
6. **Attachments, `follow-up`, dan `csat`.** Batas yang wajar untuk unduhan lampiran yang bisa beruntun. Batas total `follow-up` lewat `content-length` sebelum `formData()`, termasuk jebakan `proxyClientMaxBodySize`. Rate limit sebelum lookup token.
7. **Kategori error koneksi.** Daftar kategori yang cukup tanpa membocorkan topologi jaringan, dan pesan mentah yang hanya masuk ke log server dengan redaksi rahasia.
8. **Font (F-14).** Stack font sistem atau Inter yang divendor (OFL-1.1) lewat `next/font/local`. Akibatnya pada `docs/assets` yang dibuat dengan Inter: apakah perlu diambil ulang, dan apakah itu butuh persetujuan visual manusia. Ingat, piagam hanya menyebut lisensi untuk package, dan meminta opsi paling konservatif untuk urusan lisensi.
9. **Telemetri build.** Di mana `NEXT_TELEMETRY_DISABLED=1` dan `CHECKPOINT_DISABLE=1` harus dipasang: stage builder, runner, compose, CI.
10. **Dependabot dan audit CI.** Ekosistem npm untuk root dan `website/`, github-actions, docker. Audit CI sebagai job terpisah yang wajib, atau terjadwal, mengingat advisory baru bisa membuat PR yang tidak terkait jadi merah.
11. **Pemecahan plan.** Usulkan pembagian plan dan wave untuk Fase 08 serta urutannya, misalnya kenaikan `next` sebelum CSP. Satu plan sebaiknya bisa diuji sendiri.
12. **Yang saya lewatkan.** Risiko atau celah lain dari `07-SECURITY-PASS.md` atau kode yang relevan untuk Fase 08 tetapi tidak tertangkap AIDA-25 sampai AIDA-32.

## Format jawaban

Bahasa Indonesia. Untuk setiap area: rekomendasi, alasan, risiko, dan status `terverifikasi di kode` atau `belum terverifikasi` untuk setiap klaim fakta. Tandai keputusan yang milik owner. Paling banyak sekitar 1.500 kata.

Cari kelemahan. Jangan setuju demi setuju. Tandai klaim yang belum kamu verifikasi. Baca hanya folder kerja ini. Jangan menulis file.
