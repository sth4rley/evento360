import { RegistrationStatus } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { CreatedRegistration } from "../src/domain/registrations.js";

const webhookEnvironment = vi.hoisted(() => {
  const previous = {
    url: process.env.N8N_REGISTRATION_WEBHOOK_URL,
    secret: process.env.N8N_WEBHOOK_SECRET,
  };
  const url = "https://n8n.example.test/webhook/evento360-registration";
  const secret = "n8n-test-secret-never-use-in-production";
  process.env.N8N_REGISTRATION_WEBHOOK_URL = url;
  process.env.N8N_WEBHOOK_SECRET = secret;
  return { previous, secret, url };
});

import {
  buildRegistrationCreatedWebhookPayload,
  sendRegistrationCreatedWebhook,
} from "../src/services/n8n.js";

const created: CreatedRegistration = {
  event: {
    id: "253f7393-fd78-46d6-bb67-309dfd83dbdf",
    publicId: "conferencia-integracoes-2035",
    name: "Conferência de integrações",
    date: new Date("2035-10-21T18:30:00.000Z"),
    location: "Centro de Convenções de Curitiba",
    capacity: 25,
  },
  registration: {
    id: "4f9be46e-cc2e-43bf-9adf-40106e5c38cf",
    participantName: "Participante Integrações",
    participantEmail: "n8n.payload.participant@example.test",
    participantPhone: "+55 41 99999-0000",
    status: RegistrationStatus.ACTIVE,
    confirmationCode: "48273105",
    cancellationToken: "sensitive-cancellation-token-must-not-leak",
    createdAt: new Date("2035-09-01T12:34:56.789Z"),
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  if (webhookEnvironment.previous.url === undefined) {
    delete process.env.N8N_REGISTRATION_WEBHOOK_URL;
  } else {
    process.env.N8N_REGISTRATION_WEBHOOK_URL = webhookEnvironment.previous.url;
  }

  if (webhookEnvironment.previous.secret === undefined) {
    delete process.env.N8N_WEBHOOK_SECRET;
  } else {
    process.env.N8N_WEBHOOK_SECRET = webhookEnvironment.previous.secret;
  }
});

describe("n8n registration webhook", () => {
  it("builds the complete public payload with ISO dates and no cancellation token", () => {
    const occurredAt = new Date("2035-09-01T12:35:01.234Z");

    const payload = buildRegistrationCreatedWebhookPayload(created, occurredAt);

    expect(payload).toEqual({
      type: "registration.created",
      occurredAt: "2035-09-01T12:35:01.234Z",
      event: {
        id: created.event.id,
        publicId: created.event.publicId,
        name: created.event.name,
        date: "2035-10-21T18:30:00.000Z",
        location: created.event.location,
        capacity: created.event.capacity,
      },
      registration: {
        id: created.registration.confirmationCode,
        participantName: created.registration.participantName,
        participantEmail: created.registration.participantEmail,
        participantPhone: created.registration.participantPhone,
        status: "ACTIVE",
        confirmationCode: created.registration.confirmationCode,
        createdAt: "2035-09-01T12:34:56.789Z",
      },
    });
    expect(payload.registration.id).toBe(payload.registration.confirmationCode);
    expect(JSON.stringify(payload)).not.toContain(created.registration.id);
    expect(payload.registration).not.toHaveProperty("cancellationToken");
    expect(JSON.stringify(payload)).not.toContain(created.registration.cancellationToken);
  });

  it("posts JSON with the secret only in the Evento360 header", async () => {
    const webhookResponse = new Response('{"accepted":true}', { status: 200 });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(webhookResponse);

    await sendRegistrationCreatedWebhook(created);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, requestInit] = fetchMock.mock.calls[0];
    const headers = new Headers(requestInit?.headers);
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;

    expect(String(target)).toBe(webhookEnvironment.url);
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.redirect).toBe("error");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Evento360-Webhook-Secret")).toBe(webhookEnvironment.secret);
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
    expect(body).toMatchObject({
      type: "registration.created",
      event: {
        id: created.event.id,
        date: created.event.date.toISOString(),
      },
      registration: {
        id: created.registration.confirmationCode,
        confirmationCode: created.registration.confirmationCode,
        createdAt: created.registration.createdAt.toISOString(),
      },
    });
    expect(new Date(String(body.occurredAt)).toISOString()).toBe(body.occurredAt);
    expect(body).not.toHaveProperty("secret");
    expect(JSON.stringify(body)).not.toContain(webhookEnvironment.secret);
    expect(JSON.stringify(body)).not.toContain(created.registration.cancellationToken);
    expect(webhookResponse.bodyUsed).toBe(true);
  });
});
