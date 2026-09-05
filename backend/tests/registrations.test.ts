import { EventStatus, RegistrationStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmail = "registration.owner@example.test";

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: organizerEmail } } });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

async function createEvent(capacity = 3, status = EventStatus.PUBLISHED) {
  const organizer = await prisma.organizer.create({
    data: { email: organizerEmail, passwordHash: await hashPassword("a valid password") },
  });
  return prisma.event.create({
    data: {
      organizerId: organizer.id,
      name: "Workshop de inscrições",
      date: new Date("2026-11-03T14:00:00.000Z"),
      location: "Belo Horizonte",
      capacity,
      status,
      publishedAt: status === EventStatus.PUBLISHED ? new Date() : null,
    },
  });
}

function register(publicId: string, input: Record<string, unknown> = {}) {
  return request(app).post(`/api/public/events/${publicId}/registrations`).send({
    participantName: "Marina Silva",
    participantEmail: "marina@example.test",
    participantPhone: "11999999999",
    ...input,
  });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("participant registrations", () => {
  it("creates an active registration and normalizes the e-mail", async () => {
    const event = await createEvent();
    const response = await register(event.publicId, {
      participantEmail: "  MARINA@EXAMPLE.TEST ",
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      event: { publicId: event.publicId, name: event.name },
      registration: {
        participantName: "Marina Silva",
        participantEmail: "marina@example.test",
        status: "ACTIVE",
      },
    });
  });

  it.each([
    ["empty name", { participantName: " " }],
    ["invalid e-mail", { participantEmail: "not-an-email" }],
    ["missing WhatsApp", { participantPhone: undefined }],
    ["empty WhatsApp", { participantPhone: " " }],
    ["invalid WhatsApp", { participantPhone: "12345" }],
  ])("rejects %s", async (_label, input) => {
    const event = await createEvent();
    const response = await register(event.publicId, input);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("normalizes the WhatsApp number to digits", async () => {
    const event = await createEvent();
    const response = await register(event.publicId, {
      participantPhone: "+55 (11) 99999-9999",
    });

    expect(response.status).toBe(201);
    expect(response.body.registration.participantPhone).toBe("5511999999999");
  });

  it("rejects missing and unpublished events", async () => {
    const draft = await createEvent(3, EventStatus.DRAFT);
    const missing = await register("missing-event");
    const unpublished = await register(draft.publicId);

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("EVENT_NOT_FOUND");
    expect(unpublished.status).toBe(409);
    expect(unpublished.body.error.code).toBe("EVENT_NOT_PUBLISHED");
  });

  it("rejects a second active registration for the same normalized e-mail", async () => {
    const event = await createEvent();
    await register(event.publicId);
    const duplicate = await register(event.publicId, {
      participantEmail: "MARINA@EXAMPLE.TEST",
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("REGISTRATION_DUPLICATE");
  });
});

describe("capacity control", () => {
  it("accepts the first registration and rejects the second one when capacity is one", async () => {
    const event = await createEvent(1);
    const first = await register(event.publicId, { participantEmail: "first@example.test" });
    const second = await register(event.publicId, { participantEmail: "second@example.test" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("EVENT_FULL");
  });

  it("allows only one simultaneous request to claim the final seat", async () => {
    const event = await createEvent(1);
    const [first, second] = await Promise.all([
      register(event.publicId, { participantEmail: "parallel-one@example.test" }),
      register(event.publicId, { participantEmail: "parallel-two@example.test" }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect([first.body.error?.code, second.body.error?.code]).toContain("EVENT_FULL");

    const activeRegistrations = await prisma.registration.count({
      where: { eventId: event.id, status: RegistrationStatus.ACTIVE },
    });
    expect(activeRegistrations).toBe(1);
    expect(activeRegistrations).toBeLessThanOrEqual(event.capacity);
  });
});
