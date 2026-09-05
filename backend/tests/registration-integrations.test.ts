import { EventStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatedRegistration } from "../src/domain/registrations.js";

vi.mock("../src/services/resend.js", () => ({
  buildRegistrationConfirmationEmail: vi.fn(),
  sendRegistrationConfirmationEmail: vi.fn(),
}));

vi.mock("../src/services/n8n.js", () => ({
  buildRegistrationCreatedWebhookPayload: vi.fn(),
  sendRegistrationCreatedWebhook: vi.fn(),
}));

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { sendRegistrationCreatedWebhook } from "../src/services/n8n.js";
import { sendRegistrationConfirmationEmail } from "../src/services/resend.js";

const organizerEmail = "registration.integrations.owner@example.test";
const participantEmail = "registration.integrations.participant@example.test";
const sendEmailMock = vi.mocked(sendRegistrationConfirmationEmail);
const sendWebhookMock = vi.mocked(sendRegistrationCreatedWebhook);

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: organizerEmail } } });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

async function createPublishedEvent() {
  const organizer = await prisma.organizer.create({
    data: {
      email: organizerEmail,
      passwordHash: "integration-test-password-hash",
    },
  });

  return prisma.event.create({
    data: {
      organizerId: organizer.id,
      name: "Conferência de integrações",
      date: new Date("2035-10-21T18:30:00.000Z"),
      location: "Centro de Convenções de Curitiba",
      capacity: 25,
      status: EventStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
}

function register(publicId: string, input: Record<string, unknown> = {}) {
  return request(app).post(`/api/public/events/${publicId}/registrations`).send({
    participantName: "Participante Integrações",
    participantEmail,
    participantPhone: "+55 41 99999-0000",
    ...input,
  });
}

async function expectRegistrationAlreadyPersisted(created: CreatedRegistration) {
  const persisted = await prisma.registration.findUnique({
    where: { id: created.registration.id },
    select: {
      id: true,
      eventId: true,
      participantEmail: true,
      confirmationCode: true,
      cancellationToken: true,
      status: true,
    },
  });

  expect(persisted).toMatchObject({
    id: created.registration.id,
    eventId: created.event.id,
    participantEmail: created.registration.participantEmail,
    confirmationCode: created.registration.confirmationCode,
    cancellationToken: created.registration.cancellationToken,
    status: "ACTIVE",
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue(undefined);
  sendWebhookMock.mockResolvedValue(undefined);
  await removeTestData();
});

afterEach(removeTestData);

describe("registration external integrations", () => {
  it("notifies Resend and n8n only after the registration has been committed", async () => {
    const event = await createPublishedEvent();

    sendEmailMock.mockImplementation(async (created) => {
      await expectRegistrationAlreadyPersisted(created);
    });
    sendWebhookMock.mockImplementation(async (created) => {
      await expectRegistrationAlreadyPersisted(created);
    });

    const response = await register(event.publicId);

    expect(response.status).toBe(201);
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendWebhookMock).toHaveBeenCalledOnce();

    const emailArgument = sendEmailMock.mock.calls[0]![0];
    const webhookArgument = sendWebhookMock.mock.calls[0]![0];
    expect(emailArgument).toEqual(webhookArgument);
    expect(emailArgument).toMatchObject({
      event: {
        id: event.id,
        publicId: event.publicId,
        name: event.name,
        location: event.location,
        capacity: event.capacity,
      },
      registration: {
        id: emailArgument.registration.id,
        participantName: "Participante Integrações",
        participantEmail,
        participantPhone: "5541999990000",
        status: "ACTIVE",
        confirmationCode: response.body.registration.confirmationCode,
        cancellationToken: response.body.registration.cancellationToken,
      },
    });
  });

  it("does not notify either integration when registration validation fails", async () => {
    const event = await createPublishedEvent();

    const response = await register(event.publicId, { participantEmail: "invalid-email" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sendWebhookMock).not.toHaveBeenCalled();
    await expect(
      prisma.registration.count({ where: { eventId: event.id } }),
    ).resolves.toBe(0);
  });

  it.each(["resend", "n8n"] as const)(
    "keeps the registration committed when %s rejects",
    async (failingIntegration) => {
      const event = await createPublishedEvent();
      const secretMarker = `${failingIntegration}-secret-must-not-be-logged`;
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

      if (failingIntegration === "resend") {
        sendEmailMock.mockImplementationOnce(async (created) => {
          throw new Error(
            `${secretMarker}:${created.registration.cancellationToken}`,
          );
        });
      } else {
        sendWebhookMock.mockImplementationOnce(async (created) => {
          throw new Error(
            `${secretMarker}:${created.registration.cancellationToken}`,
          );
        });
      }

      const response = await register(event.publicId);

      expect(response.status).toBe(201);
      expect(sendEmailMock).toHaveBeenCalledOnce();
      expect(sendWebhookMock).toHaveBeenCalledOnce();
      const persisted = await prisma.registration.findFirst({
        where: { eventId: event.id, participantEmail },
      });
      expect(persisted).toMatchObject({
        eventId: event.id,
        participantEmail,
        status: "ACTIVE",
      });
      expect(errorLog).toHaveBeenCalled();
      const serializedLog = JSON.stringify(errorLog.mock.calls);
      expect(serializedLog).not.toContain(secretMarker);
      expect(serializedLog).not.toContain(response.body.registration.cancellationToken);

      errorLog.mockRestore();
    },
  );
});
