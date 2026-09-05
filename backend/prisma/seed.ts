import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth/password.js";
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  throw new Error("O seed de credenciais de teste não pode rodar em produção.");
}

const seedDatabase = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(seedDatabase.hostname)) {
  throw new Error("O seed de contas de demonstração exige um banco local.");
}

const prisma = new PrismaClient();

async function main() {
  const [adminPasswordHash, participantPasswordHash] = await Promise.all([
    hashPassword("admin"),
    hashPassword("teste"),
  ]);

  await prisma.organizer.upsert({
    where: { email: "admin@evento360.local" },
    update: {
      username: "admin",
      passwordHash: adminPasswordHash,
      sessionVersion: { increment: 1 },
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      authProvider: "password",
    },
    create: {
      username: "admin",
      email: "admin@evento360.local",
      passwordHash: adminPasswordHash,
      authProvider: "password",
    },
  });

  await prisma.participant.upsert({
    where: { email: "teste@evento360.local" },
    update: {
      username: "teste",
      name: "Participante Teste",
      passwordHash: participantPasswordHash,
      sessionVersion: { increment: 1 },
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      authProvider: "password",
    },
    create: {
      username: "teste",
      name: "Participante Teste",
      email: "teste@evento360.local",
      passwordHash: participantPasswordHash,
      authProvider: "password",
    },
  });

  console.log("Seed local concluído: somente admin/admin e teste/teste.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
