import { defineConfig } from "vitest/config";
import "dotenv/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl || !new URL(testDatabaseUrl).pathname.endsWith("_test") || testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("Configure TEST_DATABASE_URL com um banco separado cujo nome termine em _test.");
}

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      AUTH_TOKEN_SECRET: "evento360-test-auth-token-secret-with-at-least-32",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      N8N_REGISTRATION_WEBHOOK_URL: "",
      N8N_WEBHOOK_SECRET: "",
    },
  },
});
