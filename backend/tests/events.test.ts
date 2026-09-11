import { EventStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmails = [
  "owner.events@example.test",
  "other.events@example.test",
];

async function removeTestData() {
  await prisma.event.deleteMany({
    where: { organizer: { email: { in: organizerEmails } } },
  });
  await prisma.organizer.deleteMany({ where: { email: { in: organizerEmails } } });
}

async function createOrganizer(email: string) {
  return prisma.organizer.create({
    data: { email, passwordHash: await hashPassword("a valid password") },
  });
}

async function login(email: string) {
  const response = await request(app).post("/api/admin/auth/login").send({
    email,
    password: "a valid password",
  });
  return response.body.token as string;
}

async function createEvent(token: string, input: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/admin/events")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: "Conferência Evento360",
      date: "2026-12-20T14:00:00.000Z",
      location: "São Paulo",
      capacity: 20,
      ...input,
    });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("event creation", () => {
  it("creates a draft event owned by the authenticated organizer", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const response = await createEvent(await login(organizer.email));

    expect(response.status).toBe(201);
    expect(response.body.event).toMatchObject({
      name: "Conferência Evento360",
      location: "São Paulo",
      capacity: 20,
      status: "DRAFT",
    });
    expect(response.body.event).not.toHaveProperty("organizerId");

    const persisted = await prisma.event.findUniqueOrThrow({
      where: { id: response.body.event.id },
    });
    expect(persisted.organizerId).toBe(organizer.id);
    expect(persisted.status).toBe(EventStatus.DRAFT);
  });

  it.each([
    ["empty name", { name: "   " }],
    ["empty location", { location: "   " }],
    ["invalid date", { date: "not-a-date" }],
    ["nonexistent calendar date", { date: "2026-02-31T14:00:00.000Z" }],
    ["zero capacity", { capacity: 0 }],
    ["negative capacity", { capacity: -1 }],
    ["decimal capacity", { capacity: 1.5 }],
    ["text capacity", { capacity: "20" }],
  ])("rejects %s", async (_label, input) => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const response = await createEvent(await login(organizer.email), input);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unauthenticated event creation", async () => {
    const response = await request(app).post("/api/admin/events").send({
      name: "Conferência Evento360",
      date: "2026-12-20T14:00:00.000Z",
      location: "São Paulo",
      capacity: 20,
      organizerId: "forged-organizer-id",
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });
});

describe("event update", () => {
  function updateEvent(token: string, eventId: string, input: Record<string, unknown> = {}) {
    return request(app)
      .put(`/api/admin/events/${eventId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Conferência Evento360 — edição revisada",
        date: "2026-12-21T18:30:00.000Z",
        location: "Petrolina",
        capacity: 50,
        ...input,
      });
  }

  async function addActiveRegistrations(eventId: string, count: number) {
    for (let index = 0; index < count; index += 1) {
      await prisma.registration.create({
        data: {
          eventId,
          participantName: `Participante ${index}`,
          participantEmail: `participante.${index}@example.test`,
        },
      });
    }
  }

  it("updates the editable fields of an owned event", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const token = await login(organizer.email);
    const created = await createEvent(token);

    const response = await updateEvent(token, created.body.event.id);

    expect(response.status).toBe(200);
    expect(response.body.event).toMatchObject({
      id: created.body.event.id,
      name: "Conferência Evento360 — edição revisada",
      date: "2026-12-21T18:30:00.000Z",
      location: "Petrolina",
      capacity: 50,
      status: "DRAFT",
      publicId: created.body.event.publicId,
    });

    const persisted = await prisma.event.findUniqueOrThrow({
      where: { id: created.body.event.id },
    });
    expect(persisted.name).toBe("Conferência Evento360 — edição revisada");
    expect(persisted.capacity).toBe(50);
  });

  it("keeps a published event published and ignores forged ownership or status", async () => {
    const owner = await createOrganizer(organizerEmails[0]);
    const otherOrganizer = await createOrganizer(organizerEmails[1]);
    const token = await login(owner.email);
    const created = await createEvent(token);
    await request(app)
      .post(`/api/admin/events/${created.body.event.id}/publish`)
      .set("Authorization", `Bearer ${token}`);

    const response = await updateEvent(token, created.body.event.id, {
      status: "DRAFT",
      organizerId: otherOrganizer.id,
      publicId: "forged-public-id",
    });

    expect(response.status).toBe(200);
    const persisted = await prisma.event.findUniqueOrThrow({
      where: { id: created.body.event.id },
    });
    expect(persisted.status).toBe(EventStatus.PUBLISHED);
    expect(persisted.organizerId).toBe(owner.id);
    expect(persisted.publicId).toBe(created.body.event.publicId);
  });

  it.each([
    ["empty name", { name: "   " }],
    ["invalid date", { date: "not-a-date" }],
    ["zero capacity", { capacity: 0 }],
    ["text capacity", { capacity: "20" }],
  ])("rejects %s without changing the event", async (_label, input) => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const token = await login(organizer.email);
    const created = await createEvent(token);

    const response = await updateEvent(token, created.body.event.id, input);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    const persisted = await prisma.event.findUniqueOrThrow({
      where: { id: created.body.event.id },
    });
    expect(persisted.name).toBe("Conferência Evento360");
    expect(persisted.capacity).toBe(20);
  });

  it("does not allow capacity below the active registrations", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const token = await login(organizer.email);
    const created = await createEvent(token);
    await addActiveRegistrations(created.body.event.id, 3);

    const tooSmall = await updateEvent(token, created.body.event.id, { capacity: 2 });
    const exact = await updateEvent(token, created.body.event.id, { capacity: 3 });

    expect(tooSmall.status).toBe(409);
    expect(tooSmall.body.error.code).toBe("CAPACITY_BELOW_REGISTRATIONS");
    expect(exact.status).toBe(200);
    expect(exact.body.event.capacity).toBe(3);
  });

  it("does not count cancelled registrations against the new capacity", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const token = await login(organizer.email);
    const created = await createEvent(token);
    await addActiveRegistrations(created.body.event.id, 2);
    await prisma.registration.updateMany({
      where: { eventId: created.body.event.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    const response = await updateEvent(token, created.body.event.id, { capacity: 1 });

    expect(response.status).toBe(200);
    expect(response.body.event.capacity).toBe(1);
  });

  it("does not allow another organizer to edit an event", async () => {
    const owner = await createOrganizer(organizerEmails[0]);
    const otherOrganizer = await createOrganizer(organizerEmails[1]);
    const created = await createEvent(await login(owner.email));

    const response = await updateEvent(
      await login(otherOrganizer.email),
      created.body.event.id,
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    const persisted = await prisma.event.findUniqueOrThrow({
      where: { id: created.body.event.id },
    });
    expect(persisted.name).toBe("Conferência Evento360");
  });

  it("does not edit a removed event", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const token = await login(organizer.email);
    const created = await createEvent(token);
    await request(app)
      .delete(`/api/admin/events/${created.body.event.id}`)
      .set("Authorization", `Bearer ${token}`);

    const response = await updateEvent(token, created.body.event.id);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });

  it("rejects an unauthenticated edit", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const created = await createEvent(await login(organizer.email));

    const response = await request(app)
      .put(`/api/admin/events/${created.body.event.id}`)
      .send({ name: "Invasão", date: "2026-12-21T18:30:00.000Z", location: "X", capacity: 1 });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });
});

describe("event publication", () => {
  it("publishes an owned event and keeps its public URL stable", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const token = await login(organizer.email);
    const created = await createEvent(token);

    const firstPublication = await request(app)
      .post(`/api/admin/events/${created.body.event.id}/publish`)
      .set("Authorization", `Bearer ${token}`);
    const secondPublication = await request(app)
      .post(`/api/admin/events/${created.body.event.id}/publish`)
      .set("Authorization", `Bearer ${token}`);

    expect(firstPublication.status).toBe(200);
    expect(firstPublication.body.event.status).toBe("PUBLISHED");
    expect(firstPublication.body.event.publishedAt).toEqual(expect.any(String));
    expect(secondPublication.status).toBe(200);
    expect(secondPublication.body.publicUrl).toBe(firstPublication.body.publicUrl);
    expect(secondPublication.body.event.publicId).toBe(
      firstPublication.body.event.publicId,
    );
  });

  it("does not allow another organizer to publish an event", async () => {
    const owner = await createOrganizer(organizerEmails[0]);
    const otherOrganizer = await createOrganizer(organizerEmails[1]);
    const created = await createEvent(await login(owner.email));

    const response = await request(app)
      .post(`/api/admin/events/${created.body.event.id}/publish`)
      .set("Authorization", `Bearer ${await login(otherOrganizer.email)}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("does not publish an incomplete event", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: "",
        date: new Date("2026-12-20T14:00:00.000Z"),
        location: "São Paulo",
        capacity: 10,
      },
    });

    const response = await request(app)
      .post(`/api/admin/events/${event.id}/publish`)
      .set("Authorization", `Bearer ${await login(organizer.email)}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    const persisted = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(persisted.status).toBe(EventStatus.DRAFT);
    expect(persisted.publishedAt).toBeNull();
  });
});
