import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_TOKEN_SECRET", randomBytes(48).toString("hex"));
  vi.stubEnv("FRONTEND_URL", "https://app.example.test");
  vi.stubEnv("PUBLIC_APP_URL", "https://app.example.test");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("production configuration", () => {
  it("accepts an independently generated secret with explicit HTTPS origins", async () => {
    expect((await import("../src/config/env.js")).env.nodeEnv).toBe("production");
  });
  it("rejects the example secret even though it is long enough", async () => {
    vi.stubEnv("AUTH_TOKEN_SECRET", "replace-with-a-unique-secret-of-at-least-32-characters");
    await expect(import("../src/config/env.js")).rejects.toThrow("AUTH_TOKEN_SECRET");
  });
  it("rejects HTTP in production", async () => {
    vi.stubEnv("PUBLIC_APP_URL", "http://app.example.test");
    await expect(import("../src/config/env.js")).rejects.toThrow("PUBLIC_APP_URL");
  });
  it("rejects credential-bearing URLs without including their value in the error", async () => {
    vi.stubEnv("FRONTEND_URL", "https://user:private-password@app.example.test");
    await expect(import("../src/config/env.js")).rejects.toThrow("FRONTEND_URL must be an HTTP(S) origin");
  });
  it("rejects a misspelled production mode", async () => {
    vi.stubEnv("NODE_ENV", "prod");
    await expect(import("../src/config/env.js")).rejects.toThrow("NODE_ENV");
  });
  it("rejects plaintext webhook delivery in production", async () => {
    vi.stubEnv("N8N_REGISTRATION_WEBHOOK_URL", "http://automation.example.test/webhook");
    await expect(import("../src/config/env.js")).rejects.toThrow("N8N_REGISTRATION_WEBHOOK_URL");
  });
});
