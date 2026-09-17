// Review IN-05 (Phase 11): one owner/admin rule for every check. Better Auth stores one role or
// several separated by commas; a member whose roles include owner or admin is an admin.
import { describe, expect, it } from "vitest";
import { isAdminRole } from "@/lib/membership";

describe("isAdminRole", () => {
  it("accepts owner and admin, alone or among other roles", () => {
    for (const role of ["owner", "admin", "member,admin", "admin,member", " member , owner "]) {
      expect(isAdminRole(role)).toBe(true);
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
