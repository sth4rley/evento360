-- AlterTable
ALTER TABLE "Registration" ADD COLUMN "cancellationToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Registration_cancellationToken_key" ON "Registration"("cancellationToken");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_active_event_email_key"
ON "Registration"("eventId", "participantEmail")
WHERE "status" = 'ACTIVE';
