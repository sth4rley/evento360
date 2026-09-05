import { RegistrationStatus } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { CreatedRegistration } from "../src/domain/registrations.js";

const resendEnvironment = vi.hoisted(() => {
  const previous = {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL,
    publicAppUrl: process.env.PUBLIC_APP_URL,
  };
  const apiKey = "re_test_key_never_use_in_production";
  const fromEmail = "Evento360 <inscricoes@example.test>";
  const publicAppUrl = "https://evento360.example.test";
  process.env.RESEND_API_KEY = apiKey;
  process.env.RESEND_FROM_EMAIL = fromEmail;
  process.env.PUBLIC_APP_URL = publicAppUrl;
  return { apiKey, fromEmail, previous, publicAppUrl };
});

import {
  buildRegistrationConfirmationEmail,
  sendRegistrationConfirmationEmail,
} from "../src/services/resend.js";

const created: CreatedRegistration = {
  event: {
    id: "792ace79-65d4-4af8-a6f2-43022da41367",
    publicId: "evento-email-2035",
    name: "Encontro Evento360",
    date: new Date("2035-10-21T18:30:00.000Z"),
    location: "Auditório Principal de Curitiba",
    capacity: 120,
  },
  registration: {
    id: "7676346c-1e8a-41e5-8f41-e37cc46d13b7",
    participantName: "Marina da Silva",
    participantEmail: "resend.template.participant@example.test",
    participantPhone: "+55 41 98888-1111",
    status: RegistrationStatus.ACTIVE,
    confirmationCode: "CONF-EMAIL-2035",
    cancellationToken: "sensitive-token-only-for-the-cancellation-href",
    createdAt: new Date("2035-09-01T12:34:56.789Z"),
  },
};

function restoreEnvironmentVariable(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

function visibleText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  restoreEnvironmentVariable("RESEND_API_KEY", resendEnvironment.previous.apiKey);
  restoreEnvironmentVariable("RESEND_FROM_EMAIL", resendEnvironment.previous.fromEmail);
  restoreEnvironmentVariable("PUBLIC_APP_URL", resendEnvironment.previous.publicAppUrl);
});

describe("Resend registration confirmation", () => {
  it("builds the participant e-mail with event details and safe confirmation links", () => {
    const { subject, html } = buildRegistrationConfirmationEmail(
      created,
      resendEnvironment.publicAppUrl,
    );
    const confirmationUrl = `${resendEnvironment.publicAppUrl}/registration/${created.registration.confirmationCode}`;
    const cancellationUrl = `${resendEnvironment.publicAppUrl}/registration/cancel/${created.registration.cancellationToken}`;

    expect(subject).toBe(`Inscrição confirmada — ${created.event.name}`);
    expect(html).toContain(created.registration.participantName);
    expect(html).toContain(created.event.name);
    expect(html).toContain(created.event.location);
    expect(html).toContain("2035");
    expect(html).toContain(created.registration.confirmationCode);
    expect(html).toMatch(/confirmad[ao]/i);
    expect(html).toContain(`href="${confirmationUrl}"`);
    expect(html).toContain(`href="${cancellationUrl}"`);
    expect(html).toContain("Ver minha inscrição");
    expect(html).toContain("Cancelar inscrição");
    expect(html.split(created.registration.cancellationToken)).toHaveLength(2);
    expect(visibleText(html)).not.toContain(created.registration.cancellationToken);
  });

  it("sends the rendered e-mail through a mocked Resend request", async () => {
    const resendResponse = new Response('{"id":"email-test-id"}', {
      status: 202,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(resendResponse);

    await sendRegistrationConfirmationEmail(created);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, requestInit] = fetchMock.mock.calls[0];
    const headers = new Headers(requestInit?.headers);
    const body = JSON.parse(String(requestInit?.body)) as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };

    expect(String(target)).toBe("https://api.resend.com/emails");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.redirect).toBe("error");
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
    expect(headers.get("Authorization")).toBe(`Bearer ${resendEnvironment.apiKey}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(body).toMatchObject({
      from: resendEnvironment.fromEmail,
      to: created.registration.participantEmail,
      subject: `Inscrição confirmada — ${created.event.name}`,
    });
    expect(body.html).toContain(
      `${resendEnvironment.publicAppUrl}/registration/${created.registration.confirmationCode}`,
    );
    expect(body.html).toContain(
      `${resendEnvironment.publicAppUrl}/registration/cancel/${created.registration.cancellationToken}`,
    );
    expect(resendResponse.bodyUsed).toBe(true);
  });
});
