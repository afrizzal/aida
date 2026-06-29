import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("smoke", () => {
  it("runs vitest and resolves the @ alias", () => {
    expect(cn("a", "b")).toContain("a");
  });
});
