// Phase 14 fix batch F4, Codex diff critique round 2 (run decision K73): every read in
// src/lib/projects returns content, rows, counts, cursors or hasMore only while the reader can
// read now, in every query of the response. Each case parks the read right after its access
// check (afterReadCheck; createServiceRace.holdAt resolves with the parked read's own backend
// PID), changes access while it waits, then lets the read run its content queries. No timed
// waits. The changes: the reader's organization member row is removed, the reader's project
// member row is removed, the project becomes private, the task moves into a private project.
// Every case first runs the same read without a change and asserts it returns the content, so
// an empty result after the change is not vacuous.
import { expect } from "vitest";
import { listProjectActivity, listTaskActivity, listTeamActivity } from "@/lib/projects/activity";
import {
  getTaskAttachmentForDownload,
  listProjectAttachments,
  listTaskAttachments,
} from "@/lib/projects/attachments";
import { listTaskComments } from "@/lib/projects/comments";
import { listFavorites } from "@/lib/projects/favorites";
import { listLabels } from "@/lib/projects/labels";
import { listEligibleAssignees, listProjectMembers } from "@/lib/projects/members";
import { listProjectMilestones, listWorkspaceMilestones } from "@/lib/projects/milestones";
import { getProjectProgress, getProjectsProgress, getTaskProgress } from "@/lib/projects/progress";
import { getProject, listProjects } from "@/lib/projects/projects";
import { getTask, listProjectTasks, listWorkspaceTasks } from "@/lib/projects/tasks";
import { getTeam, listProjectTeams, listTeams } from "@/lib/projects/teams";
import {
  describeReadRaces,
  emptyPage,
  gone,
  PROJECT_CHANGES,
  type ReadCase,
  TASK_CHANGES,
} from "../support/project-read-race";

const families: Record<string, ReadCase[]> = {
  "task reads": [
    {
      name: "getTask",
      operation: "getTask",
      changes: TASK_CHANGES,
      read: (w) => getTask(w.reader, w.taskId),
      before: (r) => {
        expect(r.ok).toBe(true);
        expect(r.task.labels).toHaveLength(1);
        expect(r.task.milestone).not.toBeNull();
        expect(r.task.subtasks).toHaveLength(1);
      },
      after: gone,
    },
    {
      name: "listProjectTasks",
      operation: "listProjectTasks",
      changes: PROJECT_CHANGES,
      read: (w) => listProjectTasks(w.reader, w.projectId, { limit: 1 }),
      before: (r) => expect(r).toMatchObject({ ok: true, hasMore: false, tasks: [{}] }),
      after: () => ({ ok: true, tasks: [], ...emptyPage }),
    },
    {
      name: "listWorkspaceTasks",
      operation: "listWorkspaceTasks",
      changes: PROJECT_CHANGES,
      read: (w) => listWorkspaceTasks(w.reader, {}),
      before: (r) => expect(r.tasks.length).toBeGreaterThan(0),
      after: () => ({ ok: true, tasks: [], ...emptyPage }),
    },
    {
      name: "listFavorites",
      operation: "listFavorites",
      changes: PROJECT_CHANGES,
      read: (w) => listFavorites(w.reader, {}),
      before: (r) => {
        expect(r.projects).toHaveLength(1);
        expect(r.tasks).toHaveLength(1);
      },
      after: () => ({
        ok: true,
        projects: [],
        tasks: [],
        hasMoreProjects: false,
        hasMoreTasks: false,
        nextProjectsCursor: null,
        nextTasksCursor: null,
      }),
    },
  ],
  lists: [
    {
      name: "getProject",
      operation: "getProject",
      changes: PROJECT_CHANGES,
      read: (w) => getProject(w.reader, w.projectId),
      before: (r) => expect(r.ok).toBe(true),
      after: gone,
    },
    {
      name: "listProjects",
      operation: "listProjects",
      changes: PROJECT_CHANGES,
      read: (w) => listProjects(w.reader, {}),
      before: (r) => expect(r.projects.length).toBeGreaterThan(0),
      after: () => ({ ok: true, projects: [], ...emptyPage }),
    },
    {
      name: "listLabels",
      operation: "listLabels",
      changes: PROJECT_CHANGES,
      read: (w) => listLabels(w.reader, w.projectId),
      before: (r) => expect(r.labels).toHaveLength(1),
      after: () => ({ ok: true, labels: [] }),
    },
    {
      name: "listProjectMilestones",
      operation: "listProjectMilestones",
      changes: PROJECT_CHANGES,
      read: (w) => listProjectMilestones(w.reader, w.projectId),
      before: (r) => expect(r.milestones).toMatchObject([{ taskCount: 1 }]),
      after: () => ({ ok: true, milestones: [], ...emptyPage }),
    },
    {
      name: "listWorkspaceMilestones",
      operation: "listWorkspaceMilestones",
      changes: PROJECT_CHANGES,
      read: (w) => listWorkspaceMilestones(w.reader, {}),
      before: (r) => expect(r.milestones).toHaveLength(1),
      after: () => ({ ok: true, milestones: [], ...emptyPage }),
    },
    {
      name: "listProjectMembers",
      operation: "listProjectMembers",
      changes: PROJECT_CHANGES,
      read: (w) => listProjectMembers(w.reader, w.projectId),
      before: (r) => expect(r.members.length).toBeGreaterThan(0),
      after: () => ({ ok: true, members: [], ...emptyPage }),
    },
    {
      name: "listEligibleAssignees",
      operation: "listEligibleAssignees",
      changes: PROJECT_CHANGES,
      read: (w) => listEligibleAssignees(w.reader, w.projectId),
      before: (r) => expect(r.assignees.length).toBeGreaterThan(0),
      after: () => ({ ok: true, assignees: [], ...emptyPage }),
    },
    {
      name: "listProjectTeams",
      operation: "listProjectTeams",
      changes: PROJECT_CHANGES,
      read: (w) => listProjectTeams(w.reader, w.projectId),
      before: (r) => expect(r.teams).toHaveLength(1),
      after: () => ({ ok: true, teams: [], ...emptyPage }),
    },
  ],
  progress: [
    {
      name: "getProjectProgress",
      operation: "getProjectProgress",
      changes: PROJECT_CHANGES,
      read: (w) => getProjectProgress(w.reader, w.projectId),
      before: (r) => expect(r).toMatchObject({ ok: true, total: 1 }),
      after: gone,
    },
    {
      name: "getProjectsProgress",
      operation: "getProjectsProgress",
      changes: PROJECT_CHANGES,
      read: (w) => getProjectsProgress(w.reader, [w.projectId]),
      before: (r) => expect(r.projects).toMatchObject([{ total: 1 }]),
      after: () => ({ ok: true, projects: [] }),
    },
    {
      name: "getTaskProgress",
      operation: "getTaskProgress",
      changes: TASK_CHANGES,
      read: (w) => getTaskProgress(w.reader, w.taskId),
      before: (r) => expect(r).toMatchObject({ ok: true, done: 1, total: 1 }),
      after: gone,
    },
  ],
  "activity feeds": [
    {
      name: "listProjectActivity",
      operation: "listProjectActivity",
      changes: PROJECT_CHANGES,
      read: (w) => listProjectActivity(w.reader, w.projectId, { limit: 1 }),
      before: (r) => expect(r).toMatchObject({ ok: true, hasMore: true, rows: [{}] }),
      after: () => ({ ok: true, rows: [], ...emptyPage }),
    },
    {
      name: "listTaskActivity",
      operation: "listTaskActivity",
      changes: TASK_CHANGES,
      read: (w) => listTaskActivity(w.reader, w.taskId),
      before: (r) => expect(r.rows).toHaveLength(1),
      after: () => ({ ok: true, rows: [], ...emptyPage }),
    },
    {
      name: "listTeamActivity",
      operation: "listTeamActivity",
      changes: PROJECT_CHANGES,
      read: (w) => listTeamActivity(w.reader, w.teamId),
      before: (r, w) => expect(r.rows).toMatchObject([{ projectId: w.projectId }]),
      after: () => ({ ok: true, rows: [], ...emptyPage }),
    },
  ],
  "team reads": [
    {
      name: "getTeam",
      operation: "getTeam",
      changes: PROJECT_CHANGES,
      read: (w) => getTeam(w.reader, w.teamId),
      before: (r) => expect(r.team.projects).toHaveLength(1),
      after: (change, w) =>
        change === "orgMember"
          ? gone(change)
          : {
              ok: true,
              team: {
                id: w.teamId,
                name: expect.any(String),
                members: [{ userId: w.manager.userId, name: expect.any(String) }],
                projects: [],
              },
            },
    },
    {
      name: "listTeams",
      operation: "listTeams",
      changes: ["orgMember"],
      read: (w) => listTeams(w.reader),
      before: (r) => expect(r.teams).toHaveLength(1),
      after: () => ({ ok: true, teams: [], ...emptyPage }),
    },
  ],
  "content reads (F3) and the organization member row": [
    {
      name: "listTaskComments",
      operation: "listTaskComments",
      changes: ["orgMember"],
      read: (w) => listTaskComments(w.reader, w.taskId),
      before: (r) => expect(r.comments).toHaveLength(1),
      after: () => ({ ok: true, comments: [], ...emptyPage }),
    },
    {
      name: "listTaskAttachments",
      operation: "listTaskAttachments",
      changes: ["orgMember"],
      read: (w) => listTaskAttachments(w.reader, w.taskId),
      before: (r) => expect(r.attachments).toHaveLength(1),
      after: () => ({ ok: true, attachments: [], ...emptyPage }),
    },
    {
      name: "listProjectAttachments",
      operation: "listProjectAttachments",
      changes: ["orgMember"],
      read: (w) => listProjectAttachments(w.reader, w.projectId),
      before: (r) => expect(r.attachments).toHaveLength(1),
      after: () => ({ ok: true, attachments: [], ...emptyPage }),
    },
    {
      name: "getTaskAttachmentForDownload",
      operation: "getTaskAttachmentForDownload",
      changes: ["orgMember"],
      read: (w) => getTaskAttachmentForDownload(w.reader, w.attachmentId),
      before: (r) => expect(r.ok).toBe(true),
      after: gone,
    },
  ],
};

describeReadRaces(families);
