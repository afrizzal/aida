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
