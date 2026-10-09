// Review b-WR-02: the review page's DRAFT editor is no longer remounted by its own save. This is
// the rule it applies when the server props carry a version (src/lib/kb/proposal-editor.ts); the
// repository has no component-test setup, so the editor's wiring is covered by this rule only.
import { describe, expect, it } from "vitest";
import { classifyVersionChange, isAwaitingSavedVersion } from "../../src/lib/kb/proposal-editor";

describe("classifyVersionChange (review b-WR-02)", () => {
  it("props with the version already seen are no change", () => {
    expect(classifyVersionChange({ seen: 3, incoming: 3, local: 3 })).toBe("none");
    // The editor saved (local 4) and the refresh has not arrived yet.
    expect(classifyVersionChange({ seen: 3, incoming: 3, local: 4 })).toBe("none");
  });

  it("props carrying the version this editor just saved are its own save: typing is kept", () => {
    expect(classifyVersionChange({ seen: 3, incoming: 4, local: 4 })).toBe("ownSave");
  });

  it("any other new version replaces the form (another admin's save, read by a reload)", () => {
    expect(classifyVersionChange({ seen: 3, incoming: 5, local: 3 })).toBe("other");
    expect(classifyVersionChange({ seen: 3, incoming: 5, local: 4 })).toBe("other");
  });
});

describe("isAwaitingSavedVersion (review b-WR-02)", () => {
  it("is true from a save until the props carry the saved version", () => {
    expect(isAwaitingSavedVersion({ propsVersion: 3, local: 4 })).toBe(true);
    expect(isAwaitingSavedVersion({ propsVersion: 4, local: 4 })).toBe(false);
  });
});
