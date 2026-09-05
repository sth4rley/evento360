import { EventStatus, RegistrationStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmail = "cancellation.owner@example.test";

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: organizerEmail } } });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

async function createEvent(capacity = 2) {
  const organizer = await prisma.organizer.create({ data: { email: organizerEmail, passwordHash: await hashPassword("a valid password") } });
  return prisma.event.create({ data: { organizerId: organizer.id, name: "Evento cancelável", date: new Date("2026-11-03T14:00:00.000Z"), location: "Fortaleza", capacity, status: EventStatus.PUBLISHED, publishedAt: new Date() } });
}

async function register(publicId: string, participantEmail: string) {
  return request(app).post(`/api/public/events/${publicId}/registrations`).send({ participantName: "Camila Lima", participantEmail, participantPhone: "+55 85 99999-0000" });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("secure registration cancellation", () => {
  it("cancels an active registration using its secure token", async () => {
    const event = await createEvent();
    const created = await register(event.publicId, "camila@example.test");
    const token = created.body.registration.cancellationToken as string;

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const response = await request(app).post(`/api/public/registrations/cancel/${token}`);

    expect(response.status).toBe(200);
    expect(response.body.registration).toMatchObject({ participantName: "Camila Lima", status: "CANCELLED", event: { name: event.name, publicId: event.publicId } });
    expect(response.body.registration.cancelledAt).toEqual(expect.any(String));
  });

  it("is idempotent and does not release capacity twice", async () => {
    const event = await createEvent(1);
    const created = await register(event.publicId, "camila@example.test");
    const token = created.body.registration.cancellationToken as string;
    const first = await request(app).post(`/api/public/registrations/cancel/${token}`);
    const second = await request(app).post(`/api/public/registrations/cancel/${token}`);

    expect(first.body.registration.cancelledAt).toBe(second.body.registration.cancelledAt);
    expect(second.body.registration.status).toBe("CANCELLED");
    const replacement = await register(event.publicId, "nova@example.test");
    expect(replacement.status).toBe(201);
    expect(await prisma.registration.count({ where: { eventId: event.id, status: RegistrationStatus.ACTIVE } })).toBe(1);
  });

  it("does not authorize cancellation from a registration id or a different token", async () => {
    const event = await createEvent();
    const first = await register(event.publicId, "primeira@example.test");
    const second = await register(event.publicId, "segunda@example.test");
    const secondRegistration = await prisma.registration.findUniqueOrThrow({ where: { confirmationCode: second.body.registration.confirmationCode } });

    const forged = await request(app).post(`/api/public/registrations/cancel/${secondRegistration.id}`);
    expect(forged.status).toBe(404);
    expect(forged.body.error.code).toBe("REGISTRATION_NOT_FOUND");

    const firstToken = first.body.registration.cancellationToken as string;
    await request(app).post(`/api/public/registrations/cancel/${firstToken}`);
    const secondPersisted = await prisma.registration.findUniqueOrThrow({ where: { id: secondRegistration.id } });
    expect(secondPersisted.status).toBe("ACTIVE");
  });

  it("shows the cancellation state through the token-only consultation endpoint", async () => {
    const event = await createEvent();
    const created = await register(event.publicId, "camila@example.test");
    const token = created.body.registration.cancellationToken as string;
    await request(app).post(`/api/public/registrations/cancel/${token}`);

    const response = await request(app).get(`/api/public/registrations/cancel/${token}`);
    expect(response.status).toBe(200);
    expect(response.body.registration.status).toBe("CANCELLED");
  });
});
