import { EventStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmail = "public.event.owner@example.test";

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: organizerEmail } } });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

async function createEvent(status: EventStatus) {
  const organizer = await prisma.organizer.create({
    data: { email: organizerEmail, passwordHash: await hashPassword("a valid password") },
  });
  return prisma.event.create({
    data: {
      organizerId: organizer.id,
      name: "Encontro Público",
      date: new Date("2026-11-03T14:00:00.000Z"),
      location: "Rio de Janeiro",
      capacity: 2,
      status,
      publishedAt: status === EventStatus.PUBLISHED ? new Date() : null,
    },
  });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("public event page API", () => {
  it("returns only the information required to participate in a published event", async () => {
    const event = await createEvent(EventStatus.PUBLISHED);

    const response = await request(app).get(`/api/public/events/${event.publicId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      event: {
        publicId: event.publicId,
        name: event.name,
        date: event.date.toISOString(),
        location: event.location,
        capacity: 2,
        availableSeats: 2,
        isFull: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("organizerId");
    expect(JSON.stringify(response.body)).not.toContain("registrations");
  });

  it("lists published events with capacity and available seats without exposing drafts", async () => {
    const published = await createEvent(EventStatus.PUBLISHED);
    const draft = await prisma.event.create({
      data: {
        organizerId: published.organizerId,
        name: "Encontro Privado",
        date: new Date("2026-12-03T14:00:00.000Z"),
        location: "Juazeiro",
        capacity: 40,
        status: EventStatus.DRAFT,
      },
    });

    const response = await request(app).get("/api/public/events");

    expect(response.status).toBe(200);
    expect(response.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        publicId: published.publicId,
        name: published.name,
        capacity: published.capacity,
        availableSeats: published.capacity,
        isFull: false,
      }),
    ]));
    expect(response.body.events.some((event: { publicId: string }) => event.publicId === draft.publicId)).toBe(false);
  });

  it("does not expose a draft event", async () => {
    const event = await createEvent(EventStatus.DRAFT);

    const response = await request(app).get(`/api/public/events/${event.publicId}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });

  it("returns not found for an unknown public identifier", async () => {
    const response = await request(app).get("/api/public/events/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });
});
