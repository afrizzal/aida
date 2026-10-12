// Phase 14 frozen projects contract (D-17): validators, sets, bounds and the internal consistency
// of the operation table (section 1), including review rounds 1 to 3.
import { icons } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  ACCESS_LEVELS,
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_FEED_ROW_KEYS,
  ACTIVITY_LIST_MAX,
  ACTIVITY_TEXT_MAX,
  ACTIVITY_VALUE_MAX_BYTES,
  ACTIVITY_VALUE_MAX_KEYS,
  ACTIVITY_VERBS,
  BULK_MAX,
  COMMENT_BODY_MAX,
  codePointLength,
  DEFAULT_LABEL_COLOR,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_STATUS,
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  DEFAULT_TIME_ZONE,
  ESTIMATE_MAX_MINUTES,
  FILE_NAME_MAX,
  formatTaskKey,
  fromCalendarDate,
  hasNul,
  ISOLATION_EXPECTATIONS,
  isCalendarDate,
  isValidPrefix,
  isValidTimeZone,
  isWellFormedId,
  LABEL_NAME_MAX,
  LIST_DEFAULT,
  LIST_MAX,
  LOCK_MODES,
  MAX_TASK_LABELS,
  MAX_UPLOAD_FILES,
  MILESTONE_DESCRIPTION_MAX,
  MILESTONE_NAME_MAX,
  normalizePrefix,
  normalizeTaskKey,
  PROJECT_COLORS,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_FILE_CLEANUP_CRON,
  PROJECT_FILE_CLEANUP_QUEUE,
  PROJECT_ICONS,
  PROJECT_MEMBER_ROLES,
  PROJECT_MODULES,
  PROJECT_NAME_MAX,
  PROJECT_OPERATIONS,
  PROJECT_REFUSAL_CODES,
  PROJECT_STATUSES,
  type ProjectOperationName,
  parseCalendarDate,
  parseTaskKey,
  RANK_GAP,
  RANK_MAX,
  RECURRENCE_RULES,
  REDACTED_ROW_NULLED_KEYS,
  REDACTED_SIDE,
  TASK_DESCRIPTION_MAX,
  TASK_KEY_KINDS,
  TASK_NUMBER_MAX,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX,
  TEAM_NAME_MAX,
  TEXT_LENGTHS,
  TRANSACTION_OPTIONS,
  toCalendarDate,
  todayInTimeZone,
} from "../../src/lib/projects/contract";

const operations = Object.entries(PROJECT_OPERATIONS) as [
  ProjectOperationName,
  (typeof PROJECT_OPERATIONS)[ProjectOperationName],
][];
const namesWhere = (pred: (spec: (typeof operations)[number][1]) => boolean): string[] =>
  operations
    .filter(([, spec]) => pred(spec))
    .map(([name]) => name)
    .sort();
const READ_ONLY_NAME = /^(get|list|resolve)/;

describe("prefixes and task keys (section 6)", () => {
  it("normalizes and validates prefixes", () => {
    expect(normalizePrefix(" ops ")).toBe("OPS");
    for (const ok of ["OP", "OPS1", "A123456789"]) expect(isValidPrefix(ok)).toBe(true);
    for (const bad of ["", "O", "1OP", "OP-1", "ÖPS", "OPERATIONS1", "op s"]) {
      expect(isValidPrefix(bad)).toBe(false);
      expect(normalizePrefix(bad)).toBeNull();
    }
  });

  it("formats, parses and normalizes task keys", () => {
    expect(formatTaskKey("OPS", 7)).toBe("OPS-7");
    expect(parseTaskKey(" ops-7 ")).toEqual({ prefix: "OPS", number: 7 });
    expect(parseTaskKey("OPS-999999999")).toEqual({ prefix: "OPS", number: TASK_NUMBER_MAX });
    for (const bad of ["OPS-0", "OPS-07", "OPS-1000000000", "OPS7", "OPS--7", "-7"]) {
      expect(parseTaskKey(bad)).toBeNull();
      expect(normalizeTaskKey(bad)).toBeNull();
    }
    expect(normalizeTaskKey(" ops-7")).toBe("OPS-7");
  });

  it("accepts well-formed ids only (section 2 step 1)", () => {
    expect(isWellFormedId("abc_DEF-123")).toBe(true);
    expect(isWellFormedId("a".repeat(64))).toBe(true);
    for (const bad of ["", "a".repeat(65), "a b", "a/b", "ä", 7, null, undefined]) {
      expect(isWellFormedId(bad)).toBe(false);
    }
  });
});

describe("calendar dates and time zones (section 7)", () => {
  it("accepts only real dates from 1970-01-01 to 2999-12-31", () => {
    for (const ok of ["2026-02-28", "2028-02-29", "1970-01-01", "2999-12-31"]) {
      expect(parseCalendarDate(ok)).toBe(ok);
      expect(isCalendarDate(ok)).toBe(true);
    }
    for (const bad of [
      "2026-02-29",
      "2026-13-01",
      "2026-1-01",
      "1969-12-31",
      "3000-01-01",
      "2026-02-28T00:00:00Z",
      "",
    ]) {
      expect(parseCalendarDate(bad)).toBeNull();
      expect(isCalendarDate(bad)).toBe(false);
    }
  });

  it("converts calendar dates to UTC midnight and back", () => {
    const date = fromCalendarDate("2026-03-31");
    expect(date.toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(toCalendarDate(date)).toBe("2026-03-31");
    expect(() => fromCalendarDate("2026-02-29")).toThrow(RangeError);
  });

  it("validates IANA time zones and computes today in a zone", () => {
    for (const ok of ["UTC", "Asia/Jakarta", "America/New_York"]) {
      expect(isValidTimeZone(ok)).toBe(true);
    }
    for (const bad of ["Mars/Base", "", "A".repeat(65)]) expect(isValidTimeZone(bad)).toBe(false);
    const instant = new Date("2026-03-31T17:30:00Z");
    expect(todayInTimeZone("Asia/Jakarta", instant)).toBe("2026-04-01");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-03-31");
    expect(DEFAULT_TIME_ZONE).toBe("UTC");
  });
});

describe("text helpers (section 15)", () => {
  it("counts code points, not UTF-16 units", () => {
    const astral = "\u{1F600}".repeat(200);
    expect(astral.length).toBe(400);
    expect(codePointLength(astral)).toBe(200);
    expect(codePointLength("")).toBe(0);
  });

  it("detects NUL characters", () => {
    expect(hasNul("a\u0000b")).toBe(true);
    expect(hasNul("ab")).toBe(false);
  });
});

describe("sets (sections 5, 14, 15)", () => {
  it("equals the frozen lists in order", () => {
    expect(TASK_STATUSES).toEqual(["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "DONE"]);
    expect(PROJECT_STATUSES).toEqual(["PLANNING", "ACTIVE", "AT_RISK", "ON_HOLD", "COMPLETED"]);
    expect(TASK_PRIORITIES).toEqual(["NONE", "LOW", "NORMAL", "HIGH", "URGENT"]);
    expect(PROJECT_MEMBER_ROLES).toEqual(["MANAGER", "MEMBER"]);
    expect(RECURRENCE_RULES).toEqual(["DAILY", "WEEKLY", "MONTHLY"]);
    expect(TASK_KEY_KINDS).toEqual(["ACTIVE", "ALIAS", "TOMBSTONE"]);
    expect(ACTIVITY_VERBS).toEqual([
      "PROJECT_CREATED",
      "PROJECT_UPDATED",
      "PROJECT_STATUS_CHANGED",
      "PROJECT_PRIVACY_CHANGED",
      "PROJECT_REORDERED",
      "PROJECT_ARCHIVED",
      "PROJECT_RESTORED",
      "PROJECT_DUPLICATED",
      "PROJECT_DELETED",
      "MEMBER_ADDED",
      "MEMBER_REMOVED",
      "MEMBER_ROLE_CHANGED",
      "TEAM_ASSIGNED",
      "TEAM_UNASSIGNED",
      "TEAM_CREATED",
      "TEAM_UPDATED",
      "TEAM_DELETED",
      "TEAM_MEMBER_ADDED",
      "TEAM_MEMBER_REMOVED",
      "TASK_CREATED",
      "TASK_UPDATED",
      "TASK_STATUS_CHANGED",
      "TASK_PARENT_CHANGED",
      "TASK_REORDERED",
      "TASK_ARCHIVED",
      "TASK_RESTORED",
      "TASK_MOVED",
      "TASK_DUPLICATED",
      "TASK_DELETED",
      "TASK_RECURRED",
      "COMMENT_ADDED",
      "COMMENT_EDITED",
      "COMMENT_DELETED",
      "ATTACHMENT_ADDED",
      "ATTACHMENT_DELETED",
      "LABEL_CREATED",
      "LABEL_UPDATED",
      "LABEL_DELETED",
      "MILESTONE_CREATED",
      "MILESTONE_UPDATED",
      "MILESTONE_DELETED",
    ]);
    expect(ACTIVITY_VERBS).toHaveLength(41);
    expect(ACTIVITY_ENTITY_TYPES).toEqual([
      "PROJECT",
      "TASK",
      "COMMENT",
      "ATTACHMENT",
      "LABEL",
      "MILESTONE",
      "PROJECT_MEMBER",
      "PROJECT_TEAM",
      "TEAM",
      "TEAM_MEMBER",
    ]);
    expect(PROJECT_REFUSAL_CODES).toEqual([
      "NOT_FOUND",
      "MEMBERSHIP_ENDED",
      "NOT_ALLOWED",
      "ARCHIVED",
      "CONFLICT",
      "INVALID_INPUT",
      "INVALID_DATE_RANGE",
      "PREFIX_INVALID",
      "PREFIX_TAKEN",
      "KEY_SPACE_EXHAUSTED",
      "NAME_TAKEN",
      "NOT_ELIGIBLE",
      "LAST_MANAGER",
      "SUBTASK_DEPTH",
      "SUBTASK_MOVE",
      "RECURRENCE_ON_SUBTASK",
      "TOO_MANY",
      "CONFIRMATION_REQUIRED",
      "FILE_TOO_LARGE",
      "UNSUPPORTED_FILE_TYPE",
    ]);
    expect(PROJECT_COLORS).toEqual([
      "gray",
      "red",
      "orange",
      "amber",
      "green",
      "teal",
      "blue",
      "indigo",
      "violet",
      "pink",
    ]);
    expect(PROJECT_ICONS).toEqual([
      "folder",
      "briefcase",
      "rocket",
      "target",
      "flag",
      "calendar",
      "book-open",
      "code",
      "wrench",
      "bug",
      "lightbulb",
      "megaphone",
      "users",
      "heart",
      "star",
      "shield",
      "globe",
      "package",
      "layers",
      "compass",
      "palette",
      "zap",
      "bell",
      "map",
    ]);
  });

  it("names only icons that lucide-react exports", () => {
    const toPascal = (name: string) =>
      name
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
    const missing = PROJECT_ICONS.map(toPascal).filter((name) => !(name in icons));
    expect(missing).toEqual([]);
  });

  it("states the defaults", () => {
    expect(DEFAULT_TASK_STATUS).toBe("TODO");
    expect(DEFAULT_PROJECT_STATUS).toBe("PLANNING");
    expect(DEFAULT_TASK_PRIORITY).toBe("NONE");
    expect(DEFAULT_PROJECT_COLOR).toBe("blue");
    expect(DEFAULT_LABEL_COLOR).toBe("gray");
  });
});

describe("PROJECT_OPERATIONS (section 1)", () => {
  it("has 76 entries whose fields are members of the frozen sets", () => {
    expect(operations).toHaveLength(76);
    for (const [, spec] of operations) {
      expect(ACCESS_LEVELS).toContain(spec.access);
      expect(LOCK_MODES).toContain(spec.lock);
      expect(ISOLATION_EXPECTATIONS).toContain(spec.isolation);
      expect(PROJECT_MODULES).toContain(spec.module);
      for (const verb of spec.verbs) expect(ACTIVITY_VERBS).toContain(verb);
    }
  });

  it("names every activity verb at least once", () => {
    const named = new Set(operations.flatMap(([, spec]) => spec.verbs));
    expect(ACTIVITY_VERBS.filter((verb) => !named.has(verb))).toEqual([]);
  });

  it("writes no activity exactly for reads and the four favorite toggles", () => {
    const readNames = operations.map(([name]) => name).filter((n) => READ_ONLY_NAME.test(n));
    expect(readNames).toHaveLength(25);
    const verbless = namesWhere((spec) => spec.verbs.length === 0);
    expect(verbless).toEqual(
      [
        ...readNames,
        "favoriteProject",
        "unfavoriteProject",
        "favoriteTask",
        "unfavoriteTask",
      ].sort(),
    );
    expect(verbless).toHaveLength(29);
    expect(operations.length - verbless.length).toBe(47);
  });

  it("takes no lock exactly for reads, createProject and createTeam", () => {
    const readNames = operations.map(([name]) => name).filter((n) => READ_ONLY_NAME.test(n));
    const lockless = namesWhere((spec) => spec.lock === "NONE");
    expect(lockless).toEqual([...readNames, "createProject", "createTeam"].sort());
    expect(lockless).toHaveLength(27);
    for (const toggle of [
      "favoriteProject",
      "unfavoriteProject",
      "favoriteTask",
      "unfavoriteTask",
    ]) {
      expect(lockless).not.toContain(toggle);
    }
  });

  it("holds the review round 1 entries (review C5, C6, K69)", () => {
    expect(PROJECT_OPERATIONS.duplicateTask.lock).toBe("PROJECT_UPDATE");
    expect(PROJECT_OPERATIONS.addTeamMember.lock).toBe("TEAM_UPDATE");
    expect(PROJECT_OPERATIONS.removeTeamMember.lock).toBe("TEAM_UPDATE");
    expect(PROJECT_OPERATIONS.deleteTeam.lock).toBe("TEAM_UPDATE_THEN_PROJECTS");
    expect(PROJECT_OPERATIONS.assignTeamToProject.verbs).toEqual(["TEAM_ASSIGNED", "MEMBER_ADDED"]);
  });

  it("assigns each isolation expectation to exactly the frozen operations (review C5)", () => {
    expect(ISOLATION_EXPECTATIONS).toEqual(["TARGET", "CREATE", "LIST", "KEY", "TEAM"]);
    expect(namesWhere((s) => s.isolation === "CREATE")).toEqual(["createProject"]);
    expect(namesWhere((s) => s.isolation === "LIST")).toEqual(
      [
        "listProjects",
        "listWorkspaceTasks",
        "listWorkspaceMilestones",
        "listFavorites",
        "getProjectsProgress",
      ].sort(),
    );
    expect(namesWhere((s) => s.isolation === "KEY")).toEqual(["resolveTaskKey"]);
    expect(namesWhere((s) => s.isolation === "TEAM")).toEqual(
      [
        "listTeams",
        "getTeam",
        "createTeam",
        "renameTeam",
        "deleteTeam",
        "addTeamMember",
        "removeTeamMember",
        "listTeamActivity",
      ].sort(),
    );
    expect(namesWhere((s) => s.isolation === "TARGET")).toHaveLength(61);
  });

  it("holds the review round 2 entries (review R2-2)", () => {
    for (const name of ["favoriteTask", "unfavoriteTask"] as const) {
      expect(PROJECT_OPERATIONS[name].access).toBe("READ");
      expect(PROJECT_OPERATIONS[name].lock).toBe("PROJECT_SHARE");
      expect(PROJECT_OPERATIONS[name].isolation).toBe("TARGET");
    }
  });

  it("holds the review round 3 entries (review P4, R3-2)", () => {
    for (const name of ["favoriteProject", "unfavoriteProject"] as const) {
      expect(PROJECT_OPERATIONS[name]).toEqual({
        module: "favorites",
        access: "READ",
        lock: "PROJECT_SHARE",
        verbs: [],
        isolation: "TARGET",
      });
    }
    expect(PROJECT_OPERATIONS.duplicateProject).toEqual({
      module: "duplicate",
      access: "READ",
      lock: "PROJECT_UPDATE",
      verbs: ["PROJECT_DUPLICATED", "TASK_DUPLICATED"],
      isolation: "TARGET",
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(PROJECT_OPERATIONS)).toBe(true);
    expect(Object.isFrozen(PROJECT_OPERATIONS.createProject)).toBe(true);
    expect(Object.isFrozen(PROJECT_OPERATIONS.createProject.verbs)).toBe(true);
  });
});

describe("activity feed shape (section 5, review C1 and R2-1)", () => {
  it("REDACTED_SIDE is exactly a frozen { redacted: true }", () => {
    expect(REDACTED_SIDE).toEqual({ redacted: true });
    expect(Object.keys(REDACTED_SIDE)).toEqual(["redacted"]);
    expect(Object.isFrozen(REDACTED_SIDE)).toBe(true);
  });

  it("ACTIVITY_FEED_ROW_KEYS and REDACTED_ROW_NULLED_KEYS hold the frozen keys", () => {
    expect(ACTIVITY_FEED_ROW_KEYS).toEqual([
      "id",
      "projectId",
      "relatedProjectId",
      "taskId",
      "teamId",
      "actorUserId",
      "verb",
      "entityType",
      "entityId",
      "before",
      "after",
      "batchId",
      "createdAt",
      "redacted",
    ]);
    expect(ACTIVITY_FEED_ROW_KEYS).toHaveLength(14);
    expect(ACTIVITY_FEED_ROW_KEYS).not.toContain("organizationId");
    expect(REDACTED_ROW_NULLED_KEYS).toEqual(["entityId", "taskId", "teamId", "batchId"]);
    for (const key of REDACTED_ROW_NULLED_KEYS) expect(ACTIVITY_FEED_ROW_KEYS).toContain(key);
  });
});

describe("bounds (sections 5, 6, 8, 12, 15)", () => {
  it("equals the frozen numbers", () => {
    expect(TASK_NUMBER_MAX).toBe(999999999);
    expect(RANK_GAP).toBe(1024);
    expect(RANK_MAX).toBe(2147483647);
    expect(BULK_MAX).toBe(100);
    expect(MAX_UPLOAD_FILES).toBe(10);
    expect(MAX_TASK_LABELS).toBe(20);
    expect(LIST_DEFAULT).toBe(50);
    expect(LIST_MAX).toBe(200);
    expect(ACTIVITY_LIST_MAX).toBe(100);
    expect(ACTIVITY_VALUE_MAX_KEYS).toBe(16);
    expect(ACTIVITY_VALUE_MAX_BYTES).toBe(4096);
    expect(ACTIVITY_TEXT_MAX).toBe(200);
    expect(ESTIMATE_MAX_MINUTES).toBe(1000000);
    expect(PROJECT_FILE_CLEANUP_QUEUE).toBe("project-file-cleanup");
    expect(PROJECT_FILE_CLEANUP_CRON).toBe("* * * * *");
    expect(TRANSACTION_OPTIONS).toEqual({ maxWait: 10000, timeout: 30000 });
  });

  it("equals the text length table of section 15", () => {
    expect(PROJECT_NAME_MAX).toBe(80);
    expect(PROJECT_DESCRIPTION_MAX).toBe(5000);
    expect(TASK_TITLE_MAX).toBe(200);
    expect(TASK_DESCRIPTION_MAX).toBe(20000);
    expect(COMMENT_BODY_MAX).toBe(10000);
    expect(LABEL_NAME_MAX).toBe(40);
    expect(MILESTONE_NAME_MAX).toBe(80);
    expect(MILESTONE_DESCRIPTION_MAX).toBe(2000);
    expect(TEAM_NAME_MAX).toBe(60);
    expect(FILE_NAME_MAX).toBe(255);
    expect(TEXT_LENGTHS).toEqual({
      projectName: { min: 1, max: 80 },
      projectDescription: { min: 0, max: 5000 },
      taskTitle: { min: 1, max: 200 },
      taskDescription: { min: 0, max: 20000 },
      commentBody: { min: 1, max: 10000 },
      labelName: { min: 1, max: 40 },
      milestoneName: { min: 1, max: 80 },
      milestoneDescription: { min: 0, max: 2000 },
      teamName: { min: 1, max: 60 },
      fileName: { min: 1, max: 255 },
    });
  });
});
