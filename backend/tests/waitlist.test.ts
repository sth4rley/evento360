import { EventStatus, RegistrationStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/registration-notifications.js", () => ({
  notifyRegistrationCreated: vi.fn().mockResolvedValue(undefined),
  notifyRegistrationPromoted: vi.fn().mockResolvedValue(undefined),
}));

import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  notifyRegistrationCreated,
  notifyRegistrationPromoted,
} from "../src/services/registration-notifications.js";

const organizerEmail = "waitlist.owner@example.test";

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: organizerEmail } } });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

async function createEvent(capacity = 1, date = new Date("2027-03-10T19:00:00.000Z")) {
  const organizer = await prisma.organizer.create({
    data: { email: organizerEmail, passwordHash: await hashPassword("a valid password") },
  });
  return prisma.event.create({
    data: {
      organizerId: organizer.id,
      name: "Evento com lista de espera",
      date,
      location: "Petrolina",
      capacity,
      status: EventStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
}

function register(publicId: string, participantEmail: string, joinWaitlist?: boolean) {
  return request(app).post(`/api/public/events/${publicId}/registrations`).send({
    participantName: participantEmail.split("@")[0],
    participantEmail,
    participantPhone: "87999990000",
    ...(joinWaitlist === undefined ? {} : { joinWaitlist }),
  });
}

function cancel(token: string) {
  return request(app).post(`/api/public/registrations/cancel/${token}`);
}

async function statusOf(confirmationCode: string) {
  const registration = await prisma.registration.findUniqueOrThrow({
    where: { confirmationCode },
  });
  return registration.status;
}

async function organizerToken() {
  const response = await request(app)
    .post("/api/admin/auth/login")
    .send({ email: organizerEmail, password: "a valid password" });
  return response.body.token as string;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await removeTestData();
});
afterEach(removeTestData);

describe("joining the waitlist", () => {
  it("keeps rejecting a full event when the waitlist was not requested", async () => {
    const event = await createEvent(1);
    await register(event.publicId, "primeira@example.test");

    const response = await register(event.publicId, "segunda@example.test");

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EVENT_FULL");
  });

  it("queues registrations in arrival order when the event is full", async () => {
    const event = await createEvent(1);
    await register(event.publicId, "primeira@example.test");

    const first = await register(event.publicId, "fila1@example.test", true);
    const second = await register(event.publicId, "fila2@example.test", true);

    expect(first.status).toBe(201);
    expect(first.body.registration).toMatchObject({ status: "WAITLISTED", waitlistPosition: 1 });
    expect(first.body.registration.confirmationCode).toMatch(/^\d{8}$/);
    expect(first.body.registration.cancellationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(second.body.registration).toMatchObject({ status: "WAITLISTED", waitlistPosition: 2 });
    expect(vi.mocked(notifyRegistrationCreated)).toHaveBeenCalledTimes(3);
  });

  it("does not use the waitlist while seats are available", async () => {
    const event = await createEvent(2);

    const response = await register(event.publicId, "vaga@example.test", true);

    expect(response.status).toBe(201);
    expect(response.body.registration).toMatchObject({ status: "ACTIVE", waitlistPosition: null });
  });

  it("does not count waitlisted registrations as occupied seats", async () => {
    const event = await createEvent(1);
    await register(event.publicId, "primeira@example.test");
    await register(event.publicId, "fila@example.test", true);

    const publicEvent = await request(app).get(`/api/public/events/${event.publicId}`);

    expect(publicEvent.body.event).toMatchObject({ availableSeats: 0, isFull: true });
    expect(
      await prisma.registration.count({ where: { eventId: event.id, status: RegistrationStatus.ACTIVE } }),
    ).toBe(1);
  });

  it.each([
    ["an active registration", "primeira@example.test"],
    ["a waitlisted registration", "fila@example.test"],
  ])("rejects a duplicate of %s", async (_label, email) => {
    const event = await createEvent(1);
    await register(event.publicId, "primeira@example.test");
    await register(event.publicId, "fila@example.test", true);

    const response = await register(event.publicId, email, true);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("REGISTRATION_DUPLICATE");
  });

  it("shows the current position through the public confirmation code", async () => {
    const event = await createEvent(1);
    await register(event.publicId, "primeira@example.test");
    await register(event.publicId, "fila1@example.test", true);
    const second = await register(event.publicId, "fila2@example.test", true);

    const response = await request(app).get(
      `/api/public/registrations/confirmation/${second.body.registration.confirmationCode}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.registration).toMatchObject({ status: "WAITLISTED", waitlistPosition: 2 });
    expect(response.body.registration).not.toHaveProperty("id");
    expect(response.body.registration).not.toHaveProperty("eventId");
  });
});

describe("promotion from the waitlist", () => {
  it("promotes the first person in line when an active registration is cancelled", async () => {
    const event = await createEvent(1);
    const active = await register(event.publicId, "primeira@example.test");
    const first = await register(event.publicId, "fila1@example.test", true);
    const second = await register(event.publicId, "fila2@example.test", true);

    const response = await cancel(active.body.registration.cancellationToken);

    expect(response.status).toBe(200);
    expect(await statusOf(first.body.registration.confirmationCode)).toBe(RegistrationStatus.ACTIVE);
    expect(await statusOf(second.body.registration.confirmationCode)).toBe(RegistrationStatus.WAITLISTED);

    const promoted = await prisma.registration.findUniqueOrThrow({
      where: { confirmationCode: first.body.registration.confirmationCode },
    });
    expect(promoted.promotedAt).toBeInstanceOf(Date);

    expect(vi.mocked(notifyRegistrationPromoted)).toHaveBeenCalledOnce();
    expect(vi.mocked(notifyRegistrationPromoted).mock.calls[0][0].registration).toMatchObject({
      participantEmail: "fila1@example.test",
      status: "ACTIVE",
    });

    const position = await request(app).get(
      `/api/public/registrations/confirmation/${second.body.registration.confirmationCode}`,
    );
    expect(position.body.registration.waitlistPosition).toBe(1);
  });

  it("does not promote anyone twice when the same cancellation is repeated", async () => {
    const event = await createEvent(1);
    const active = await register(event.publicId, "primeira@example.test");
    await register(event.publicId, "fila1@example.test", true);
    const second = await register(event.publicId, "fila2@example.test", true);

    await cancel(active.body.registration.cancellationToken);
    await cancel(active.body.registration.cancellationToken);

    expect(await statusOf(second.body.registration.confirmationCode)).toBe(RegistrationStatus.WAITLISTED);
    expect(vi.mocked(notifyRegistrationPromoted)).toHaveBeenCalledOnce();
    expect(
      await prisma.registration.count({ where: { eventId: event.id, status: RegistrationStatus.ACTIVE } }),
    ).toBe(1);
  });

  it("lets a person leave the waitlist without releasing a seat", async () => {
    const event = await createEvent(1);
    const active = await register(event.publicId, "primeira@example.test");
    const first = await register(event.publicId, "fila1@example.test", true);
    const second = await register(event.publicId, "fila2@example.test", true);

    const response = await cancel(first.body.registration.cancellationToken);

    expect(response.body.registration.status).toBe("CANCELLED");
    expect(await statusOf(active.body.registration.confirmationCode)).toBe(RegistrationStatus.ACTIVE);
    expect(await statusOf(second.body.registration.confirmationCode)).toBe(RegistrationStatus.WAITLISTED);
    expect(vi.mocked(notifyRegistrationPromoted)).not.toHaveBeenCalled();
  });

  it("does not promote after the event has already happened", async () => {
    const event = await createEvent(1);
    const active = await register(event.publicId, "primeira@example.test");
    const waiting = await register(event.publicId, "fila@example.test", true);
    await prisma.event.update({
      where: { id: event.id },
      data: { date: new Date(Date.now() - 60_000) },
    });

    await cancel(active.body.registration.cancellationToken);

    expect(await statusOf(waiting.body.registration.confirmationCode)).toBe(RegistrationStatus.WAITLISTED);
    expect(vi.mocked(notifyRegistrationPromoted)).not.toHaveBeenCalled();
  });
});

describe("organizer view of the waitlist", () => {
  it("lists waitlisted people without counting them as active", async () => {
    const event = await createEvent(1);
    await register(event.publicId, "primeira@example.test");
    await register(event.publicId, "fila@example.test", true);

    const response = await request(app)
      .get(`/api/admin/events/${event.id}/participants`)
      .set("Authorization", `Bearer ${await organizerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.metrics).toEqual({ capacity: 1, activeRegistrations: 1, availableSeats: 0 });
    expect(
      response.body.participants.map((participant: { status: string }) => participant.status),
    ).toEqual(["ACTIVE", "WAITLISTED"]);
  });

  it("does not check in a waitlisted registration", async () => {
    const event = await createEvent(1);
    await register(event.publicId, "primeira@example.test");
    const waiting = await register(event.publicId, "fila@example.test", true);
    const registration = await prisma.registration.findUniqueOrThrow({
      where: { confirmationCode: waiting.body.registration.confirmationCode },
    });

    const response = await request(app)
      .post(`/api/admin/events/${event.id}/registrations/${registration.id}/check-in`)
      .set("Authorization", `Bearer ${await organizerToken()}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("REGISTRATION_WAITLISTED");
  });
});
