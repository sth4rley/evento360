import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const resendEnvironment = vi.hoisted(() => {
  const previous = {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL,
    publicAppUrl: process.env.PUBLIC_APP_URL,
  };
  process.env.RESEND_API_KEY = "re_password_reset_test_key";
  process.env.RESEND_FROM_EMAIL = "Evento360 <contas@example.test>";
  process.env.PUBLIC_APP_URL = "https://evento360.example.test";
  return previous;
});

import {
  buildPasswordResetUrl,
  sendPasswordResetEmail,
} from "../src/services/password-reset-email.js";

function restore(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  restore("RESEND_API_KEY", resendEnvironment.apiKey);
  restore("RESEND_FROM_EMAIL", resendEnvironment.fromEmail);
  restore("PUBLIC_APP_URL", resendEnvironment.publicAppUrl);
});

describe("password reset e-mail", () => {
  it("builds profile-specific reset links with an encoded token", () => {
    expect(
      buildPasswordResetUrl(
        "token with/slash",
        "participant",
        "https://evento360.example.test/",
      ),
    ).toBe(
      "https://evento360.example.test/reset-password/participant/token%20with%2Fslash",
    );
    expect(
      buildPasswordResetUrl(
        "organizer-token",
        "organizer",
        "https://evento360.example.test",
      ),
    ).toContain("/reset-password/organizer/organizer-token");
  });

  it("sends the participant reset link through Resend", async () => {
    const resendResponse = new Response('{"id":"reset-email-test"}', {
      status: 202,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(resendResponse);

    await sendPasswordResetEmail({
      email: "participant@example.test",
      name: "Participante Teste",
      token: "safe-reset-token",
      profile: "participant",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(requestInit?.body)) as {
      to: string;
      html: string;
    };
    expect(body.to).toBe("participant@example.test");
    expect(body.html).toContain(
      "https://evento360.example.test/reset-password/participant/safe-reset-token",
    );
    expect(resendResponse.bodyUsed).toBe(true);
  });
});
