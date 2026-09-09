import { defineConfig } from "vitest/config";
import "dotenv/config";

const defaultTestDb =
  "postgresql://evento360:change-me@127.0.0.1:5434/evento360_test?schema=public";
const defaultDb =
  "postgresql://evento360:change-me@127.0.0.1:5434/evento360?schema=public";
const testDatabaseUrl = process.env.TEST_DATABASE_URL || defaultTestDb;
const databaseUrl = process.env.DATABASE_URL || defaultDb;
if (
  !testDatabaseUrl ||
  !new URL(testDatabaseUrl).pathname.endsWith("_test") ||
  testDatabaseUrl === databaseUrl
) {
  throw new Error(
    "Configure TEST_DATABASE_URL com um banco separado cujo nome termine em _test.",
  );
}

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "tests/resend.test.ts",
      "tests/env-security.test.ts",
      "tests/registration-notifications.test.ts",
      "tests/password-reset-email.test.ts",
      "tests/ticket-qa.test.ts",
      "tests/e2e-ticket-flow.test.ts",
      "tests/organizer-report.test.ts",
    ],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      AUTH_TOKEN_SECRET: "evento360-test-auth-token-secret-with-at-least-32",
      RESEND_API_KEY:
        process.env.RESEND_API_KEY || "re_dummy_key_for_ci_tests_123",
      RESEND_FROM_EMAIL:
        process.env.RESEND_FROM_EMAIL || "ingressos@seuevento.com.br",
      N8N_REGISTRATION_WEBHOOK_URL: "",
      N8N_WEBHOOK_SECRET: "",
    },
  },
});
