import { EventStatus, RegistrationStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmails = ["checkin.owner@example.test", "checkin.other@example.test"];

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

async function createEvent(organizerId: string) {
  return prisma.event.create({ data: { organizerId, name: "Evento check-in", date: new Date("2026-11-03T14:00:00.000Z"), location: "Salvador", capacity: 5, status: EventStatus.PUBLISHED, publishedAt: new Date() } });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("event check-in", () => {
  it("searches partial names case-insensitively and confirmation codes exactly", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const event = await createEvent(organizer.id);
    const ana = await prisma.registration.create({ data: { eventId: event.id, participantName: "Ana Beatriz", participantEmail: "ana@example.test", confirmationCode: "EVT-ANA123" } });
    await prisma.registration.create({ data: { eventId: event.id, participantName: "Bruno Alves", participantEmail: "bruno@example.test", confirmationCode: "EVT-BRUNO456" } });
    const token = await login(organizer.email);

    const byName = await request(app).get(`/api/admin/events/${event.id}/check-in?query=BEA`).set("Authorization", `Bearer ${token}`);
    const byCode = await request(app).get(`/api/admin/events/${event.id}/check-in?query=evt-ana123`).set("Authorization", `Bearer ${token}`);

    expect(byName.body.registrations).toHaveLength(1);
    expect(byName.body.registrations[0].id).toBe(ana.id);
    expect(byCode.body.registrations).toHaveLength(1);
    expect(byCode.body.registrations[0].confirmationCode).toBe("EVT-ANA123");
  });

  it("records a valid check-in once and keeps counters consistent", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const event = await createEvent(organizer.id);
    const registration = await prisma.registration.create({ data: { eventId: event.id, participantName: "Ana", participantEmail: "ana@example.test", confirmationCode: "EVT-ANA123" } });
    await prisma.registration.create({ data: { eventId: event.id, participantName: "Bruno", participantEmail: "bruno@example.test", confirmationCode: "EVT-BRUNO456" } });
    await prisma.registration.create({ data: { eventId: event.id, participantName: "Carla", participantEmail: "carla@example.test", confirmationCode: "EVT-CARLA789", status: RegistrationStatus.CANCELLED, cancelledAt: new Date() } });
    const token = await login(organizer.email);

    const response = await request(app).post(`/api/admin/events/${event.id}/registrations/${registration.id}/check-in`).set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.registration.checkedInAt).toEqual(expect.any(String));
    expect(response.body.metrics).toEqual({ activeRegistrations: 2, checkIns: 1, pending: 1 });
  });

  it("rejects duplicate check-in without changing its original timestamp", async () => {
    const organizer = await createOrganizer(organizerEmails[0]);
    const event = await createEvent(organizer.id);
    const registration = await prisma.registration.create({ data: { eventId: event.id, participantName: "Ana", participantEmail: "ana@example.test", confirmationCode: "EVT-ANA123" } });
    const token = await login(organizer.email);
    const first = await request(app).post(`/api/admin/events/${event.id}/registrations/${registration.id}/check-in`).set("Authorization", `Bearer ${token}`);
    const duplicate = await request(app).post(`/api/admin/events/${event.id}/registrations/${registration.id}/check-in`).set("Authorization", `Bearer ${token}`);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ALREADY_CHECKED_IN");
    const persisted = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(persisted.checkedInAt?.toISOString()).toBe(first.body.registration.checkedInAt);
  });

  it("rejects canceled registrations and a different organizer", async () => {
    const owner = await createOrganizer(organizerEmails[0]);
    const other = await createOrganizer(organizerEmails[1]);
    const event = await createEvent(owner.id);
    const canceled = await prisma.registration.create({ data: { eventId: event.id, participantName: "Ana", participantEmail: "ana@example.test", confirmationCode: "EVT-ANA123", status: RegistrationStatus.CANCELLED, cancelledAt: new Date() } });

    const canceledResponse = await request(app).post(`/api/admin/events/${event.id}/registrations/${canceled.id}/check-in`).set("Authorization", `Bearer ${await login(owner.email)}`);
    const forbidden = await request(app).get(`/api/admin/events/${event.id}/check-in?query=Ana`).set("Authorization", `Bearer ${await login(other.email)}`);

    expect(canceledResponse.status).toBe(409);
    expect(canceledResponse.body.error.code).toBe("REGISTRATION_CANCELLED");
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
  });
});
