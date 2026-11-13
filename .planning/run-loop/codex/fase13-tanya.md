# Fase 13 Integrasi: brainstorm area abu-abu sebelum CONTEXT (putaran 1 dari maksimal 3)

Kamu partner berpikir dan pengkritik. Kamu hanya memberi pendapat. Jangan menulis file, jangan commit, jangan menjalankan test, build, install, Docker, atau perintah jaringan. Folder kerjamu adalah ekspor `git archive` dari `HEAD`, tanpa `node_modules` dan tanpa riwayat git. Baca hanya folder kerja ini; jangan mencari `node_modules` di luar folder ini.

## Latar

Fase 13 belum punya CONTEXT, plan, atau kode. Fase 10 (dependensinya) sudah `human_needed` 5/5, dan Fase 14 (Projects) sudah dieksekusi lebih dulu. Ini brainstorm untuk `13-CONTEXT.md` (langkah 2 Alur per fase di `.planning/run-loop/PIAGAM.md`), bukan review plan. Adapter `internal` SEED-001 (tiket ke task, AIDA-91) milik Fase 17. Fase 13 membangun antarmuka adapter, adapter GitHub Issues, dan adapter Plane, diuji dengan server tiruan.

## Cakupan fase (kata per kata)

Dari `.planning/ROADMAP.md`, bagian "Phase 13: Integrations":

> **Goal:** AIDA plugs into other tools through a public API, signed webhooks and an issue-tracker bridge.
>
> 1. API tokens are hashed, scoped, expire and are rate-limited, and every `/api/v1/*` operation has an authentication test and a cross-org test.
> 2. Webhook deliveries are signed, retried, logged and auto-deactivated, and the SSRF guard blocks private targets and rebinding.
> 3. A ticket escalates to GitHub Issues and to Plane against fake servers.
> 4. A tracker status change returns as an internal note, and a bad signature or replay is rejected before parsing.
> 5. `docs/SECURITY.md` and the egress test cover the new destinations.
> 6. `docker compose -p aida up -d --build` serves `https://localhost/api/health`.
>
> **Stays open for a human:** a test with real credentials.

Dari `.planning/REQUIREMENTS.md:62-67`:

> - **AIDA-58** `v2` — Admins can create API tokens that are hashed at rest, with expiry, last-used tracking, a read or read-write scope and a per-token rate limit. [Charter, SEED-002] Accept: the secret is shown once; a revoked or expired token gets 401; a read token cannot write; a token whose creator is deactivated stops working; going over the limit returns 429; tokens are org-scoped with an unmocked isolation test.
> - **AIDA-59** `v2` — A versioned REST API at `/api/v1/*` authenticates with those tokens and covers at least reading tickets, messages, contacts and tags, creating tickets, updating status, priority and assignee, and adding internal notes. [Charter, SEED-002] Accept: the OpenAPI document in the docs lists every operation with its required scope; every operation has an authentication test and an unmocked cross-org test; responses never include encrypted settings or `AuditEvent.input`.
> - **AIDA-60** `v2` — Admins can register outbound webhooks signed with HMAC-SHA256. [Charter, SEED-002] Accept: tests against a fake receiver verify the signature, an org-bound payload, retry with backoff through pg-boss, the delivery log, and auto-deactivation after repeated failures, which notifies the workspace admins in-app and by email when SMTP is on; the SSRF guard blocks private ranges, localhost, redirects and DNS rebinding.
> - **AIDA-61** `v2` — An agent can escalate a ticket to GitHub Issues or Plane through one adapter interface. [Charter, SEED-001] Accept: an interface mirroring `src/lib/llm/`, a `TicketExternalLink` model, encrypted credentials, and adapters tested against fake servers only. Implemented from `research/plane-inspiration.md`, never from AGPL source.
> - **AIDA-62** `v2` — Tracker status changes return as an internal note on the ticket. [Charter, SEED-001] Accept: the inbound route verifies the HMAC before parsing, is rate-limited and listed in `src/proxy.ts`, rejects replays, and treats the payload as untrusted.
> - **AIDA-63** `v2` — Every new egress path is documented and tested. [Charter] Accept: `docs/SECURITY.md` and `tests/integration/egress-isolation.test.ts` cover webhook and tracker destinations.

Seed: `.planning/seeds/SEED-001-issue-tracker-bridge.md`, `.planning/seeds/SEED-002-public-api-tokens-webhooks.md`. Sketsa jembatan: `.planning/research/plane-inspiration.md` §5.

## Batas mengikat

- Piagam (`.planning/run-loop/PIAGAM.md`): tanpa kredensial asli; adapter dan webhook diuji hanya dengan server tiruan; uji dengan kredensial asli tetap item manusia. Satu server, satu compose, tanpa Redis, antrean pg-boss. Model baru ter-scope lewat `scopedDb` dengan test isolasi tanpa mock. Modul yang dibaca app dan worker hanya memakai import relatif. `src/proxy.ts` memegang `PUBLIC_PREFIXES` dan `BLOCKED_PUBLIC_ROUTES`. `AuditEvent` append-only di level database. Payload webhook adalah input tidak tepercaya. Egress baru wajib masuk `docs/SECURITY.md` dan `tests/integration/egress-isolation.test.ts`. Package baru: versi disematkan, MIT, Apache-2.0, BSD, atau ISC, tanpa temuan high atau critical baru, alasan dicatat.
- `docs/SECURITY.md` terhalang butir owner 08-o4 (`.planning/run-loop/ANTREAN.md:34`): "Run tidak mengubah dokumen itu sampai diputuskan."
- Aturan F: keputusan owner (lisensi, cakupan, apa pun yang mengubah `PROJECT.md` atau `REQUIREMENTS.md`) tidak dipilih run; dicatat `menunggu owner`.
- Aturan J: gerbang compose akhir fase memakai project berawalan `aida-test-`, bukan `aida`.
- `CLAUDE.md`: provider key dienkripsi at rest; "Never send data to any third party other than the user-configured LLM"; AI hanya mendraf, manusia menyetujui; teks tiket tidak tepercaya.
- AIDA-61: clean-room dari dokumen riset, tidak pernah dari sumber AGPL. Aturan clean-room modul Projects tidak berlaku di fase ini.
- Risiko lintas fase (`ROADMAP.md:548`): antarmuka adapter tidak boleh mengandaikan panggilan jaringan, karena AIDA-91 menambah adapter `internal`.
- Fase ber-UI: `.planning/DESIGN-SYSTEM.md` (token saja, `text-[Npx]`, empty state halo, checklist §9).

## Fakta yang sudah saya verifikasi di kode

- Proxy: `PUBLIC_PREFIXES` di `src/proxy.ts:6-21`, dicocokkan dengan `pathname.startsWith(p)` mentah (`:159`), jadi `"/api/public"` juga cocok dengan `/api/publicX`; hanya `/invite/` yang berjangkar garis miring. `BLOCKED_PUBLIC_ROUTES` (`:53-61`) dicocokkan pada bentuk kanonis (`:68-73`). Tanpa cookie sesi, `/api/*` dijawab 401 JSON (`:163-171`); dengan cookie apa pun, request diteruskan (`:174`), validitasnya diperiksa di hilir. Jadi panggilan bearer tanpa cookie tidak akan pernah sampai ke route tanpa perubahan proxy.
- Sesi: database session tanpa cookie cache (`src/lib/auth.ts:17`). Satu-satunya `getSession` ada di `readFreshSession` (`src/lib/fresh-session.ts:25-27`). `getScopedDb` (`src/lib/session.ts:49-57`) memakai `findConservativeMembership` (`src/lib/membership.ts:81-93`); `runTicketMutation` (`src/lib/tickets/mutations.ts:300`) memeriksa `findActiveMembership` di dalam transaksi (`:312`). Tabel `member` tanpa unique `(organizationId, userId)` (komentar `membership.ts:68-80`, butir owner 12.2-o4). Deaktivasi menghapus baris member (`src/lib/workspace-members/member-admin.ts:428`) dan menolkan `activeOrganizationId` sesi (`:444`).
- Inventori membership (`tests/unit/membership-inventory.test.ts:7-36`): Rule A menuntut setiap entry tenant-reaching di `src/app` memanggil salah satu gate (`getScopedDb`, `requirePageAccess`, `getActiveOrgAccess`, `requireOrgAdminScope`, `requireOrgAdmin`, atau `getSessionActor` plus pembaca membership). Rule C membatasi pembaca sesi, Rule C2 satu bacaan sesi per entry, Rule D worker, Rule E jalur publik. Belum ada gate untuk token.
- Rate limit: `consumeRateLimit(scope, ip, opts)` (`src/lib/rate-limit/check-rate-limit.ts:246`), kunci `${scope}:${ipHash}` (`:262`), satu baris `RateLimitHit` per hit dengan jendela maksimal 48 jam. Admission global `RATE_LIMIT_MAX_CONCURRENT = 3` (`:103`) dan `RATE_LIMIT_MAX_PER_IDENTITY = 1` (`:114`); bila tidak diterima, hasilnya `allowed: false` dengan retry 1 detik (`:268-270`). Modul ini memakai alias `@/lib/db` (`:3`). Scope publik ada di `src/lib/rate-limit/public-limits.ts:7-28`.
- pg-boss 12.23.0. Komentar `src/lib/queue/boss-client.ts:20-24`: tanpa `retryDelay`, pg-boss 12 memakai 0, jadi `retryBackoff` tidak bekerja (K55). Antrean didaftarkan di `src/lib/worker/index.ts:52-84`.
- SSRF: tidak ada guard SSRF, `safe-fetch`, atau pin DNS di `src` (grep `ssrf|safe-fetch|rebind|dns.lookup` kosong selain kode Prisma generated). Tidak ada `redirect: "manual"` di `src/lib`. `src/lib/connection-test/errors.ts:18-21` menyatakan probe tetap menyambung ke alamat yang diketik admin, "so SSRF itself is not removed". `fetchWithDeadline` (`src/lib/connection-test/deadline-fetch.ts:8-12`) hanya tenggat.
- Egress: `docs/SECURITY.md:6` menyatakan egress runtime satu-satunya ke endpoint LLM dan server mail operator. `PROJECT.md:106`: "no egress beyond the configured LLM". Test egress membandingkan tujuan yang teramati dengan `{postgres, stub LLM, stub SMTP}` (`tests/integration/egress-isolation.test.ts:365`), di jaringan `internal: true` subnet `10.90.0.0/24` (`docker-compose.egress-test.yml:30-31`, stub di `:73-95`). Semua stub ada di alamat privat.
- Audit: `AuditEvent` (`prisma/schema.prisma:512-530`) khusus LLM (`provider`, `model`, `input`, `output` wajib), append-only lewat trigger (`prisma/migrations/20260707053633_ai_foundation/migration.sql:45-51`). `TicketAuditEvent` punya `actorType` `USER` atau `SYSTEM` (`schema.prisma:658-661`) dan `actorUserId` opsional. `MemberAuditEvent` (`:1399-1412`) mewajibkan `actorUserId`.
- Model: belum ada `ApiToken`, `Webhook`, `WebhookDelivery`, atau `TicketExternalLink`. `DOMAIN_MODELS` di `src/lib/scoped-db.ts:14`. `Setting` key-value unik per organisasi (`schema.prisma:208-219`). `NotificationType` hanya lima nilai tiket (`:1414-1420`). Migrasi terakhir `20261115100000_team_foundation`, juga terdaftar di `tests/integration/auth-upgrade.test.ts:47`.
- Pola yang ditiru: `encryptSecret`/`decryptSecret` (`src/lib/crypto/secret-box.ts:32,44`); `LlmProviderName` union (`src/lib/llm/types.ts:11`), kunci `llm:*` (`src/lib/llm/settings.ts:11`), probe 10 detik (`src/lib/llm/test-connection.ts:13`). `createTicket(orgId, input)` (`src/lib/tickets/create-ticket.ts:79`). Route pesan sekarang memakai `getScopedDb` (`src/app/api/tickets/[id]/messages/route.ts:38`). Sender bertenggat dengan `Auto-Submitted` ada di `src/lib/notifications/digest-sender.ts:49,162`.
- UI: nav Settings (`src/app/(app)/settings/settings-nav.tsx:8-18`) belum punya Developers atau Integrations. `docs/` belum punya dokumen OpenAPI.

## Kandidat keputusan

- **X-01 format dan simpan token.** Format `aida_<prefix>_<secret>` (secret 32 byte acak, prefix tampil di UI). Simpan: (a) SHA-256 polos; (b) HMAC-SHA256 dengan pepper server; (c) hash lambat (argon2 atau bcrypt, package baru). Kedaluwarsa: (a) wajib dengan batas maksimum; (b) boleh tanpa batas. Pencabutan: `revokedAt` (soft) atau hapus. `lastUsedAt`: tulis setiap request atau di-throttle.
- **X-02 scope dan prinsipal.** `read`/`read_write` saja sesuai AIDA-58. Token bertindak sebagai: (a) pembuatnya, membership dibaca konservatif setiap request; (b) prinsipal layanan baru (`TicketAuditActorType` baru). Bila pembuat turun dari admin menjadi agent: token tetap, turun scope, atau mati?
- **X-03 jalur auth dan proxy.** (a) `/api/v1/` (berjangkar) masuk `PUBLIC_PREFIXES`, bearer diperiksa di route lewat satu gate `requireApiToken`; (b) cabang proxy baru yang hanya meneruskan bila ada `Authorization: Bearer aida_`; (c) tetap di belakang cookie. Cookie sesi di `/api/v1`: ditolak atau diterima (CSRF)? Inventori: gate baru di Rule A plus rule baru yang melarang `getScopedDb` di `/api/v1`.
- **X-04 rate limit per token.** (a) `consumeRateLimit` dengan scope `api-token` dan id token sebagai identitas; (b) penghitung jendela di baris token; (c) `memory-throttle.ts`. Limit per IP sebelum token diverifikasi?
- **X-05 versi API dan OpenAPI.** Path `/api/v1` beku, perubahan pemecah ke `v2`. OpenAPI: (a) file statis di `docs/`; (b) dari skema zod 4; test paritas antara route dan dokumen, termasuk scope.
- **X-06 scoping tenant.** Organisasi hanya dari baris token, tidak pernah dari path atau body; id asing dijawab 404; layanan yang ada dipakai ulang dengan aktor; serializer allowlist, tidak pernah menyebar baris Prisma; pagination kursor.
- **X-07 tanda tangan webhook.** HMAC-SHA256 atas `${timestamp}.${rawBody}`, header bertimestamp, ID delivery, nama event; jendela replay yang didokumentasikan untuk penerima. Secret: dienkripsi (bukan di-hash, karena dipakai menandatangani), tampil sekali. Rotasi: (a) ganti langsung; (b) masa tumpang tindih dengan dua tanda tangan.
- **X-08 pengiriman webhook.** (a) outbox `WebhookDelivery` di transaksi yang sama dengan peristiwa, lalu antrean `webhook-deliver`; (b) enqueue sesudah commit. `retryLimit`, `retryDelay` eksplisit (K55), `retryDelayMax`; tenggat per percobaan; 2xx sukses; nonaktif sesudah N kegagalan beruntun atau rentang waktu; notifikasi admin (nilai `NotificationType` baru) dan email bila SMTP menyala. Peristiwa dari worker (ingest email, auto-close, snooze-wake) ikut memancarkan?
- **X-09 guard SSRF.** Satu modul: resolve sekali, tolak semua alamat bila satu saja privat (loopback, RFC 1918, link-local, CGNAT, ULA, IPv4-mapped IPv6, 0.0.0.0, multicast, metadata), lalu sambung ke IP yang sudah diperiksa (pin lewat `lookup` undici) supaya rebinding gagal; `redirect: "manual"` dan 3xx dianggap gagal; dicek saat daftar dan setiap kirim; https saja atau juga http; batas port; tanpa package atau `ipaddr.js`. Log delivery hanya kategori, bukan teks error. Test lokal dan stub egress ada di alamat privat: (a) variabel lingkungan operator untuk CIDR yang diizinkan, mati secara default; (b) resolver disuntik hanya di test unit; (c) flag build test.
- **X-10 base URL adapter.** GitHub tetap `https://api.github.com` atau base URL GHES. Plane self-host di LAN adalah audiens utama. (a) guard yang sama dengan X-09 plus allowlist operator; (b) boleh privat seperti URL Ollama, sisa risiko dicatat; (c) hanya Plane cloud.
- **X-11 daftar egress selama 08-o4 terbuka.** (a) tulis bagian baru `docs/SECURITY.md` di fase ini; (b) teks disiapkan di dokumen fase, AIDA-63 tetap terbuka; (c) butir owner baru untuk izin menambah satu bagian saja. Test egress: stub `stub-webhook` dan `stub-tracker` di compose egress, himpunan tujuan diperluas.
- **X-12 antarmuka adapter.** `src/lib/integrations/issue-tracker/`: `createIssue`, `getStatus`, `verifyInbound(rawBody, headers, secret)`, `parseInbound`, `testConnection`, transport disuntik. Kredensial: (a) kunci `Setting` terenkripsi, satu koneksi per provider; (b) model `TrackerConnection`, banyak koneksi per organisasi.
- **X-13 pemetaan tiket ke issue.** Isi issue: judul dan ringkasan yang ditulis agen di dialog pratinjau, plus tautan balik; tanpa email atau nama pelanggan, lampiran, dan catatan internal secara default. Tautan ke issue yang sudah ada atau hanya buat baru. Siapa boleh eskalasi. Idempoten pada klik ganda dan timeout ambigu (issue dibuat, jawaban hilang).
- **X-14 sinkron masuk dan pencegahan loop.** Route `/api/integrations/<provider>/<connectionId>/webhook`, berjangkar; koneksi dicari dari id path; HMAC atas byte mentah dengan batas ukuran sebelum `JSON.parse`. Replay: (a) tabel delivery-ID unik dengan retensi; (b) jendela timestamp (menurut dokumen riset, Plane tidak mengirim timestamp bertanda tangan; GitHub juga, belum terverifikasi). Catatan internal dari template tetap plus nama status yang disanitasi, tanpa teks issue atau komentar. Tanpa tulis balik ke tracker; abaikan bila status sama dengan `lastState`.
- **X-15 test server tiruan.** Server `node:http` di port acak 127.0.0.1 untuk GitHub, Plane, dan penerima webhook; fixture dari dokumentasi publik; E2E lewat UI asli dengan tracker palsu; stub di compose egress.
- **X-16 UI.** Settings → Developers (token, webhook, log delivery) dan Settings → Integrations (koneksi GitHub dan Plane), admin saja; dialog secret tampil sekali; aksi Escalate di `src/components/tickets/ticket-meta-header.tsx`; chip tautan; UI-SPEC lewat `/gsd-ui-phase` mengikuti design system.
- **X-17 audit.** `AuditEvent` tidak cocok. (a) model append-only baru `IntegrationAuditEvent` (token dibuat dan dicabut, webhook dibuat, diubah, secret dirotasi, nonaktif otomatis, koneksi tracker disimpan, eskalasi); (b) perluas enum `MemberAuditEvent`; (c) `TicketAuditEvent` untuk eskalasi plus model baru untuk aksi admin. Mutasi lewat API: aktor pembuat atau aktor token.
- **X-18 minimisasi data payload.** (a) event tipis: id dan field yang berubah, penerima memanggil API; (b) snapshot penuh. Pesan publik dan internal, email contact, isi pesan: masuk atau tidak? Tidak pernah setting, `AuditEvent.input`, `statusToken`. Payload berversi.

## Pertanyaan

1. **X-01, X-02, X-03.** Hash apa yang cukup untuk secret 256-bit, dan apakah pepper menambah nilai nyata? Prinsipal mana yang benar, dan apa yang terjadi pada token bila peran pembuat turun? Di mana gate token di proxy supaya `/api/v1` tidak terbuka untuk route lain, dan perlukah cookie ditolak?
2. **X-04.** Dengan admission 3 global dan 1 per identitas, apakah `consumeRateLimit` membuat 429 palsu untuk panggilan API paralel dari satu token? Opsi mana yang tidak menambah moving part?
3. **X-07, X-08.** Outbox di transaksi atau enqueue sesudah commit, mengingat peristiwa juga lahir di worker? Nilai retry, backoff, dan ambang nonaktif yang masuk akal?
4. **X-09, X-10, X-15.** Bagaimana guard menolak alamat privat dan rebinding, tetapi test server tiruan di 127.0.0.1 dan stub egress di `10.90.0.0/24` tetap lolos, tanpa membuat pintu belakang di produksi? Apakah Plane di LAN menjadikan X-10 keputusan owner?
5. **X-11.** Mengingat `docs/SECURITY.md:6`, `PROJECT.md:106`, dan 08-o4, apakah AIDA-63 dan kriteria 5 bisa ditutup di fase ini? Apakah mengubah kalimat egress di `PROJECT.md` keputusan owner?
6. **X-12 sampai X-14.** Apakah antarmuka adapter itu cukup untuk adapter `internal` Fase 17 tanpa panggilan jaringan? Bagaimana replay ditolak bila provider tidak menandatangani timestamp? Apakah catatan internal dari tracker bisa menjadi jalan prompt-injection ke triage, draf, atau usulan KB?
7. **X-17, X-18.** Model audit mana yang benar? Payload tipis atau penuh? Sebut juga paling banyak tiga konflik antara X-01 sampai X-18 dan kode sekarang yang belum saya catat, dengan berkas dan baris.

## Format jawaban

Bahasa Indonesia. Temuan diurutkan menurut tingkat (HIGH, MEDIUM, LOW), masing-masing dengan berkas dan baris. Per pertanyaan: rekomendasi, alasan, dan jebakan. Tandai setiap klaim `terverifikasi di kode` atau `belum terverifikasi`. Paling banyak sekitar 900 kata.

Cari kelemahan, jangan setuju demi setuju, tandai klaim yang belum kamu verifikasi, baca hanya folder kerja ini, jangan menulis file.
