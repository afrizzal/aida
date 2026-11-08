-- Phase 10 team foundation (plan 10-01; V-14, D-04, D-12, D-14, D-20, D-22, D-23, V-28).
-- Six org-scoped models, three enums and one nullable unique column on "invitation". No existing
-- table changes except "invitation" (one added column and its unique index), and no DROP.
--
-- Generated with `prisma migrate dev --create-only --name team_foundation` in the plan's own
-- disposable rule J dev database and reviewed by hand. Prisma also proposed dropping the
-- "searchVector" generated columns and their indexes on "Message" and "Ticket" (they are managed
-- in raw SQL, not in schema.prisma); those four statements were removed by hand, as in the earlier
-- migrations that keep them (Phase 9 F7).
--
-- Owner item O-4 (12.2-o4) is open: no unique constraint on "member" ("organizationId", "userId")
-- is added, and no member row is read, deleted, rewritten or deduplicated (V-06).

-- CreateEnum
CREATE TYPE "MemberAuditAction" AS ENUM ('INVITATION_CREATED', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED', 'ROLE_CHANGED', 'MEMBER_DEACTIVATED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNED', 'CUSTOMER_REPLY', 'MENTION', 'SLA_AT_RISK', 'SLA_BREACHED');

-- CreateEnum
CREATE TYPE "NotificationDigestStatus" AS ENUM ('CLAIMED', 'SENT', 'RELEASED', 'CANCELED');

-- AlterTable
ALTER TABLE "invitation" ADD COLUMN     "tokenHash" TEXT;

-- CreateTable
CREATE TABLE "MemberAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "invitationId" TEXT,
    "action" "MemberAuditAction" NOT NULL,
    "oldRole" TEXT,
    "newRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "NotificationType" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "unassignedFallback" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "digestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "digest" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unassignedTickets" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDigest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "notificationIds" TEXT[],
    "status" "NotificationDigestStatus" NOT NULL DEFAULT 'CLAIMED',
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageMention" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mentionedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberAuditEvent_organizationId_createdAt_idx" ON "MemberAuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_recipientUserId_archivedAt_read_idx" ON "Notification"("organizationId", "recipientUserId", "archivedAt", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_organizationId_recipientUserId_type_eventKey_key" ON "Notification"("organizationId", "recipientUserId", "type", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_organizationId_userId_type_key" ON "NotificationPreference"("organizationId", "userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_organizationId_userId_key" ON "NotificationSetting"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "NotificationDigest_organizationId_recipientUserId_status_idx" ON "NotificationDigest"("organizationId", "recipientUserId", "status");

-- CreateIndex
CREATE INDEX "MessageMention_organizationId_idx" ON "MessageMention"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageMention_messageId_mentionedUserId_key" ON "MessageMention"("messageId", "mentionedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tokenHash_key" ON "invitation"("tokenHash");

-- AddForeignKey
ALTER TABLE "MemberAuditEvent" ADD CONSTRAINT "MemberAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDigest" ADD CONSTRAINT "NotificationDigest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MemberAuditEvent is append-only at the database level, the same pattern as TicketAuditEvent
-- (aida_ticket_audit_event_immutable in 20261108140000_inbox). actorUserId and targetUserId are
-- text with no user relation, so removing a user never touches an audit row (D-12, V-14).
CREATE OR REPLACE FUNCTION aida_member_audit_event_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'MemberAuditEvent is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aida_member_audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "MemberAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION aida_member_audit_event_immutable();
