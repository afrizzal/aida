# Loop Engineering — AIDA

*Berdasarkan konsep dari Addy Osmani (6-part loop: automations, worktrees, skills, connectors, sub-agents, memory) dan Boris Cherny (Claude Code at Anthropic).*

---

## TL;DR

GSD sudah menjadi sistem loop. Yang kita tambahkan:
1. Formalisasi STATE.md sebagai **satu-satunya sumber kebenaran** lintas sesi
2. Scheduled trigger harian (standup loop)
3. Design consistency check setelah setiap fase UI
4. Stop condition yang bisa diverifikasi secara objektif (bukan "agent bilang selesai")

---

## 1. Pemetaan: Loop 6-Part → AIDA

| Komponen Loop (Osmani) | Implementasi di AIDA | Status |
|------------------------|----------------------|--------|
| **Automations** | GSD skills (`/gsd:*`), hooks di settings.json, scheduled trigger harian | Sebagian ✓ |
| **Worktrees** | `EnterWorktree` / `isolation: "worktree"` di Workflow | Tersedia ✓ |
| **Skills** | File di `.claude/commands/` (semua `/gsd:*`) | ✓ |
| **Memory** | `STATE.md` (project) + `/memory/*.md` (user session) | ✓ |
| **Sub-agents** | gsd-executor, gsd-planner, gsd-verifier, dll | ✓ |
| **Connectors** | State file chain: PLAN.md → SUMMARY.md → STATE.md | ✓ |

**Kesimpulan:** 5 dari 6 sudah ada. Yang kurang: **automations** — trigger yang jalan tanpa kamu mengetik sesuatu.

---

## 2. Memory Architecture (Sudah Ada, Perlu Dirawat)

```
.planning/STATE.md                    ← Project memory (WAJIB selalu current)
.planning/phases/XX-*/XX-YY-SUMMARY.md ← Episodic memory per plan
.planning/DESIGN-SYSTEM.md            ← Design contract (baru)
/memory/project_*.md                  ← Claude session memory
/memory/user_*.md                     ← User profile memory
/memory/feedback_*.md                 ← Behavior corrections
```

**Aturan:** STATE.md adalah "sumber kebenaran tunggal". Setiap kali phase selesai, STATE.md harus update sebelum `/gsd:next`. Jangan pernah close sesi tanpa update STATE.md.

---

## 3. Loop yang Kita Jalankan

### Loop A: Phase Development Loop (sudah ada, formalisasi)

```
[Trigger]: Manual (/gsd:next atau /gsd:plan-phase N)
[Memory read]: STATE.md + phase CONTEXT.md
[Work]:
  discuss-phase → plan-phase (Opus) → execute-phase (Sonnet)
[Verification]:
  gsd-verifier checks goal achievement
  tsc --noEmit clean
  design checklist (DESIGN-SYSTEM.md §9) terpenuhi
[Stop condition]:
  VERIFICATION.md says "PASS" AND tsc clean AND design checklist ✓
[Memory write]:
  SUMMARY.md + STATE.md updated
[Human checkpoint]:
  Setiap fase wajib human sign-off sebelum lanjut
```

**Autonomy level:** 2 (draft changes, human applies/approves)

---

### Loop B: Daily Standup Loop (baru — scheduled trigger)

```
[Trigger]: Setiap hari pagi (cron)
[Memory read]: STATE.md, git log --since=yesterday, open todos
[Work]:
  Tulis ringkasan ke STATE.md section "Daily Log"
  Flag jika ada yang blocked > 1 hari
  Ingatkan next action berdasarkan STATE.md
[Stop condition]:
  Satu iterasi selesai (bukan recurring work)
[Output]:
  Notifikasi di session + update STATE.md
```

Setup: jalankan `create_trigger` dengan prompt standup (lihat §5).

---

### Loop C: Design Consistency Loop (baru — post-execute hook)

```
[Trigger]: Setelah setiap fase UI selesai di-execute
[Memory read]: DESIGN-SYSTEM.md §8 rules + §9 checklist
[Work]:
  Audit komponen baru terhadap 8 rules
  tsc --noEmit
  Buat DESIGN-REVIEW.md di folder fase
[Stop condition]:
  Semua 8 checklist items ✓ DAN tsc clean
[Output]:
  PASS: lanjut ke gsd:verify-work
  FAIL: buat list deviasi, fix dulu sebelum proceed
```

Ini adalah **evaluator-optimizer pattern** yang disebut postingan: satu agent nulis kode, agent kedua cek terhadap standar objektif (design checklist + tsc).

---

### Loop D: Verification Loop (sudah ada via gsd-verifier, formalisasi)

```
[Trigger]: Setelah execute-phase selesai
[Goal-backward check]:
  Apakah hasil BENAR-BENAR memenuhi tujuan fase?
  (Bukan hanya "task di plan sudah centang")
[Hard gates]:
  tsc --noEmit clean
  Test suite pass (vitest)
  Dockerfile build success (fase 7+)
[Output]:
  VERIFICATION.md dengan verdict PASS/FAIL
  FAIL = fase belum selesai, bukan "move on"
```

---

## 4. Stop Conditions yang Valid

| Kondisi | Contoh Valid | Contoh Tidak Valid |
|---------|-------------|-------------------|
| Build | `tsc --noEmit` exit 0 | "TypeScript terlihat ok" |
| Tests | `pnpm test` semua pass | "Tests probably pass" |
| Design | Semua 8 item checklist ✓ | "Desain sudah bagus" |
| Feature | User dapat create+close ticket di real browser | "Fitur sudah diimplementasi" |
| Phase | VERIFICATION.md = PASS + human sign-off | "Agent bilang selesai" |

**Aturan keras:** Jika stop condition tidak bisa dicek dengan perintah atau checklist, itu bukan stop condition.

---

## 5. Setup: Daily Standup Trigger

Jalankan sekali untuk setup trigger harian:

```
Buka Claude Code → ketik:
/schedule

Atau gunakan create_trigger dengan prompt:
---
Baca .planning/STATE.md dan jalankan `git log --oneline --since=yesterday` di D:\Aff\proj\aida.
Tulis ringkasan singkat ke STATE.md di bawah section "## Daily Log" dengan format:
### {tanggal hari ini}
- **Status**: {phase saat ini dan progress}
- **Kemarin**: {apa yang dikerjakan berdasarkan git log}
- **Next**: {next action dari STATE.md}
- **Blocked**: {jika ada item yang blocked}

Jika STATE.md menunjukkan "awaiting-human-verification", ingatkan saya untuk sign-off.
---
```

Interval: `0 8 * * 1-5` (weekday 08:00 WIB = 01:00 UTC)

---

## 6. Autonomy Ladder untuk AIDA

| Level | Deskripsi | Kapan digunakan |
|-------|-----------|-----------------|
| **1 — Suggest** | Claude menganalisis dan membuat rekomendasi saja | Fase baru, arsitektur besar |
| **2 — Draft** | Claude bikin plan + code, human review + approve | Semua fase normal (sekarang) |
| **3 — Apply low-risk** | Execute dan commit langsung, human review sebelum push | Fase 7 ke atas, setelah track record baik |
| **4 — Autonomous** | Jalan sendiri, audit log saja | Tidak di MVP — earned, bukan assumed |

**Saat ini:** Level 2 untuk semua fase. Naik ke Level 3 setelah Phase 3 selesai dengan clean record.

---

## 7. Token Cost Guard

Setiap Workflow agent run = token consumption. Rules:

1. **gsd:execute-phase** pakai Sonnet (bukan Opus) — 5x lebih hemat
2. **gsd:plan-phase** pakai Opus — keputusan arsitektur butuh depth
3. Sebelum Workflow besar: cek estimasi agent count × avg token per agent
4. Loop tidak boleh jalan tanpa batas: max 20 iterasi sebagai backstop
5. Daily standup trigger: satu iterasi, ringan — pakai Haiku jika tersedia

---

## 8. Command Allowlist untuk Loop Agents

Agents yang jalan via scheduled trigger hanya boleh:
```
git log, git status, git diff     ← baca state repo
cat, ls                           ← baca file
echo, write                       ← tulis state file
tsc --noEmit                      ← verify (no side effect)
pnpm test --run                   ← verify (read-only output)
```

**Tidak boleh** (tanpa explicit user trigger):
```
git push, git commit              ← perubahan permanen
docker compose                    ← infra changes
prisma migrate                    ← database changes
npm install / pnpm add            ← dependency changes
```

---

## 9. Integrasi dengan GSD

Tidak ada konflik — loop engineering IS GSD, hanya dengan framing yang lebih eksplisit:

- `gsd:resume-work` = **loop restart** (baca STATE.md, restore context)
- `gsd:next` = **loop advance** (move ke trigger berikutnya)
- `STATE.md` = **loop memory** (satu file, dibaca di awal setiap run)
- Phase PLAN.md = **loop goal** (stop condition per iterasi)
- Phase SUMMARY.md = **loop log** (apa yang terjadi di iterasi ini)
- `gsd:verify-work` = **loop check** (apakah stop condition terpenuhi?)

**Yang ditambahkan di atas GSD:**
- Scheduled daily standup trigger (§5)
- Design consistency check setelah setiap fase UI (Loop C)
- Explicit autonomy ladder (§6)
- Hard stop condition vocabulary (§4)

---

## 10. Referensi Sumber

- Addy Osmani: "Designing Agentic Loops" (essay yang menginspirasi postingan)
- Boris Cherny (Claude Code at Anthropic): autonomy ladder, loop-first thinking
- Peter Steinberger: "design loops that prompt your agents"
- Anthropic Engineering: evaluator-optimizer pattern
- Postingan X yang di-share: framing 6-part loop + stop condition + autonomy ladder

---

*Dokumen ini adalah living reference. Update §3 setiap kali ada loop baru yang disetujui untuk dijalankan.*
