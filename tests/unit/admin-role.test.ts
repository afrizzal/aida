// Review IN-05 (Phase 11): one owner/admin rule for every check. The role must be exactly owner or
// admin; AIDA never assigns combined roles, so a comma-separated value is refused (conservative,
// keeps the v1 requireOrgAdmin gate unchanged).
import { describe, expect, it } from "vitest";
import { isAdminRole } from "@/lib/membership";

describe("isAdminRole", () => {
  it("accepts exactly owner and admin", () => {
    for (const role of ["owner", "admin"]) {
      expect(isAdminRole(role)).toBe(true);
    }
  });

  it("refuses combined roles, even when one of them is owner or admin", () => {
    for (const role of ["member,admin", "admin,member", " member , owner ", "owner ", " admin"]) {
      expect(isAdminRole(role)).toBe(false);
    }
  });

  it("refuses member, unknown roles, partial names, empty and missing values", () => {
    for (const role of [
      "member",
      "administrator",
      "owners",
      "admin-ish",
      "",
      ",",
      null,
      undefined,
    ]) {
      expect(isAdminRole(role)).toBe(false);
    }
  });
});
