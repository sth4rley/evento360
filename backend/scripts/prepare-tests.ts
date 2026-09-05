import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";

const testUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
const database = testUrl.pathname.slice(1);
if (!["localhost", "127.0.0.1", "[::1]"].includes(testUrl.hostname) || !/^[a-zA-Z0-9_]+_test$/.test(database) || process.env.NODE_ENV === "production" || testUrl.href === process.env.DATABASE_URL) {
  throw new Error("A preparação exige TEST_DATABASE_URL para um banco local separado com sufixo _test.");
}
const maintenanceUrl = new URL(testUrl);
maintenanceUrl.pathname = "/postgres";
const prisma = new PrismaClient({ datasourceUrl: maintenanceUrl.href });
try {
  const found = await prisma.$queryRaw<Array<{ datname: string }>>`SELECT datname FROM pg_database WHERE datname = ${database}`;
  if (found.length === 0) {
    // Identifier is restricted to ASCII letters, digits and underscores above.
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  }
} finally {
  await prisma.$disconnect();
}
const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: testUrl.href },
  stdio: "inherit",
});
process.exitCode = migration.status ?? 1;
