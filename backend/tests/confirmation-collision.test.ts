import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generatedNumbers = vi.hoisted(() => [12_345_678, 87_654_321]);

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomInt: vi.fn(() => generatedNumbers.shift() ?? 87_654_321),
  };
});

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmail = "confirmation.collision.owner@example.test";

async function removeTestData() {
  await prisma.event.deleteMany({
    where: { organizer: { email: organizerEmail } },
  });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

beforeEach(async () => {
  generatedNumbers.splice(0, generatedNumbers.length, 12_345_678, 87_654_321);
  await removeTestData();
});
afterEach(removeTestData);

describe("numeric confirmation code allocation", () => {
  it("generates another code when the first numeric candidate already exists", async () => {
    const organizer = await prisma.organizer.create({
      data: { email: organizerEmail },
    });
    const [occupiedEvent, targetEvent] = await Promise.all([
      prisma.event.create({
        data: {
          organizerId: organizer.id,
          name: "Evento com código ocupado",
          date: new Date("2036-01-10T12:00:00.000Z"),
          location: "Recife",
          capacity: 10,
          status: "PUBLISHED",
        },
      }),
      prisma.event.create({
        data: {
          organizerId: organizer.id,
          name: "Evento que receberá outro código",
          date: new Date("2036-01-11T12:00:00.000Z"),
          location: "Petrolina",
          capacity: 10,
          status: "PUBLISHED",
        },
      }),
    ]);
    await prisma.registration.create({
      data: {
        eventId: occupiedEvent.id,
        participantName: "Código Existente",
        participantEmail: "occupied.code@example.test",
        participantPhone: "5587999990000",
        confirmationCode: "12345678",
      },
    });

    const response = await request(app)
      .post(`/api/public/events/${targetEvent.publicId}/registrations`)
      .send({
        participantName: "Novo Participante",
        participantEmail: "new.code@example.test",
        participantPhone: "+55 87 99999-1000",
      });

    expect(response.status).toBe(201);
    expect(response.body.registration.confirmationCode).toBe("87654321");
  });
});
