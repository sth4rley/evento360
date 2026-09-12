import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("Google OAuth entry point", () => {
  it("starts the participant flow with a signed state cookie", async () => {
    const response = await request(app).get("/api/public/auth/google");

    expect(response.status).toBe(302);
    expect(response.headers.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    expect(response.headers.location).toContain("client_id=google-test-client-id");
    expect(response.headers.location).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fpublic%2Fauth%2Fgoogle%2Fcallback");
    expect(response.headers["set-cookie"]?.[0]).toContain("evento360_google_oauth=");
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
  });

  it("rejects a callback whose state does not match the signed cookie", async () => {
    const started = await request(app).get("/api/public/auth/google");
    const cookie = started.headers["set-cookie"]?.[0];

    const response = await request(app)
      .get("/api/public/auth/google/callback?code=authorization-code&state=invalid")
      .set("Cookie", cookie ?? "");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_OAUTH_STATE");
  });
});
