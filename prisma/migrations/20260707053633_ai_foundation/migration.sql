-- CreateEnum
CREATE TYPE "TriageCategory" AS ENUM ('BILLING', 'TECHNICAL', 'ACCOUNT', 'FEATURE_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "TriageSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "TriageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditActionType" AS ENUM ('TRIAGE');

-- AlterTable
ALTER TABLE "Ticket"
ADD COLUMN     "triageCategory" "TriageCategory",
ADD COLUMN     "triageLanguage" TEXT,
ADD COLUMN     "triageSentiment" "TriageSentiment",
ADD COLUMN     "triageStatus" "TriageStatus";

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actionType" "AuditActionType" NOT NULL,
    "ticketId" TEXT,
    "messageId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_idx" ON "AuditEvent"("organizationId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_ticketId_idx" ON "AuditEvent"("organizationId", "ticketId");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only enforcement for AuditEvent (D-18). Role-independent: this trigger
-- fires regardless of which DB role issues the statement, so it survives an
-- operator changing POSTGRES_USER (unlike a role-scoped REVOKE).
CREATE OR REPLACE FUNCTION aida_audit_event_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aida_audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION aida_audit_event_immutable();
