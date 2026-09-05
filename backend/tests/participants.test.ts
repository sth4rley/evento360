import { EventStatus, RegistrationStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmails = ["participants.owner@example.test", "participants.other@example.test"];

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: { in: organizerEmails } } } });
  await prisma.organizer.deleteMany({ where: { email: { in: organizerEmails } } });
}

async function createOrganizer(email: string) {
  return prisma.organizer.create({ data: { email, passwordHash: await hashPassword("a valid password") } });
}

async function login(email: string) {
  const response = await request(app).post("/api/admin/auth/login").send({ email, password: "a valid password" });
  return response.body.token as string;
}

async function createEvent(organizerId: string, capacity: number) {
  return prisma.event.create({
    data: { organizerId, name: "Evento com painel", date: new Date("2026-11-03T14:00:00.000Z"), location: "Curitiba", capacity, status: EventStatus.PUBLISHED, publishedAt: new Date() },
  });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("event participant dashboard", () => {
  it("shows empty metrics for an event with no registrations", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const event = await createEvent(organizer.id, 3);
    const response = await request(app).get(`/api/admin/events/${event.id}/participants`).set("Authorization", `Bearer ${await login(organizer.email)}`);

    expect(response.status).toBe(200);
    expect(response.body.metrics).toEqual({ capacity: 3, activeRegistrations: 0, availableSeats: 3 });
    expect(response.body.participants).toEqual([]);
  });

  it("keeps list and active counters consistent for a partially filled event", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const event = await createEvent(organizer.id, 3);
    await prisma.registration.createMany({ data: [
      { eventId: event.id, participantName: "Ana", participantEmail: "ana@example.test", status: RegistrationStatus.ACTIVE },
      { eventId: event.id, participantName: "Bruno", participantEmail: "bruno@example.test", status: RegistrationStatus.CANCELLED },
    ] });

    const response = await request(app).get(`/api/admin/events/${event.id}/participants`).set("Authorization", `Bearer ${await login(organizer.email)}`);

    expect(response.status).toBe(200);
    expect(response.body.metrics).toEqual({ capacity: 3, activeRegistrations: 1, availableSeats: 2 });
    expect(response.body.participants).toHaveLength(2);
    expect(response.body.participants.filter((participant: { status: string }) => participant.status === "ACTIVE")).toHaveLength(response.body.metrics.activeRegistrations);
  });

  it("reports zero available seats for a full event", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const event = await createEvent(organizer.id, 1);
    await prisma.registration.create({ data: { eventId: event.id, participantName: "Ana", participantEmail: "ana@example.test" } });

    const response = await request(app).get(`/api/admin/events/${event.id}/participants`).set("Authorization", `Bearer ${await login(organizer.email)}`);

    expect(response.body.metrics).toEqual({ capacity: 1, activeRegistrations: 1, availableSeats: 0 });
  });

  it("does not let another organizer view participants", async () => {
    const owner = await createOrganizer(organizerEmails[0]);
    const other = await createOrganizer(organizerEmails[1]);
    const event = await createEvent(owner.id, 1);

    const response = await request(app).get(`/api/admin/events/${event.id}/participants`).set("Authorization", `Bearer ${await login(other.email)}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});
