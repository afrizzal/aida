# Design System — AIDA

*Berlaku untuk semua fase development. Setiap perubahan UI harus mengacu ke dokumen ini.*

---

## 1. Brand Identity

**Brand color:** Indigo-violet — `oklch(0.515 0.215 277)` (light) / `oklch(0.54 0.215 278)` (dark)  
**Hue family:** 277–280 (indigo). Semua warna brand, sidebar, dan chart berada dalam family yang sama.  
**Surface tint:** Faint cool tint (bukan pure gray `chroma=0`). Setiap surface memiliki sedikit `chroma > 0` pada hue 279–280.

**Two lightness tiers, same hue/chroma (WCAG AA fix, 07-launch-readiness):** `--primary` alone cannot satisfy WCAG AA 4.5:1 in every role at once — dark mode's single value was simultaneously too light to serve as a solid CTA background (with near-white `--primary-foreground` text, 4.29:1) and too dark to serve as TEXT rendered directly on a dark surface (3.86–4.10:1). Rather than compromise on a middle value that would fail both, the token was split into two roles at the SAME hue/chroma (brand identity locked, only lightness moves):
- **`--primary`** — for BACKGROUNDS (buttons, filled badges, `StatusChip`'s `NEW` state, rings, borders, chart-1). Dark mode darkened `0.585` → `0.54` so it clears 4.5:1 against `--primary-foreground` at full opacity.
- **`--primary-emphasis`** (new) — for TEXT/icons rendering the primary color directly on a neutral or tinted dark surface (`text-primary` used to be this; now use `text-primary-emphasis` instead of `text-primary` whenever primary color is the TEXT, not the background). Light mode value is identical to `--primary` (already passed as text, unchanged). Dark mode is lightened to `0.72` so it clears 4.5:1 against `--background`/`--card`/`--sidebar`/`--sidebar-accent`. Mirrored as `--sidebar-primary-emphasis` for the sidebar-namespaced avatar-initials-fallback case (§4.1), keeping the "sidebar always uses `sidebar-*` tokens" rule intact.
- **Rule of thumb:** background under near-white text → `--primary`/`--sidebar-primary`. Primary-colored text/icon/link on any other surface → `--primary-emphasis`/`--sidebar-primary-emphasis`.

---

## 2. CSS Token Reference

Token sudah live di `src/app/globals.css`. Ini adalah kontrak — jangan hardcode nilai hex/oklch langsung di komponen.

### Light mode (`:root`)
| Token | Value | Digunakan untuk |
|-------|-------|-----------------|
| `--primary` | `oklch(0.515 0.215 277)` | CTA buttons, active indicators, focus rings |
| `--primary-emphasis` | `oklch(0.515 0.215 277)` (= `--primary`) | Primary-colored TEXT/icon/link on a neutral or tinted surface (already passed at 4.5:1+ in light mode, so identical to `--primary` here — see §1) |
| `--background` | `oklch(0.994 0.0015 280)` | Page background (faint tint, bukan pure white) |
| `--foreground` | `oklch(0.21 0.02 279)` | Primary text |
| `--muted` | `oklch(0.968 0.004 280)` | Secondary backgrounds |
| `--muted-foreground` | `oklch(0.53 0.02 279)` | Captions, hints, metadata |
| `--accent` | `oklch(0.95 0.025 278)` | Hover backgrounds (bukan active) |
| `--accent-foreground` | `oklch(0.40 0.13 277)` | Text di atas accent bg |
| `--success` | `oklch(0.49 0.14 155)` | Success text/badges (darkened from `0.58` — 07-launch-readiness WCAG AA fix, see below) |
| `--border` | `oklch(0.918 0.006 280)` | Default borders |
| `--ring` | `= --primary` | Focus ring |
| `--sidebar` | `oklch(0.972 0.007 280)` | Sidebar background |
| `--sidebar-accent` | `oklch(0.93 0.028 278)` | Active nav item background |
| `--sidebar-border` | `oklch(0.91 0.007 280)` | Sidebar dividers |

### Dark mode (`.dark`)
Semua nilai dark ada di `globals.css`. Jangan duplikat — gunakan token yang sama.

| Token | Value | Digunakan untuk |
|-------|-------|-----------------|
| `--primary` | `oklch(0.54 0.215 278)` | CTA buttons, filled badges, rings — background use only (§1) |
| `--primary-emphasis` | `oklch(0.72 0.215 278)` | Primary-colored TEXT/icon/link on a dark surface — text use only (§1) |
| `--success` | `oklch(0.72 0.15 155)` | Unchanged — dark mode's success already passed 4.5:1 as text |

### Contrast fix note (07-launch-readiness)

`tests/e2e/a11y-contrast.spec.ts` (axe-core, WCAG AA) found 4 root-cause contrast failures in the original token values. All 4 are now fixed at the TOKEN level (no component hand-tunes a color):
1. **`--success` (light) as badge/status text on its own `/10` tint** — 3.47:1 → darkened `0.58` → `0.49` (same hue/chroma), now ≥4.9:1 against every surface it renders on.
2. **`--primary` (dark) used as TEXT on dark surfaces** — 3.86–4.10:1 → moved to the new `--primary-emphasis` token (`0.72` lightness), now ≥5.2:1 against `--background`/`--card`/`--sidebar`/`--sidebar-accent`.
3. **`--primary` as a solid button/badge BACKGROUND with `--primary-foreground` text** — 4.29:1 (dark, full opacity) → darkened `0.585` → `0.54`, now ~5.2:1.
4. **A lighter violet (`#716ee4`) as a background in light mode** — this was `Button`'s default variant `hover:bg-primary/80`: an OPACITY-based hover blends toward whatever sits behind the button, which LIGHTENS the effective color in light mode (near-white page bg) and dropped contrast to 3.98:1. Fixed by changing the hover mechanism to a `color-mix` DARKEN (`hover:bg-[color-mix(in_oklch,var(--primary),black_15%)]`) in both `button.tsx` and `badge.tsx` — this always darkens regardless of theme/backdrop, so hover only improves contrast now.

**Do not reintroduce `text-primary`/`text-sidebar-primary` for TEXT on a dark or tinted surface** — use `text-primary-emphasis`/`text-sidebar-primary-emphasis` instead (see §1's rule of thumb). `text-primary` remains correct when paired with `bg-primary`+`text-primary-foreground` (i.e., primary as the background).

---

## 3. Typography Scale

| Class | Size | Weight | Digunakan untuk |
|-------|------|--------|-----------------|
| `.text-[15px] font-semibold tracking-tight` | 15px | 600 | Sidebar brand name |
| `.text-[18px] font-semibold tracking-tight` | 18px | 600 | Page titles, card headings besar |
| `.text-[14px]` | 14px | 400 | Nav items, body text |
| `.text-[13px] font-medium` | 13px | 500 | User name di sidebar |
| `.text-[12px]` | 12px | 400 | Email, captions, avatar fallback |

**Tidak ada**: `text-lg`, `text-xl` dari Tailwind — gunakan ukuran eksplisit `text-[Npx]`.

---

## 4. Component Patterns

### 4.1 Sidebar

```tsx
// Shell wajib
<aside className="flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
  {/* Brand header: tinggi h-14, ikon Sparkles di brand box */}
  {/* Nav: space-y-0.5, px-2 py-2, active=bg-sidebar-accent */}
  {/* User footer: border-t border-sidebar-border p-2 */}
</aside>
```

**Active nav item:**
```tsx
"bg-sidebar-accent font-medium text-sidebar-accent-foreground"
```

**Inactive nav item:**
```tsx
"text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
```

**Avatar fallback (sidebar):**
```tsx
"bg-sidebar-primary/10 text-[12px] font-medium text-sidebar-primary"
```

### 4.2 Top Bar

```tsx
<header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/70 bg-background/80 px-6 backdrop-blur-sm supports-[backdrop-filter]:bg-background/65">
```

Wajib: `sticky top-0 z-10`, `backdrop-blur-sm`, `border-border/70` (bukan `border-border`).

### 4.3 Empty State

```tsx
// Wajib ada: halo efek + icon box bermerek
<div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
  <div className="relative">
    <div className="pointer-events-none absolute inset-0 -m-3 rounded-2xl bg-primary/5 blur-[2px]" aria-hidden />
    <div className="relative flex size-14 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary shadow-sm">
      <Icon className="size-6" />
    </div>
  </div>
  <div className="space-y-1.5">
    <h2 className="text-[18px] font-semibold tracking-tight">{heading}</h2>
    <p className="mx-auto max-w-md text-[14px] leading-relaxed text-muted-foreground">{body}</p>
  </div>
</div>
```

**Jangan**: icon langsung tanpa container, ukuran `h-12 w-12` tanpa box.

### 4.4 Auth Pages (login, setup, dsb)

Auth layout sudah menyediakan background — page component cukup render `<Card>`:

```tsx
// Auth layout (sudah ada): dotted grid + brand glow
// Page hanya render:
<Card className="w-full max-w-[400px] border-border/70 shadow-xl shadow-primary/5">
```

**Background pattern (di layout, bukan di page):**
- Dotted grid: `radial-gradient(var(--border) 1px, transparent 1px)` 24×24
- Brand glow: `size-[520px] bg-primary/15 blur-[120px]` di `top-[-12%]` center

### 4.5 Cards

Default card untuk content:
```tsx
<Card className="border-border/70 shadow-sm">
```

Elevated card (dialog, modal, form):
```tsx
<Card className="border-border/70 shadow-xl shadow-primary/5">
```

### 4.6 Buttons

```tsx
// Primary CTA
<Button>     // default: bg-primary text-primary-foreground
// Ghost/link
<Button variant="ghost">  // hover:bg-accent hover:text-accent-foreground
```

### 4.7 Badges / Status Indicators

Gunakan palette brand untuk status tiket:
```tsx
// Pending/warning: amber (oklch sekitar 0.75 0.18 85)
// Resolved: emerald (oklch sekitar 0.72 0.17 155)
// Closed: muted-foreground
// Open: primary (indigo)
```

---

## 5. Icon Conventions

Gunakan **Lucide React** saja. Ukuran default: `size-4` (16px) untuk inline, `size-6` (24px) untuk icon di box.

Sidebar brand box: `Sparkles` — jangan ganti kecuali rebranding.

---

## 6. Spacing & Layout

- Sidebar width: `w-60` (240px) — tetap, tidak collapsible di MVP
- Top bar height: `h-14` (56px)
- Content padding: `px-6 py-6` minimum untuk halaman utama
- Card gap: `gap-4` atau `gap-6`
- Form stack: `space-y-4`

---

## 7. Dark Mode

Setiap komponen baru **wajib** diuji di dark mode. Token sudah menyediakan semua nilai — tidak perlu `dark:` class manual jika komponen hanya pakai design token.

Gunakan `dark:` class **hanya** untuk kasus yang tidak bisa di-handle token (misal: gambar, shadow warna spesifik).

---

## 8. Rule untuk Claude di Setiap Fase

> **Enforcement rules yang harus diikuti setiap kali ada perubahan UI:**

1. **Gunakan token, bukan nilai literal.** `text-primary` bukan `text-indigo-500`.
2. **Sidebar selalu pakai sidebar-* tokens.** Bukan `bg-gray-100` atau `bg-muted`.
3. **Empty state selalu pakai halo + icon box pattern.** Lihat §4.3.
4. **Auth pages tidak boleh wrap sendiri** — cukup render `<Card>`, layout yang wrap.
5. **Top bar selalu sticky dengan backdrop-blur.** Lihat §4.2.
6. **Typography: gunakan ukuran eksplisit `text-[Npx]`.** Bukan `text-lg` / `text-xl`.
7. **Setelah menambah komponen baru: typecheck wajib clean** (`tsc --noEmit`).
8. **Dark mode wajib dicek** — minimal visual review, bukan hanya trust token.

---

## 9. Checklist UI Review per Fase

Sebelum plan suatu fase UI di-approve, jawab semua:

- [ ] Semua token baru ada di `globals.css` (bukan hardcode)?
- [ ] Empty state menggunakan halo + icon box?
- [ ] Sidebar menggunakan `sidebar-*` tokens?
- [ ] Top bar sticky + backdrop-blur?
- [ ] Auth page tidak wrap sendiri (rely on layout)?
- [ ] Typography pakai `text-[Npx]` eksplisit?
- [ ] Dark mode diuji?
- [ ] `tsc --noEmit` clean?

---

*Dokumen ini hidup — update jika ada pattern baru yang disepakati. Jangan hapus pattern lama tanpa migration note.*
