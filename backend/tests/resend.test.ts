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
  buildTicketEmailHtml,
  buildWaitlistEmail,
  resend,
  sendRegistrationConfirmationEmail,
  sendTicketEmail,
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

function restoreEnvironmentVariable(
  name: string,
  previous: string | undefined,
) {
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
  restoreEnvironmentVariable(
    "RESEND_API_KEY",
    resendEnvironment.previous.apiKey,
  );
  restoreEnvironmentVariable(
    "RESEND_FROM_EMAIL",
    resendEnvironment.previous.fromEmail,
  );
  restoreEnvironmentVariable(
    "PUBLIC_APP_URL",
    resendEnvironment.previous.publicAppUrl,
  );
});

describe("Resend waitlist notice", () => {
  const waitlisted: CreatedRegistration = {
    ...created,
    registration: {
      ...created.registration,
      status: RegistrationStatus.WAITLISTED,
      waitlistPosition: 3,
    },
  };

  it("tells the participant their position without promising a seat", () => {
    const { subject, html } = buildWaitlistEmail(
      waitlisted,
      resendEnvironment.publicAppUrl,
    );
    const cancellationUrl = `${resendEnvironment.publicAppUrl}/registration/cancel/${created.registration.cancellationToken}`;

    expect(subject).toBe(`Você está na lista de espera — ${created.event.name}`);
    expect(visibleText(html)).toContain("3º");
    expect(html).toContain(created.registration.confirmationCode);
    expect(html).toContain(`href="${cancellationUrl}"`);
    expect(html).toContain("Sair da lista de espera");
    expect(html).not.toMatch(/inscrição confirmada/i);
    expect(visibleText(html)).not.toContain(
      created.registration.cancellationToken,
    );
  });

  it("escapes participant and event data", () => {
    const { html } = buildWaitlistEmail(
      {
        event: { ...waitlisted.event, name: "<script>alert(1)</script>" },
        registration: {
          ...waitlisted.registration,
          participantName: '<img src=x onerror="alert(1)">',
        },
      },
      resendEnvironment.publicAppUrl,
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
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
    expect(visibleText(html)).not.toContain(
      created.registration.cancellationToken,
    );
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
    expect(headers.get("Authorization")).toBe(
      `Bearer ${resendEnvironment.apiKey}`,
    );
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

describe("sendTicketEmail and ticket template", () => {
  const ticketData = {
    to: "participante@example.test",
    participantName: "Carlos Oliveira",
    eventName: "Conferência IA 2026",
    ticketCode: "TICKET-IA-2026",
    qrCode: "https://example.test/qrcode/TICKET-IA-2026.png",
  };

  it("builds the ticket HTML containing participant name, event name, ticket code and QR code image tag", () => {
    const html = buildTicketEmailHtml(
      ticketData.participantName,
      ticketData.eventName,
      ticketData.ticketCode,
      ticketData.qrCode,
    );

    expect(html).toContain(ticketData.participantName);
    expect(html).toContain(ticketData.eventName);
    expect(html).toContain(ticketData.ticketCode);
    expect(html).toContain(`<img src="${ticketData.qrCode}"`);
    expect(html).toContain("chatbot");
  });

  it("sends ticket email successfully through resend.emails.send", async () => {
    const sendSpy = vi.spyOn(resend.emails, "send").mockResolvedValue({
      data: { id: "resend-ticket-email-id" },
      error: null,
    } as any);

    const result = await sendTicketEmail(
      ticketData.to,
      ticketData.participantName,
      ticketData.eventName,
      ticketData.ticketCode,
      ticketData.qrCode,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: "resend-ticket-email-id" });
    expect(sendSpy).toHaveBeenCalledOnce();
    const callArg = sendSpy.mock.calls[0][0];
    expect(callArg.to).toBe(ticketData.to);
    expect(callArg.subject).toContain(ticketData.eventName);
    expect(callArg.subject).toContain(ticketData.ticketCode);
    expect(callArg.html).toContain(`<img src="${ticketData.qrCode}"`);
  });

  it("supports passing payload as an object", async () => {
    const sendSpy = vi.spyOn(resend.emails, "send").mockResolvedValue({
      data: { id: "resend-ticket-object-id" },
      error: null,
    } as any);

    const result = await sendTicketEmail(ticketData);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: "resend-ticket-object-id" });
    expect(sendSpy).toHaveBeenCalledOnce();
  });

  it("handles Resend API error and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(resend.emails, "send").mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid domain" },
    } as any);

    const result = await sendTicketEmail(ticketData);

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      name: "validation_error",
      message: "Invalid domain",
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Falha na API do Resend"),
      expect.anything(),
    );
  });

  it("handles thrown exception in try/catch and logs to console.error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(resend.emails, "send").mockRejectedValue(
      new Error("Network failure"),
    );

    const result = await sendTicketEmail(ticketData);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Erro ao enviar e-mail"),
      expect.anything(),
    );
  });
});
