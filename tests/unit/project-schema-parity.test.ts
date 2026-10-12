// Phase 14 schema parity (C1, D-01): every DOMAIN_MODELS name is a generated model (a misspelt
// name would silently turn scoping off), the 18 Phase 14 models are scoped, and every frozen
// contract set equals its generated enum in declaration order.
import { describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client";
import {
  ProjectActivityEntity,
  ProjectActivityVerb,
  ProjectMemberRole,
  ProjectStatus,
  RecurrenceRule,
  TaskKeyKind,
  TaskPriority,
  TaskStatus,
} from "../../src/generated/prisma/enums";
import {
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_VERBS,
  PROJECT_MEMBER_ROLES,
  PROJECT_STATUSES,
  RECURRENCE_RULES,
  TASK_KEY_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "../../src/lib/projects/contract";
import { DOMAIN_MODELS } from "../../src/lib/scoped-db";

const PHASE_14_MODELS = [
  "Project",
  "ProjectMember",
  "Team",
  "TeamMember",
  "ProjectTeam",
  "ProjectLabel",
  "ProjectMilestone",
  "Task",
  "TaskLabel",
  "TaskComment",
  "TaskAttachment",
  "ProjectFavorite",
  "TaskFavorite",
  "ProjectTaskCounter",
  "ProjectKeyPrefix",
  "TaskKey",
  "ProjectActivity",
  "ProjectFileCleanup",
] as const;

describe("DOMAIN_MODELS parity (C1)", () => {
  it("lists only generated Prisma.ModelName values", () => {
    const generated = new Set<string>(Object.values(Prisma.ModelName));
    for (const name of DOMAIN_MODELS) {
      expect(generated.has(name), `${name} is not a generated model`).toBe(true);
    }
  });

  it("scopes the 18 Phase 14 models", () => {
    const scoped = new Set<string>(DOMAIN_MODELS);
    for (const name of PHASE_14_MODELS) {
      expect(scoped.has(name), `${name} is missing from DOMAIN_MODELS`).toBe(true);
    }
    expect(PHASE_14_MODELS).toHaveLength(18);
  });
});

describe("contract sets equal the generated enums, in declaration order", () => {
  it.each([
    ["TaskStatus", TASK_STATUSES, TaskStatus],
    ["ProjectStatus", PROJECT_STATUSES, ProjectStatus],
    ["TaskPriority", TASK_PRIORITIES, TaskPriority],
    ["ProjectMemberRole", PROJECT_MEMBER_ROLES, ProjectMemberRole],
    ["RecurrenceRule", RECURRENCE_RULES, RecurrenceRule],
    ["TaskKeyKind", TASK_KEY_KINDS, TaskKeyKind],
    ["ProjectActivityVerb", ACTIVITY_VERBS, ProjectActivityVerb],
    ["ProjectActivityEntity", ACTIVITY_ENTITY_TYPES, ProjectActivityEntity],
  ] as const)("%s", (_name, contractSet, generatedEnum) => {
    expect([...contractSet]).toEqual(Object.values(generatedEnum));
  });

  it("has the 41 verbs and 10 entity types of contract section 5", () => {
    expect(Object.values(ProjectActivityVerb)).toHaveLength(41);
    expect(Object.values(ProjectActivityEntity)).toHaveLength(10);
  });
});
