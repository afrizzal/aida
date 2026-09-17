// Phase 11, plan 11-08: the keyboard decision rules (D-11, D-13, Codex reviews C4 and C9) and
// the parity between the key table and docs/KEYBOARD.md.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHORD_TIMEOUT_MS,
  type ChordState,
  createChordTimer,
  decideKey,
  type KeySnapshot,
} from "@/lib/keyboard/dispatch";
import { formatKeys, KEYMAP, KEYMAP_SECTIONS, keymapBySection } from "@/lib/keyboard/keymap";

function snap(overrides: Partial<KeySnapshot>): KeySnapshot {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    targetEditable: false,
    targetInOverlay: false,
    modalOpen: false,
    paletteOpen: false,
    ...overrides,
  };
}

const T0 = 10_000;

describe("g chords", () => {
  it("starts a chord on g", () => {
    const result = decideKey(snap({ key: "g" }), null, T0);
    expect(result.action).toEqual({ type: "none" });
    expect(result.nextChordState).toEqual({ startedAt: T0 });
  });

  it("completes the chord when the second key comes 999 ms after g", () => {
    const chord: ChordState = { startedAt: T0 };
    const result = decideKey(snap({ key: "c" }), chord, T0 + 999);
    expect(result.action).toEqual({ type: "navigate", href: "/contacts" });
    expect(result.nextChordState).toBeNull();
  });

  it("drops the chord at exactly 1000 ms and decides the key fresh", () => {
    const chord: ChordState = { startedAt: T0 };
    const result = decideKey(snap({ key: "c" }), chord, T0 + 1000);
    expect(result.action).toEqual({ type: "none" });
    expect(result.nextChordState).toBeNull();
    // Fresh: a bound key after an expired chord runs its own command.
    expect(decideKey(snap({ key: "j" }), chord, T0 + CHORD_TIMEOUT_MS).action).toEqual({
      type: "run",
      commandId: "list.next",
    });
  });

  it("navigates for every Go to letter", () => {
    const chord: ChordState = { startedAt: T0 };
    const hrefs = ["t", "c", "k", "i", "s"].map((key) => {
      const action = decideKey(snap({ key }), chord, T0 + 10).action;
      return action.type === "navigate" ? action.href : null;
    });
    expect(hrefs).toEqual(["/tickets", "/contacts", "/kb", "/insights", "/settings"]);
  });

  it("cancels the chord on an unrelated key", () => {
    const result = decideKey(snap({ key: "z" }), { startedAt: T0 }, T0 + 10);
    expect(result.action).toEqual({ type: "none" });
    expect(result.nextChordState).toBeNull();
  });

  it("cancels the chord on Esc without clearing the selection", () => {
    const result = decideKey(snap({ key: "Escape" }), { startedAt: T0 }, T0 + 10);
    expect(result.action).toEqual({ type: "none" });
    expect(result.nextChordState).toBeNull();
  });

  it("gives escape on Esc without a chord", () => {
    expect(decideKey(snap({ key: "Escape" }), null, T0).action).toEqual({ type: "escape" });
  });

  it("keeps the chord on a lone Shift", () => {
    const chord: ChordState = { startedAt: T0 };
    expect(decideKey(snap({ key: "Shift" }), chord, T0 + 10).nextChordState).toBe(chord);
  });
});

describe("ignored events", () => {
  const ignored: [string, Partial<KeySnapshot>][] = [
    ["repeat", { repeat: true }],
    ["isComposing", { isComposing: true }],
    ["defaultPrevented", { defaultPrevented: true }],
    ["ctrlKey", { ctrlKey: true }],
    ["altKey", { altKey: true }],
    ["metaKey", { metaKey: true }],
    ["targetEditable", { targetEditable: true }],
    ["targetInOverlay", { targetInOverlay: true }],
    ["modalOpen", { modalOpen: true }],
  ];
  for (const [name, overrides] of ignored) {
    it(`gives none for j with ${name}`, () => {
      expect(decideKey(snap({ key: "j", ...overrides }), null, T0).action).toEqual({
        type: "none",
      });
    });
  }

  it("never starts a chord from an input", () => {
    const result = decideKey(snap({ key: "g", targetEditable: true }), null, T0);
    expect(result.nextChordState).toBeNull();
  });
});

describe("the palette key", () => {
  it("toggles the palette with metaKey k from an editable target", () => {
    const result = decideKey(snap({ key: "k", metaKey: true, targetEditable: true }), null, T0);
    expect(result.action).toEqual({ type: "togglePalette" });
    expect(result.preventDefault).toBe(true);
  });

  it("toggles the palette with ctrlKey k", () => {
    expect(decideKey(snap({ key: "k", ctrlKey: true }), null, T0).action).toEqual({
      type: "togglePalette",
    });
  });

  it("accepts an upper-case K", () => {
    expect(decideKey(snap({ key: "K", metaKey: true }), null, T0).action).toEqual({
      type: "togglePalette",
    });
  });

  it("does nothing with metaKey k while another modal is open and the palette is closed", () => {
    expect(decideKey(snap({ key: "k", metaKey: true, modalOpen: true }), null, T0).action).toEqual({
      type: "none",
    });
  });

  it("closes the open palette with metaKey k", () => {
    expect(
      decideKey(snap({ key: "k", metaKey: true, paletteOpen: true }), null, T0).action,
    ).toEqual({ type: "togglePalette" });
  });

  it("does nothing with Alt plus metaKey k", () => {
    expect(decideKey(snap({ key: "k", metaKey: true, altKey: true }), null, T0).action).toEqual({
      type: "none",
    });
  });

  describe("universal guards come first (Codex review C4)", () => {
    const modifiers: [string, Partial<KeySnapshot>][] = [
      ["metaKey", { metaKey: true }],
      ["ctrlKey", { ctrlKey: true }],
    ];
    const guards: [string, Partial<KeySnapshot>][] = [
      ["defaultPrevented", { defaultPrevented: true }],
      ["repeat", { repeat: true }],
      ["isComposing", { isComposing: true }],
    ];
    for (const [modifierName, modifier] of modifiers) {
      for (const [guardName, guard] of guards) {
        it(`gives none for ${modifierName} k with ${guardName}`, () => {
          const result = decideKey(snap({ key: "k", ...modifier, ...guard }), null, T0);
          expect(result.action).toEqual({ type: "none" });
          expect(result.preventDefault).toBe(false);
        });
        it(`gives none for ${modifierName} k with ${guardName} from an editable target`, () => {
          const result = decideKey(
            snap({ key: "k", ...modifier, ...guard, targetEditable: true }),
            null,
            T0,
          );
          expect(result.action).toEqual({ type: "none" });
        });
        it(`gives none for ${modifierName} k with ${guardName} while the palette is open`, () => {
          const result = decideKey(
            snap({ key: "k", ...modifier, ...guard, paletteOpen: true }),
            null,
            T0,
          );
          expect(result.action).toEqual({ type: "none" });
        });
      }
    }
  });

  describe("the exception's scope (Codex review C4)", () => {
    for (const [name, modifier] of [
      ["metaKey", { metaKey: true }],
      ["ctrlKey", { ctrlKey: true }],
    ] as const) {
      it(`${name} k from an editable target opens the palette`, () => {
        expect(
          decideKey(snap({ key: "k", ...modifier, targetEditable: true }), null, T0).action,
        ).toEqual({ type: "togglePalette" });
      });
      it(`${name} k inside an open popover or menu does nothing`, () => {
        expect(
          decideKey(snap({ key: "k", ...modifier, targetInOverlay: true }), null, T0).action,
        ).toEqual({ type: "none" });
      });
      it(`${name} k from the palette's own input closes the palette`, () => {
        expect(
          decideKey(
            snap({
              key: "k",
              ...modifier,
              paletteOpen: true,
              targetEditable: true,
              targetInOverlay: true,
            }),
            null,
            T0,
          ).action,
        ).toEqual({ type: "togglePalette" });
      });
    }
  });
});

describe("single keys", () => {
  it("opens the help modal on ?", () => {
    expect(decideKey(snap({ key: "?" }), null, T0).action).toEqual({ type: "openHelp" });
  });

  it("runs list.next on j", () => {
    expect(decideKey(snap({ key: "j" }), null, T0).action).toEqual({
      type: "run",
      commandId: "list.next",
    });
  });

  it("runs ticket.assign on a", () => {
    expect(decideKey(snap({ key: "a" }), null, T0).action).toEqual({
      type: "run",
      commandId: "ticket.assign",
    });
  });

  it("binds no upper-case letter (Shift only as part of the produced character)", () => {
    expect(decideKey(snap({ key: "J" }), null, T0).action).toEqual({ type: "none" });
  });

  it("leaves Enter to the browser", () => {
    expect(decideKey(snap({ key: "Enter" }), null, T0).action).toEqual({ type: "none" });
  });
});

describe("createChordTimer (Codex review C9)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires once at 1000 ms, not at 999 ms", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const timer = createChordTimer(onExpire);
    timer.start();
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("never expires after stop", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const timer = createChordTimer(onExpire);
    timer.start();
    timer.stop();
    vi.advanceTimersByTime(2000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("restarts on a second start and fires once, 1000 ms after it", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const timer = createChordTimer(onExpire);
    timer.start();
    vi.advanceTimersByTime(500);
    timer.start();
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe("key table", () => {
  it("has sections in the order General, Go to, Ticket list, Ticket page, each with entries", () => {
    expect(KEYMAP_SECTIONS.map((section) => section.heading)).toEqual([
      "General",
      "Go to",
      "Ticket list",
      "Ticket page",
    ]);
    for (const section of KEYMAP_SECTIONS) {
      const count = KEYMAP.filter((entry) => entry.section === section.id).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(5);
    }
  });

  it("formats chords and named keys for display", () => {
    const byId = new Map(KEYMAP.map((entry) => [entry.id, entry]));
    const format = (id: string) => {
      const entry = byId.get(id);
      if (!entry) throw new Error(`missing ${id}`);
      return formatKeys(entry);
    };
    expect(format("goto.tickets")).toBe("g then t");
    expect(format("palette")).toBe("⌘K / Ctrl+K");
    expect(format("escape")).toBe("Esc");
    expect(format("help")).toBe("?");
    expect(format("list.open")).toBe("Enter");
    expect(format("list.toggle")).toBe("x");
  });

  it("gives the help modal every entry exactly once, in section order", () => {
    const sections = keymapBySection();
    expect(sections.map((section) => section.heading)).toEqual(
      KEYMAP_SECTIONS.map((section) => section.heading),
    );
    const rows = sections.flatMap((section) => section.entries.map((entry) => entry.id));
    expect([...rows].sort()).toEqual(KEYMAP.map((entry) => entry.id).sort());
    expect(new Set(rows).size).toBe(rows.length);
  });

  it("is listed in full in docs/KEYBOARD.md", () => {
    const doc = fs.readFileSync(path.resolve(process.cwd(), "docs/KEYBOARD.md"), "utf8");
    const lines = doc.split("\n");
    for (const entry of KEYMAP) {
      const keys = `\`${formatKeys(entry)}\``;
      const found = lines.some((line) => line.includes(keys) && line.includes(entry.label));
      expect(found, `${entry.id}: ${formatKeys(entry)} / ${entry.label}`).toBe(true);
    }
    for (const section of KEYMAP_SECTIONS) {
      expect(doc).toContain(`## ${section.heading}`);
    }
  });
});
