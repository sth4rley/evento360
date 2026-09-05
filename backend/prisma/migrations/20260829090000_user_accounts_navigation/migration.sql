-- Extend organizer credentials for username login and password recovery.
ALTER TYPE "EventStatus" ADD VALUE 'ARCHIVED';

ALTER TABLE "Organizer"
ADD COLUMN "username" TEXT,
ADD COLUMN "passwordResetTokenHash" TEXT,
ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3),
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Organizer_username_key" ON "Organizer"("username");
CREATE UNIQUE INDEX "Organizer_passwordResetTokenHash_key" ON "Organizer"("passwordResetTokenHash");

-- Participant accounts are separate from organizer ownership.
CREATE TABLE "Participant" (
  "id" UUID NOT NULL,
  "username" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "authProvider" TEXT,
  "passwordResetTokenHash" TEXT,
  "passwordResetExpiresAt" TIMESTAMP(3),
  "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Participant_username_key" ON "Participant"("username");
CREATE UNIQUE INDEX "Participant_email_key" ON "Participant"("email");
CREATE UNIQUE INDEX "Participant_passwordResetTokenHash_key" ON "Participant"("passwordResetTokenHash");

-- Existing guest registrations remain valid. Only authenticated registrations
-- receive a participantId; e-mail alone never claims a guest registration.
ALTER TABLE "Registration" ADD COLUMN "participantId" UUID;
CREATE INDEX "Registration_participantId_idx" ON "Registration"("participantId");
CREATE UNIQUE INDEX "Registration_active_event_participant_key"
ON "Registration"("eventId", "participantId")
WHERE "status" = 'ACTIVE' AND "participantId" IS NOT NULL;
ALTER TABLE "Registration"
ADD CONSTRAINT "Registration_participantId_fkey"
FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
