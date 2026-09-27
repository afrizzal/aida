/// <reference types="node" />
// Mechanical enforcement of DESIGN-SYSTEM.md §2/§3/§9's token rule (07-09.1 Task 3, D-3):
// components must use CSS design tokens, never a hardcoded oklch()/hex color literal, and must
// use explicit `text-[Npx]` sizing, never Tailwind's named text-size scale (`text-lg`, `text-xl`,
// …). Previously this was a human "Dark mode diuji" checklist pass (§9) — this test makes the
// literal-color/named-size half of that checklist self-enforcing on every run, replacing
// eyeballing with a mechanical scan of every .ts/.tsx file under src/components/ and src/app/.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SCAN_ROOTS = ["src/components", "src/app"];

// Matches a literal `oklch(...)` CSS function call anywhere in a file — DESIGN-SYSTEM.md §2:
// "Token sudah live di src/app/globals.css. Ini adalah kontrak — jangan hardcode nilai hex/oklch
// langsung di komponen." Token definitions themselves live in globals.css (not a .ts/.tsx file
// under either scanned root), so this pattern has no legitimate hit inside src/components|app.
const OKLCH_LITERAL = /oklch\(/;

// Matches a CSS hex color literal (#rgb, #rgba, #rrggbb, #rrggbbaa) as a whole token — word
// boundary after the digit run excludes non-color uses of "#" (anchor hrefs like "#section",
// numeric-looking-but-not-hex fragments) from ever matching, since a real anchor target is
// vanishingly unlikely to be a bare, boundary-terminated run of exactly 3/4/6/8 hex digits.
const HEX_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;

// DESIGN-SYSTEM.md §3: "Tidak ada: text-lg, text-xl dari Tailwind — gunakan ukuran eksplisit
// text-[Npx]." Extended to the full Tailwind named text-size scale, matched as a whole
// utility-class token (optional variant prefix like `dark:`/`sm:` before it, `\b`-terminated so
// arbitrary-value/opacity suffixes like `text-lg/6` still match the forbidden base utility).
const NAMED_TEXT_SIZE = /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b(?!-\[)/;

/**
 * Documented exception list (plan 07-09.1 Task 3 instruction: "Allow a documented exception list
 * if genuine ones exist — record them rather than loosening the regex").
 *
 * A full scan of src/components/ and src/app/ at the time this test was written found ZERO
 * hardcoded oklch()/hex color literals anywhere — no exceptions needed for those two patterns.
 *
 * It found 15 genuine named-text-size hits, every one of them inside src/components/ui/ — the
 * shadcn/ui + Radix primitive library (Avatar, Badge, Button, Card, Command, Dialog,
 * DropdownMenu, Form, InputGroup, Input, Label, Popover, Select, Textarea, Tooltip). These files
 * are vendored scaffolding regenerated via the shadcn CLI from its own upstream registry, not
 * hand-authored feature UI — DESIGN-SYSTEM.md §3/§4's `text-[Npx]` convention documents the
 * pixel scale AIDA's OWN feature components (sidebar, top bar, empty states, ticket/KB/insight
 * surfaces) must use; it was never intended to fork the primitive library's internal Tailwind
 * classes away from its shippable, upgradeable default. Two REAL findings in hand-authored app
 * code were found by this same scan (src/app/(auth)/login/page.tsx and
 * src/app/(auth)/setup/page.tsx's `CardTitle text-2xl`, and login-form.tsx's `text-sm` root-error
 * paragraph) and were FIXED at the source (not exempted) — see the plan's 07-09.1-SUMMARY.md.
 * Two entries per file below (badge.tsx has 3 named-size lines but they're covered by one file
 * entry, since the exception key is file+pattern, not file+line).
 */
const VENDOR_UI_TEXT_SIZE_REASON =
  "shadcn/ui + Radix vendor primitive (regenerated via the shadcn CLI from its upstream " +
  "registry, not hand-authored); DESIGN-SYSTEM.md's text-[Npx] convention targets AIDA's own " +
  "feature components, not the base primitive library's shipped Tailwind classes.";

const EXCEPTIONS: { file: string; pattern: "oklch" | "hex" | "text-size"; reason: string }[] = [
  "src/components/ui/avatar.tsx",
  "src/components/ui/badge.tsx",
  "src/components/ui/button.tsx",
  "src/components/ui/card.tsx",
  "src/components/ui/command.tsx",
  "src/components/ui/dialog.tsx",
  "src/components/ui/dropdown-menu.tsx",
  "src/components/ui/form.tsx",
  "src/components/ui/input-group.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/label.tsx",
  "src/components/ui/popover.tsx",
  "src/components/ui/select.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/ui/tooltip.tsx",
].map((file) => ({ file, pattern: "text-size" as const, reason: VENDOR_UI_TEXT_SIZE_REASON }));

function isException(relPath: string, pattern: "oklch" | "hex" | "text-size"): boolean {
  return EXCEPTIONS.some((e) => e.file === relPath && e.pattern === pattern);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scannedFiles(): { absPath: string; relPath: string; content: string }[] {
  const files: { absPath: string; relPath: string; content: string }[] = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = path.join(PROJECT_ROOT, root);
    if (!fs.existsSync(absRoot)) continue;
    for (const absPath of walk(absRoot)) {
      const relPath = path.relative(PROJECT_ROOT, absPath).replace(/\\/g, "/");
      files.push({ absPath, relPath, content: fs.readFileSync(absPath, "utf-8") });
    }
  }
  return files;
}

describe("design-tokens (DESIGN-SYSTEM.md §2/§3/§9 mechanical enforcement)", () => {
  const files = scannedFiles();

  it("scanned at least one file under src/components and src/app (sanity check)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no component file hardcodes an oklch(...) color literal", () => {
    const violations = files
      .filter((f) => OKLCH_LITERAL.test(f.content) && !isException(f.relPath, "oklch"))
      .map((f) => f.relPath);
    expect(violations, `Hardcoded oklch() literal(s) found:\n${violations.join("\n")}`).toEqual([]);
  });

  it("no component file hardcodes a hex color literal", () => {
    const violations = files
      .filter((f) => HEX_LITERAL.test(f.content) && !isException(f.relPath, "hex"))
      .map((f) => f.relPath);
    expect(violations, `Hardcoded hex color literal(s) found:\n${violations.join("\n")}`).toEqual(
      [],
    );
  });

  it("no component file uses a Tailwind named text-size class instead of explicit text-[Npx]", () => {
    const violations = files
      .filter((f) => NAMED_TEXT_SIZE.test(f.content) && !isException(f.relPath, "text-size"))
      .map((f) => f.relPath);
    expect(
      violations,
      `Named Tailwind text-size class(es) found (use text-[Npx] instead):\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("the documented exception list only references files that actually exist under the scan roots", () => {
    const knownPaths = new Set(files.map((f) => f.relPath));
    const dangling = EXCEPTIONS.filter((e) => !knownPaths.has(e.file));
    expect(dangling).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 12.1 state palette (D-14; UI-SPEC Color, contrast gate item 2). Deterministic contrast
// from the values committed in globals.css, in both themes.
//
// Formula sources:
// - OKLCH to OKLab (polar to Cartesian), then OKLab to LMS to linear sRGB with the matrices of
//   Björn Ottosson, "A perceptual color space for image processing" (2020).
// - Linear sRGB to gamma-encoded sRGB (IEC 61966-2-1) for compositing, because browsers
//   composite a translucent background over the surface in encoded sRGB.
// - WCAG 2 relative luminance and contrast ratio ((L1 + 0.05) / (L2 + 0.05)).
// Out-of-gamut channels are clipped to [0, 1], as a browser does on an sRGB display.
// ---------------------------------------------------------------------------------------------

const GLOBALS_CSS = fs.readFileSync(path.join(PROJECT_ROOT, "src/app/globals.css"), "utf-8");

const STATE_TOKEN_KEYS = [
  "indigo",
  "blue",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
  "gray",
] as const;

const SURFACES = ["--background", "--card", "--muted", "--accent"] as const;

function cssBlock(selector: ":root" | ".dark" | "@theme inline"): string {
  const start = GLOBALS_CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`globals.css has no ${selector} block`);
  const end = GLOBALS_CSS.indexOf("}", start);
  return GLOBALS_CSS.slice(start, end);
}

function tokenValue(block: string, name: string): string | null {
  const escaped = name.replace(/[-]/g, "\\-");
  const match = block.match(new RegExp(`(?:^|\\s)${escaped}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

type Rgb = [number, number, number];

function parseOklch(value: string): [number, number, number] {
  const match = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!match) throw new Error(`not a plain oklch() value: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function oklchToLinearSrgb([l, c, h]: [number, number, number]): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const clip = (x: number) => Math.min(1, Math.max(0, x));
const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

function encodedSrgb(value: string): Rgb {
  const lin = oklchToLinearSrgb(parseOklch(value));
  return [encode(clip(lin[0])), encode(clip(lin[1])), encode(clip(lin[2]))];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(decode);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function composite(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return [0, 1, 2].map((i) => alpha * top[i] + (1 - alpha) * bottom[i]) as Rgb;
}

describe("state palette tokens (Phase 12.1, D-14)", () => {
  const themes = [
    { theme: "light", block: cssBlock(":root") },
    { theme: "dark", block: cssBlock(".dark") },
  ] as const;

  for (const { theme, block } of themes) {
    for (const key of STATE_TOKEN_KEYS) {
      it(`--state-${key} (${theme}) clears 4.5:1 as text on its /10 tint over --background, --card, --muted and --accent`, () => {
        const tokenRaw = tokenValue(block, `--state-${key}`);
        expect(tokenRaw, `--state-${key} missing in ${theme}`).not.toBeNull();
        const token = encodedSrgb(tokenRaw as string);
        for (const surface of SURFACES) {
          const surfaceRaw = tokenValue(block, surface);
          expect(surfaceRaw, `${surface} missing in ${theme}`).not.toBeNull();
          const tint = composite(token, 0.1, encodedSrgb(surfaceRaw as string));
          const ratio = contrast(token, tint);
          expect(
            ratio,
            `--state-${key} on ${surface} (${theme}) = ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    it(`--primary-foreground on solid --primary (${theme}, the indigo-filled pair) clears 4.5:1`, () => {
      const fg = tokenValue(block, "--primary-foreground");
      const bg = tokenValue(block, "--primary");
      expect(fg).not.toBeNull();
      expect(bg).not.toBeNull();
      const ratio = contrast(encodedSrgb(fg as string), encodedSrgb(bg as string));
      expect(ratio, `indigo-filled (${theme}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("every tinted key of state-colors.ts has a token in :root, .dark and @theme inline", async () => {
    const { STATE_COLOR_KEYS } = await import("../../src/lib/tickets/state-colors");
    const tinted = STATE_COLOR_KEYS.filter((k) => k !== "indigo-filled");
    expect(tinted).toEqual([...STATE_TOKEN_KEYS]);
    const root = cssBlock(":root");
    const dark = cssBlock(".dark");
    const themeInline = cssBlock("@theme inline");
    for (const key of tinted) {
      expect(tokenValue(root, `--state-${key}`), `:root --state-${key}`).toMatch(/^oklch\(/);
      expect(tokenValue(dark, `--state-${key}`), `.dark --state-${key}`).toMatch(/^oklch\(/);
      expect(tokenValue(themeInline, `--color-state-${key}`)).toBe(`var(--state-${key})`);
    }
  });

  it("state-colors.ts maps keys to the UI-SPEC classes, with the gray fallback for an unknown key", async () => {
    const { STATE_COLOR_KEYS, stateColorClasses, STATE_COLORS } = await import(
      "../../src/lib/tickets/state-colors"
    );
    expect([...STATE_COLOR_KEYS]).toEqual([
      "indigo-filled",
      "indigo",
      "blue",
      "teal",
      "green",
      "amber",
      "orange",
      "red",
      "pink",
      "purple",
      "gray",
    ]);
    expect(stateColorClasses("amber").chip).toBe(
      "bg-state-amber/10 text-state-amber border border-state-amber/20",
    );
    expect(stateColorClasses("indigo-filled").chip).toBe(
      "bg-primary text-primary-foreground border border-transparent",
    );
    expect(stateColorClasses("violet")).toEqual(STATE_COLORS.gray);
  });
});
