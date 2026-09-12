ALTER TABLE "Organizer" ADD COLUMN "googleSubject" TEXT;
ALTER TABLE "Participant" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "Participant" ADD COLUMN "googleSubject" TEXT;

CREATE UNIQUE INDEX "Organizer_googleSubject_key" ON "Organizer"("googleSubject");
CREATE UNIQUE INDEX "Participant_googleSubject_key" ON "Participant"("googleSubject");
