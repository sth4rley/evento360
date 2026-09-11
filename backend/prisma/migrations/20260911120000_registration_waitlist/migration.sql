-- AlterEnum
ALTER TYPE "RegistrationStatus" ADD VALUE 'WAITLISTED';

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN "promotedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Registration_eventId_status_createdAt_idx" ON "Registration"("eventId", "status", "createdAt");
