-- AlterTable: adicionar coluna de capa do evento
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "coverUrl" TEXT;

