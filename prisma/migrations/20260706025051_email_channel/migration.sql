-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Message"
ADD COLUMN     "deliveryStatus" "MessageDeliveryStatus",
ADD COLUMN     "emailInReplyTo" TEXT,
ADD COLUMN     "emailMessageId" TEXT,
ADD COLUMN     "emailReferences" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "EmailIngestFailure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailIngestFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailIngestFailure_organizationId_idx" ON "EmailIngestFailure"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIngestFailure_organizationId_emailMessageId_key" ON "EmailIngestFailure"("organizationId", "emailMessageId");

-- CreateIndex
CREATE INDEX "Message_organizationId_emailMessageId_idx" ON "Message"("organizationId", "emailMessageId");

-- AddForeignKey
ALTER TABLE "EmailIngestFailure" ADD CONSTRAINT "EmailIngestFailure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
