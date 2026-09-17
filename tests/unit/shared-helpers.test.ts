// Review IN-07 (Phase 11): helpers that were copied into two modules now live once.
import { describe, expect, it } from "vitest";
import { isApplePlatform } from "@/lib/keyboard/platform";
import { cut } from "@/lib/text/cut";

describe("cut", () => {
  it("keeps text at or under the limit unchanged", () => {
    expect(cut("", 3)).toBe("");
    expect(cut("abc", 3)).toBe("abc");
  });

  it("cuts to the limit in UTF-16 units", () => {
    expect(cut("abcdef", 4)).toBe("abcd");
  });

  it("never ends on a lone high surrogate", () => {
    // "a" + U+1F600 (two units): a cut at 2 would split the pair, so it drops the high half.
    expect(cut("a\u{1F600}b", 2)).toBe("a");
    expect(cut("a\u{1F600}b", 3)).toBe("a\u{1F600}");
  });
});

describe("isApplePlatform", () => {
  const nav = (fields: { platform?: string; userAgent?: string; uaPlatform?: string }) => ({
    platform: fields.platform ?? "",
    userAgent: fields.userAgent ?? "",
    ...(fields.uaPlatform ? { userAgentData: { platform: fields.uaPlatform } } : {}),
  });

  it("prefers userAgentData.platform, then platform, then the user agent", () => {
    expect(isApplePlatform(nav({ uaPlatform: "macOS", platform: "Win32" }))).toBe(true);
    expect(isApplePlatform(nav({ uaPlatform: "Windows", platform: "MacIntel" }))).toBe(false);
    expect(isApplePlatform(nav({ platform: "MacIntel" }))).toBe(true);
    expect(isApplePlatform(nav({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }))).toBe(
      true,
    );
    expect(isApplePlatform(nav({ platform: "Linux x86_64", userAgent: "X11; Linux" }))).toBe(false);
  });
});
