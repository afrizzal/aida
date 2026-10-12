-- Phase 14 (Projects foundation): the whole Phase 14 schema. Enums ProjectStatus,
-- ProjectMemberRole, TaskStatus, TaskPriority, RecurrenceRule, TaskKeyKind, ProjectActivityVerb and
-- ProjectActivityEntity; tables Project, ProjectMember, Team, TeamMember, ProjectTeam, ProjectLabel,
-- ProjectMilestone, Task, TaskLabel, TaskComment, TaskAttachment, ProjectFavorite, TaskFavorite,
-- ProjectTaskCounter, ProjectKeyPrefix, TaskKey, ProjectActivity and ProjectFileCleanup.
-- Generated with `prisma migrate dev --create-only --name projects_foundation` against the fresh
-- scratch database aida_p14_projects (folder 20261109122218_projects_foundation, renamed to
-- 20261113100000_projects_foundation), then edited by hand:
--   * removed Prisma's generated warning comment block (it named the two column drops below);
--   * removed the generated DROP INDEX of "Message_searchVector_idx" and "Ticket_searchVector_idx"
--     and the generated ALTER TABLE ... DROP COLUMN of the "searchVector" columns of "Message" and
--     "Ticket" (all four are hand-written in 20260701234808_ticket_search and invisible to Prisma;
--     removed as in 11-01, 12-01, 12.1-01 and 12.2-01);
--   * the generated diff named no other hand-written object (no SavedView partial index, no
--     Phase 12.1 trigger, function or partial index, no TicketRelation or Ticket CHECK, no
--     KbProposal CHECK or aida_kb_proposal_status_fence), so nothing else was removed or moved;
--   * kept every other generated statement unchanged; the 16 composite foreign keys use
--     ON DELETE RESTRICT ON UPDATE RESTRICT (C2), the single-column organization and user keys
--     keep Prisma's actions;
--   * added the hand-written objects below the separator: the CHECKs named there, the expression
--     unique indexes Team_organizationId_lower_name_key, ProjectLabel_project_lower_name_key and
--     ProjectMilestone_project_lower_name_key, the partial unique index
--     Task_recurrence_predecessor_key, the function aida_task_subtask_depth_guard with the trigger
--     aida_task_subtask_depth, and the function aida_project_activity_immutable with the trigger
--     aida_project_activity_no_update_delete.
-- The file holds no explicit transaction statement. This file is final once applied: no later
-- plan edits it.

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'AT_RISK', 'ON_HOLD', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProjectMemberRole" AS ENUM ('MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('NONE', 'LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RecurrenceRule" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "TaskKeyKind" AS ENUM ('ACTIVE', 'ALIAS', 'TOMBSTONE');

-- CreateEnum
CREATE TYPE "ProjectActivityVerb" AS ENUM ('PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_STATUS_CHANGED', 'PROJECT_PRIVACY_CHANGED', 'PROJECT_REORDERED', 'PROJECT_ARCHIVED', 'PROJECT_RESTORED', 'PROJECT_DUPLICATED', 'PROJECT_DELETED', 'MEMBER_ADDED', 'MEMBER_REMOVED', 'MEMBER_ROLE_CHANGED', 'TEAM_ASSIGNED', 'TEAM_UNASSIGNED', 'TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_DELETED', 'TEAM_MEMBER_ADDED', 'TEAM_MEMBER_REMOVED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_STATUS_CHANGED', 'TASK_PARENT_CHANGED', 'TASK_REORDERED', 'TASK_ARCHIVED', 'TASK_RESTORED', 'TASK_MOVED', 'TASK_DUPLICATED', 'TASK_DELETED', 'TASK_RECURRED', 'COMMENT_ADDED', 'COMMENT_EDITED', 'COMMENT_DELETED', 'ATTACHMENT_ADDED', 'ATTACHMENT_DELETED', 'LABEL_CREATED', 'LABEL_UPDATED', 'LABEL_DELETED', 'MILESTONE_CREATED', 'MILESTONE_UPDATED', 'MILESTONE_DELETED');

-- CreateEnum
CREATE TYPE "ProjectActivityEntity" AS ENUM ('PROJECT', 'TASK', 'COMMENT', 'ATTACHMENT', 'LABEL', 'MILESTONE', 'PROJECT_MEMBER', 'PROJECT_TEAM', 'TEAM', 'TEAM_MEMBER');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descriptionMarkdown" TEXT,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "icon" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "dueDate" DATE,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "keyPrefix" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectMemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTeam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectLabel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'gray',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descriptionMarkdown" TEXT,
    "date" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "number" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionMarkdown" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NONE',
    "assigneeUserId" TEXT,
    "createdByUserId" TEXT,
    "startDate" DATE,
    "dueDate" DATE,
    "estimateMinutes" INTEGER,
    "milestoneId" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "recurrenceRule" "RecurrenceRule",
    "recurrenceAnchor" DATE,
    "recurrenceTimeZone" TEXT,
    "recurrencePredecessorId" TEXT,
    "recurrenceSpawned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskLabel" (
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLabel_pkey" PRIMARY KEY ("taskId","labelId")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "bodyMarkdown" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFavorite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskFavorite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTaskCounter" (
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectTaskCounter_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectKeyPrefix" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectKeyPrefix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "TaskKeyKind" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "relatedProjectId" TEXT,
    "taskId" TEXT,
    "teamId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "verb" "ProjectActivityVerb" NOT NULL,
    "entityType" "ProjectActivityEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "batchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFileCleanup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFileCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_organizationId_archivedAt_position_idx" ON "Project"("organizationId", "archivedAt", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_id_key" ON "Project"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_keyPrefix_key" ON "Project"("organizationId", "keyPrefix");

-- CreateIndex
CREATE INDEX "ProjectMember_organizationId_userId_idx" ON "ProjectMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_organizationId_projectId_userId_key" ON "ProjectMember"("organizationId", "projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_id_key" ON "Team"("organizationId", "id");

-- CreateIndex
CREATE INDEX "TeamMember_organizationId_userId_idx" ON "TeamMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_organizationId_teamId_userId_key" ON "TeamMember"("organizationId", "teamId", "userId");

-- CreateIndex
CREATE INDEX "ProjectTeam_organizationId_teamId_idx" ON "ProjectTeam"("organizationId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTeam_organizationId_projectId_teamId_key" ON "ProjectTeam"("organizationId", "projectId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectLabel_organizationId_projectId_id_key" ON "ProjectLabel"("organizationId", "projectId", "id");

-- CreateIndex
CREATE INDEX "ProjectMilestone_organizationId_date_idx" ON "ProjectMilestone"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestone_organizationId_projectId_id_key" ON "ProjectMilestone"("organizationId", "projectId", "id");

-- CreateIndex
CREATE INDEX "Task_organizationId_projectId_status_rank_idx" ON "Task"("organizationId", "projectId", "status", "rank");

-- CreateIndex
CREATE INDEX "Task_organizationId_projectId_parentId_rank_idx" ON "Task"("organizationId", "projectId", "parentId", "rank");

-- CreateIndex
CREATE INDEX "Task_organizationId_assigneeUserId_idx" ON "Task"("organizationId", "assigneeUserId");

-- CreateIndex
CREATE INDEX "Task_organizationId_dueDate_idx" ON "Task"("organizationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_id_key" ON "Task"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_projectId_id_key" ON "Task"("organizationId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_key_key" ON "Task"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_projectId_number_key" ON "Task"("organizationId", "projectId", "number");

-- CreateIndex
CREATE INDEX "TaskLabel_organizationId_projectId_labelId_idx" ON "TaskLabel"("organizationId", "projectId", "labelId");

-- CreateIndex
CREATE INDEX "TaskComment_organizationId_taskId_createdAt_idx" ON "TaskComment"("organizationId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskAttachment_organizationId_taskId_createdAt_idx" ON "TaskAttachment"("organizationId", "taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAttachment_organizationId_storageKey_key" ON "TaskAttachment"("organizationId", "storageKey");

-- CreateIndex
CREATE INDEX "ProjectFavorite_organizationId_projectId_idx" ON "ProjectFavorite"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFavorite_organizationId_userId_projectId_key" ON "ProjectFavorite"("organizationId", "userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskFavorite_organizationId_userId_taskId_key" ON "TaskFavorite"("organizationId", "userId", "taskId");

-- CreateIndex
CREATE INDEX "ProjectKeyPrefix_organizationId_projectId_idx" ON "ProjectKeyPrefix"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectKeyPrefix_organizationId_prefix_key" ON "ProjectKeyPrefix"("organizationId", "prefix");

-- CreateIndex
CREATE INDEX "TaskKey_organizationId_taskId_idx" ON "TaskKey"("organizationId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskKey_organizationId_normalizedKey_key" ON "TaskKey"("organizationId", "normalizedKey");

-- CreateIndex
CREATE INDEX "ProjectActivity_organizationId_projectId_createdAt_id_idx" ON "ProjectActivity"("organizationId", "projectId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ProjectActivity_organizationId_relatedProjectId_createdAt_idx" ON "ProjectActivity"("organizationId", "relatedProjectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivity_organizationId_taskId_createdAt_idx" ON "ProjectActivity"("organizationId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivity_organizationId_teamId_createdAt_idx" ON "ProjectActivity"("organizationId", "teamId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivity_organizationId_batchId_idx" ON "ProjectActivity"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "ProjectFileCleanup_nextAttemptAt_createdAt_idx" ON "ProjectFileCleanup"("nextAttemptAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFileCleanup_organizationId_storageKey_key" ON "ProjectFileCleanup"("organizationId", "storageKey");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_organizationId_teamId_fkey" FOREIGN KEY ("organizationId", "teamId") REFERENCES "Team"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_organizationId_teamId_fkey" FOREIGN KEY ("organizationId", "teamId") REFERENCES "Team"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectLabel" ADD CONSTRAINT "ProjectLabel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLabel" ADD CONSTRAINT "ProjectLabel_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_projectId_parentId_fkey" FOREIGN KEY ("organizationId", "projectId", "parentId") REFERENCES "Task"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_projectId_milestoneId_fkey" FOREIGN KEY ("organizationId", "projectId", "milestoneId") REFERENCES "ProjectMilestone"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_organizationId_projectId_taskId_fkey" FOREIGN KEY ("organizationId", "projectId", "taskId") REFERENCES "Task"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_organizationId_projectId_labelId_fkey" FOREIGN KEY ("organizationId", "projectId", "labelId") REFERENCES "ProjectLabel"("organizationId", "projectId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "Task"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "Task"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFavorite" ADD CONSTRAINT "ProjectFavorite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFavorite" ADD CONSTRAINT "ProjectFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFavorite" ADD CONSTRAINT "ProjectFavorite_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TaskFavorite" ADD CONSTRAINT "TaskFavorite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFavorite" ADD CONSTRAINT "TaskFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFavorite" ADD CONSTRAINT "TaskFavorite_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "Task"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectTaskCounter" ADD CONSTRAINT "ProjectTaskCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskCounter" ADD CONSTRAINT "ProjectTaskCounter_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectKeyPrefix" ADD CONSTRAINT "ProjectKeyPrefix_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskKey" ADD CONSTRAINT "TaskKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFileCleanup" ADD CONSTRAINT "ProjectFileCleanup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written objects (D-01, D-03, D-05, D-09, D-10, K67): Prisma cannot express them. Any
-- migration Prisma generates after this one must keep them (delete any DROP statement for them).
-- ---------------------------------------------------------------------------

-- Project (contract section 15)
ALTER TABLE "Project" ADD CONSTRAINT "Project_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 80);
ALTER TABLE "Project" ADD CONSTRAINT "Project_description_length_check"
  CHECK ("descriptionMarkdown" IS NULL OR char_length("descriptionMarkdown") <= 5000);
ALTER TABLE "Project" ADD CONSTRAINT "Project_color_check"
  CHECK ("color" IN ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink'));
ALTER TABLE "Project" ADD CONSTRAINT "Project_icon_check"
  CHECK ("icon" IS NULL OR "icon" ~ '^[a-z0-9-]{1,40}$');
ALTER TABLE "Project" ADD CONSTRAINT "Project_key_prefix_check"
  CHECK ("keyPrefix" ~ '^[A-Z][A-Z0-9]{1,9}$');
ALTER TABLE "Project" ADD CONSTRAINT "Project_position_check"
  CHECK ("position" >= 0);
ALTER TABLE "Project" ADD CONSTRAINT "Project_version_check"
  CHECK ("version" >= 0);
ALTER TABLE "ProjectKeyPrefix" ADD CONSTRAINT "ProjectKeyPrefix_prefix_check"
  CHECK ("prefix" ~ '^[A-Z][A-Z0-9]{1,9}$');

-- Teams, labels and milestones
ALTER TABLE "Team" ADD CONSTRAINT "Team_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 60);
ALTER TABLE "ProjectLabel" ADD CONSTRAINT "ProjectLabel_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 40);
ALTER TABLE "ProjectLabel" ADD CONSTRAINT "ProjectLabel_color_check"
  CHECK ("color" IN ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink'));
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_name_length_check"
  CHECK (char_length("name") BETWEEN 1 AND 80);
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_description_length_check"
  CHECK ("descriptionMarkdown" IS NULL OR char_length("descriptionMarkdown") <= 2000);
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_version_check"
  CHECK ("version" >= 0);

-- Names are unique case-insensitively (NAME_TAKEN)
CREATE UNIQUE INDEX "Team_organizationId_lower_name_key"
  ON "Team" ("organizationId", lower("name"));
CREATE UNIQUE INDEX "ProjectLabel_project_lower_name_key"
  ON "ProjectLabel" ("organizationId", "projectId", lower("name"));
CREATE UNIQUE INDEX "ProjectMilestone_project_lower_name_key"
  ON "ProjectMilestone" ("organizationId", "projectId", lower("name"));

-- Task (D-03, D-09, D-10, contract sections 6, 7 and 15)
ALTER TABLE "Task" ADD CONSTRAINT "Task_no_self_parent_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "Task" ADD CONSTRAINT "Task_dates_check"
  CHECK ("startDate" IS NULL OR "dueDate" IS NULL OR "startDate" <= "dueDate");
ALTER TABLE "Task" ADD CONSTRAINT "Task_title_length_check"
  CHECK (char_length("title") BETWEEN 1 AND 200);
ALTER TABLE "Task" ADD CONSTRAINT "Task_description_length_check"
  CHECK ("descriptionMarkdown" IS NULL OR char_length("descriptionMarkdown") <= 20000);
ALTER TABLE "Task" ADD CONSTRAINT "Task_estimate_check"
  CHECK ("estimateMinutes" IS NULL OR "estimateMinutes" BETWEEN 0 AND 1000000);
ALTER TABLE "Task" ADD CONSTRAINT "Task_rank_check"
  CHECK ("rank" >= 0);
ALTER TABLE "Task" ADD CONSTRAINT "Task_version_check"
  CHECK ("version" >= 0);
ALTER TABLE "Task" ADD CONSTRAINT "Task_number_check"
  CHECK ("number" BETWEEN 1 AND 999999999);
ALTER TABLE "Task" ADD CONSTRAINT "Task_key_format_check"
  CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$');
ALTER TABLE "TaskKey" ADD CONSTRAINT "TaskKey_key_format_check"
  CHECK ("normalizedKey" ~ '^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$');
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrence_fields_check"
  CHECK (
    ("recurrenceRule" IS NULL AND "recurrenceAnchor" IS NULL AND "recurrenceTimeZone" IS NULL)
    OR ("recurrenceRule" IS NOT NULL AND "recurrenceAnchor" IS NOT NULL AND "recurrenceTimeZone" IS NOT NULL)
  );
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrence_top_level_check"
  CHECK ("recurrenceRule" IS NULL OR "parentId" IS NULL);
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrence_time_zone_check"
  CHECK ("recurrenceTimeZone" IS NULL OR char_length("recurrenceTimeZone") <= 64);

-- At most one successor per predecessor (D-09, the exactly-once fence)
CREATE UNIQUE INDEX "Task_recurrence_predecessor_key"
  ON "Task" ("organizationId", "recurrencePredecessorId")
  WHERE "recurrencePredecessorId" IS NOT NULL;

-- Comments, attachments, counters and the cleanup outbox
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_body_length_check"
  CHECK (char_length("bodyMarkdown") BETWEEN 1 AND 10000);
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_version_check"
  CHECK ("version" >= 0);
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_storage_key_check"
  CHECK ("storageKey" ~ '^[a-z0-9]+\.[a-z0-9]{1,8}$');
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_filename_length_check"
  CHECK (char_length("originalFilename") BETWEEN 1 AND 255);
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_size_check"
  CHECK ("sizeBytes" BETWEEN 1 AND 10485760);
ALTER TABLE "ProjectFileCleanup" ADD CONSTRAINT "ProjectFileCleanup_storage_key_check"
  CHECK ("storageKey" ~ '^[a-z0-9]+\.[a-z0-9]{1,8}$');
ALTER TABLE "ProjectFileCleanup" ADD CONSTRAINT "ProjectFileCleanup_attempts_check"
  CHECK ("attempts" >= 0);
ALTER TABLE "ProjectTaskCounter" ADD CONSTRAINT "ProjectTaskCounter_last_number_check"
  CHECK ("lastNumber" BETWEEN 0 AND 999999999);

-- ProjectActivity (D-05, contract section 5)
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_scope_check"
  CHECK ("projectId" IS NOT NULL OR "teamId" IS NOT NULL);
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_before_size_check"
  CHECK ("before" IS NULL OR octet_length("before"::text) <= 4096);
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_after_size_check"
  CHECK ("after" IS NULL OR octet_length("after"::text) <= 4096);

-- One subtask level (D-03, K61, contract section 4). The parent row is read FOR SHARE with the
-- organization term, so a concurrent change of that parent's own parentId waits or is seen.
CREATE OR REPLACE FUNCTION aida_task_subtask_depth_guard()
RETURNS TRIGGER AS $$
DECLARE
  parent_parent_id TEXT;
BEGIN
  IF NEW."parentId" IS NOT NULL THEN
    SELECT t."parentId" INTO parent_parent_id
      FROM "Task" t
      WHERE t."id" = NEW."parentId" AND t."organizationId" = NEW."organizationId"
      FOR SHARE;
    IF parent_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Task subtask depth exceeded';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (
      SELECT 1 FROM "Task" c
        WHERE c."parentId" = NEW."id" AND c."organizationId" = NEW."organizationId"
    ) THEN
      RAISE EXCEPTION 'Task with subtasks cannot become a subtask';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER aida_task_subtask_depth
  BEFORE INSERT OR UPDATE OF "parentId" ON "Task"
  FOR EACH ROW EXECUTE FUNCTION aida_task_subtask_depth_guard();

-- ProjectActivity is append-only at the database level, the same pattern as TicketAuditEvent
-- (aida_ticket_audit_event_immutable in 20261108140000_inbox).
CREATE OR REPLACE FUNCTION aida_project_activity_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ProjectActivity is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aida_project_activity_no_update_delete
  BEFORE UPDATE OR DELETE ON "ProjectActivity"
  FOR EACH ROW EXECUTE FUNCTION aida_project_activity_immutable();
