/// <reference types="node" />
// Run decision K176 (review d-WR-6, UI-SPEC amendment A9): the mention autocomplete rows use
// on-scale vertical padding (`py-1`, 4px; UI-SPEC "Spacing Scale": 4, 8, 16, 24, 32), and the list
// height is recalculated so eight rows show: a row is the `size-8` avatar (32px) plus 2 × 4px, so
// 40px, and eight rows are `max-h-[320px]`. The §9 spacing grep of the phase gate (10-GATE.md)
// runs here on the component, so an off-scale step cannot come back.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FILE = path.resolve(__dirname, "../../src/components/tickets/mention-autocomplete.tsx");
const source = fs.readFileSync(FILE, "utf8");

/** The className string of the first JSX element named `tag` in the component. */
function classNameOf(tag: string): string {
  const match = new RegExp(`<${tag}\\b[\\s\\S]*?className="([^"]*)"`).exec(source);
  if (!match) throw new Error(`no className on <${tag}> in mention-autocomplete.tsx`);
  return match[1];
}

/** Tailwind spacing steps in px (one step is 4px). */
function stepPx(value: string): number {
  return Number(value) * 4;
}

// The gate's grep: padding, margin, gap, space and inset steps off the 4/8/16/24/32 scale.
const OFF_SCALE =
  /(?:^|[\s"'`:])-?(?:p[xytblrse]?|m[xytblrse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|left|right|bottom)-(?:0\.5|1\.5|2\.5|3|3\.5|5|7|9|10|11|12)(?=[\s"'`]|$)/m;

describe("mention autocomplete spacing (K176, UI-SPEC A9)", () => {
  it("each option row has py-1 and no off-scale vertical padding", () => {
    const item = classNameOf("CommandItem").split(/\s+/);
    expect(item).toContain("py-1");
    expect(item.filter((c) => /^py-/.test(c))).toEqual(["py-1"]);
  });

  it("the list shows eight 40px rows: max-h-[320px] = 8 × (size-8 avatar + 2 × py-1)", () => {
    const list = classNameOf("CommandList").split(/\s+/);
    const maxH = list.find((c) => /^max-h-\[\d+px\]$/.test(c));
    expect(maxH).toBe("max-h-[320px]");

    const avatar = classNameOf("Avatar").split(/\s+/);
    const size = avatar.find((c) => /^size-\d+$/.test(c));
    expect(size).toBe("size-8");
    const py = classNameOf("CommandItem")
      .split(/\s+/)
      .find((c) => /^py-[\d.]+$/.test(c));
    expect(py).toBeDefined();
    const rowPx = stepPx((size ?? "size-0").slice(5)) + 2 * stepPx((py ?? "py-0").slice(3));
    expect(rowPx).toBe(40);
    expect(Number((maxH ?? "").replace(/\D/g, ""))).toBe(8 * rowPx);
  });

  it("no spacing step in the component is off the declared scale (the §9 grep)", () => {
    const hits = source.split("\n").filter((line) => OFF_SCALE.test(line));
    expect(hits).toEqual([]);
  });
});
