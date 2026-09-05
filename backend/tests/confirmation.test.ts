import { EventStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmail = "confirmation.owner@example.test";

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: organizerEmail } } });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

async function createEvent() {
  const organizer = await prisma.organizer.create({ data: { email: organizerEmail, passwordHash: await hashPassword("a valid password") } });
  return prisma.event.create({ data: { organizerId: organizer.id, name: "Evento confirmado", date: new Date("2026-11-03T14:00:00.000Z"), location: "Recife", capacity: 3, status: EventStatus.PUBLISHED, publishedAt: new Date() } });
}

function register(publicId: string, participantEmail: string) {
  return request(app).post(`/api/public/events/${publicId}/registrations`).send({ participantName: "Carla Souza", participantEmail, participantPhone: "+55 81 99999-0000" });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("registration confirmation code", () => {
  it("generates a unique, non-sequential code and keeps it persistent on later consultation", async () => {
    const event = await createEvent();
    const first = await register(event.publicId, "carla@example.test");
    const second = await register(event.publicId, "davi@example.test");
    const firstCode = first.body.registration.confirmationCode as string;
    const secondCode = second.body.registration.confirmationCode as string;

    expect(first.status).toBe(201);
    expect(firstCode).toMatch(/^\d{8}$/);
    expect(secondCode).toMatch(/^\d{8}$/);
    expect(secondCode).not.toBe(firstCode);

    const reload = await request(app).get(`/api/public/registrations/confirmation/${firstCode.toLowerCase()}`);
    expect(reload.status).toBe(200);
    expect(reload.body.registration).toMatchObject({
      participantName: "Carla Souza",
      confirmationCode: firstCode,
      status: "ACTIVE",
      cancelledAt: null,
      checkedInAt: null,
      event: {
        name: event.name,
        publicId: event.publicId,
        date: event.date.toISOString(),
        location: event.location,
      },
    });
    expect(reload.body.registration.createdAt).toEqual(expect.any(String));
    expect(reload.body.registration).not.toHaveProperty("participantEmail");
    expect(reload.body.registration).not.toHaveProperty("participantPhone");

    const persisted = await prisma.registration.findUniqueOrThrow({ where: { confirmationCode: firstCode } });
    expect(persisted.confirmationCode).toBe(firstCode);
  });

  it("does not create or disclose a confirmation after a failed registration", async () => {
    const event = await createEvent();
    const response = await request(app).post(`/api/public/events/${event.publicId}/registrations`).send({ participantName: "", participantEmail: "invalid" });

    expect(response.status).toBe(400);
    expect(response.body.registration).toBeUndefined();
    expect(await prisma.registration.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("keeps previously issued alphanumeric codes consultable", async () => {
    const event = await createEvent();
    await prisma.registration.create({
      data: {
        eventId: event.id,
        participantName: "Cadastro Antigo",
        participantEmail: "legacy.code@example.test",
        confirmationCode: "EVT-LEGACY-2026",
      },
    });

    const response = await request(app).get(
      "/api/public/registrations/confirmation/evt-legacy-2026",
    );

    expect(response.status).toBe(200);
    expect(response.body.registration.confirmationCode).toBe("EVT-LEGACY-2026");
  });
});
