import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createAccessToken } from "../src/auth/token.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmails = [
  "event.remove.owner@example.test",
  "event.remove.other@example.test",
];

async function removeTestData() {
  await prisma.event.deleteMany({
    where: { organizer: { email: { in: organizerEmails } } },
  });
  await prisma.organizer.deleteMany({
    where: { email: { in: organizerEmails } },
  });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("event removal", () => {
  it("does not resurrect a draft archived after the publication request reads it", async () => {
    const organizer = await prisma.organizer.create({ data: { email: organizerEmails[0] } });
    const event = await prisma.event.create({ data: {
      organizerId: organizer.id, name: "Concurrent archive", date: new Date("2027-01-01"), location: "Local", capacity: 10,
    } });
    const original = prisma.event.findUnique.bind(prisma.event);
    const read = vi.spyOn(prisma.event, "findUnique").mockImplementationOnce(async (args) => {
      const snapshot = await original(args);
      await prisma.event.update({ where: { id: event.id }, data: { status: "ARCHIVED" } });
      return snapshot;
    });
    try {
      const response = await request(app).post(`/api/admin/events/${event.id}/publish`)
        .set("Authorization", `Bearer ${createAccessToken(organizer.id)}`);
      expect(response.status).toBe(404);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("ARCHIVED");
    } finally {
      read.mockRestore();
      // Prisma delegates are proxies; explicitly restore the callable delegate.
      prisma.event.findUnique = original;
    }
  });

  it("archives an owned event without silently deleting registrations", async () => {
    const organizer = await prisma.organizer.create({
      data: {
        email: organizerEmails[0],
        passwordHash: await hashPassword("owner-password"),
      },
    });
    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: "Evento a arquivar",
        date: new Date("2026-12-20T18:00:00.000Z"),
        location: "Petrolina",
        capacity: 10,
        status: "PUBLISHED",
      },
    });
    const registration = await prisma.registration.create({
      data: {
        eventId: event.id,
        participantName: "Pessoa Inscrita",
        participantEmail: "event.remove.guest@example.test",
        confirmationCode: "EVT-REMOVE-PRESERVED",
        cancellationToken: "cancel-remove-preserved",
      },
    });
    const admin = {
      Authorization: `Bearer ${createAccessToken(organizer.id, "ORGANIZER")}`,
    };

    const removed = await request(app)
      .delete(`/api/admin/events/${event.id}`)
      .set(admin);
    expect(removed.status).toBe(204);

    const [storedEvent, storedRegistration, list, publicLookup, newRegistration] =
      await Promise.all([
        prisma.event.findUniqueOrThrow({ where: { id: event.id } }),
        prisma.registration.findUnique({ where: { id: registration.id } }),
        request(app).get("/api/admin/events").set(admin),
        request(app).get(`/api/public/events/${event.publicId}`),
        request(app)
          .post(`/api/public/events/${event.publicId}/registrations`)
          .send({
            participantName: "Nova Pessoa",
            participantEmail: "event.remove.new@example.test",
            participantPhone: "+55 87 99999-3000",
          }),
      ]);

    expect(storedEvent.status).toBe("ARCHIVED");
    expect(storedRegistration?.id).toBe(registration.id);
    expect(list.body.events).toEqual([]);
    expect(publicLookup.status).toBe(404);
    expect(newRegistration.status).toBe(409);
    expect(newRegistration.body.error.code).toBe("EVENT_NOT_PUBLISHED");
  });

  it("never lets another organizer remove the event", async () => {
    const [owner, other] = await Promise.all(
      organizerEmails.map((email) => prisma.organizer.create({ data: { email } })),
    );
    const event = await prisma.event.create({
      data: {
        organizerId: owner.id,
        name: "Evento protegido",
        date: new Date("2026-12-21T18:00:00.000Z"),
        location: "Juazeiro",
        capacity: 10,
      },
    });

    const response = await request(app)
      .delete(`/api/admin/events/${event.id}`)
      .set(
        "Authorization",
        `Bearer ${createAccessToken(other.id, "ORGANIZER")}`,
      );
    expect(response.status).toBe(403);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      "DRAFT",
    );
  });
});
