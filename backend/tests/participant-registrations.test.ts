import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createAccessToken } from "../src/auth/token.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmail = "participant.dashboard.owner@example.test";
const participantEmails = [
  "dashboard.one@example.test",
  "dashboard.two@example.test",
];

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: organizerEmail } } });
  await prisma.participant.deleteMany({
    where: { email: { in: participantEmails } },
  });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("participant registrations dashboard", () => {
  it("links authenticated registrations to the server identity and isolates the list", async () => {
    const organizer = await prisma.organizer.create({
      data: {
        email: organizerEmail,
        passwordHash: await hashPassword("owner-password"),
      },
    });
    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: "Evento do painel participante",
        date: new Date("2026-12-10T18:00:00.000Z"),
        location: "Petrolina",
        capacity: 20,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    const [first, second] = await Promise.all([
      prisma.participant.create({
        data: {
          username: "dashboard_one",
          name: "Participante Um",
          email: participantEmails[0],
          passwordHash: await hashPassword("participant-password"),
        },
      }),
      prisma.participant.create({
        data: {
          username: "dashboard_two",
          name: "Participante Dois",
          email: participantEmails[1],
          passwordHash: await hashPassword("participant-password"),
        },
      }),
    ]);

    const firstToken = createAccessToken(first.id, "PARTICIPANT");
    const registration = await request(app)
      .post(`/api/public/events/${event.publicId}/registrations`)
      .set("Authorization", `Bearer ${firstToken}`)
      .send({
        participantName: "Nome forjado",
        participantEmail: participantEmails[1],
        participantPhone: "+55 87 99999-1000",
      });
    expect(registration.status).toBe(201);

    const stored = await prisma.registration.findFirstOrThrow({
      where: { eventId: event.id, participantId: first.id },
    });
    expect(stored).toMatchObject({
      participantName: first.name,
      participantEmail: first.email,
      participantId: first.id,
    });

    await prisma.registration.create({
      data: {
        eventId: event.id,
        participantId: second.id,
        participantName: second.name,
        participantEmail: second.email,
        confirmationCode: "EVT-DASHBOARD-OTHER",
        cancellationToken: "cancel-dashboard-other",
      },
    });

    const dashboard = await request(app)
      .get("/api/public/auth/me/registrations")
      .set("Authorization", `Bearer ${firstToken}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.registrations).toHaveLength(1);
    expect(dashboard.body.registrations[0]).toMatchObject({
      id: stored.id,
      confirmationCode: stored.confirmationCode,
      event: { publicId: event.publicId, name: event.name },
    });
    expect(JSON.stringify(dashboard.body)).not.toContain(second.email);
  });

  it("keeps anonymous registration working without an account link", async () => {
    const organizer = await prisma.organizer.create({
      data: { email: organizerEmail },
    });
    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: "Evento público",
        date: new Date("2026-12-11T18:00:00.000Z"),
        location: "Juazeiro",
        capacity: 5,
        status: "PUBLISHED",
      },
    });

    const response = await request(app)
      .post(`/api/public/events/${event.publicId}/registrations`)
      .send({
        participantName: "Visitante",
        participantEmail: "guest.dashboard@example.test",
        participantPhone: "+55 87 99999-2000",
      });
    expect(response.status).toBe(201);
    const stored = await prisma.registration.findUniqueOrThrow({
      where: { confirmationCode: response.body.registration.confirmationCode },
    });
    expect(stored.participantId).toBeNull();
  });
});
