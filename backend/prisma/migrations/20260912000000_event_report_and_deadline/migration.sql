-- Os campos existiam no schema.prisma desde o fluxo de ingressos, mas nenhuma
-- migration os criava: bancos novos ficavam sem as colunas. IF NOT EXISTS
-- mantém o comando seguro em bancos locais que já foram alterados na mão.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "organizerReportSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "registrationDeadline" TIMESTAMP(3);
