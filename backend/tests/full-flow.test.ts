import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmail = "complete.flow.owner@example.test";

async function removeTestData() {
  await prisma.event.deleteMany({ where: { organizer: { email: organizerEmail } } });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("complete event workflow", () => {
  it("runs publication, capacity, cancellation, replacement registration and check-in", async () => {
    const organizer = await prisma.organizer.create({
      data: { email: organizerEmail, passwordHash: await hashPassword("a valid password") },
    });
    const login = await request(app).post("/api/admin/auth/login").send({
      email: organizer.email,
      password: "a valid password",
    });
    const token = login.body.token as string;
    const admin = { Authorization: `Bearer ${token}` };

    const created = await request(app).post("/api/admin/events").set(admin).send({
      name: "Fluxo completo",
      date: "2026-12-20T14:00:00.000Z",
      location: "São Paulo",
      capacity: 2,
    });
    expect(created.status).toBe(201);

    const published = await request(app)
      .post(`/api/admin/events/${created.body.event.id}/publish`)
      .set(admin);
    expect(published.status).toBe(200);
    const publicId = published.body.event.publicId as string;

    const register = (participantName: string, participantEmail: string) =>
      request(app)
        .post(`/api/public/events/${publicId}/registrations`)
        .send({ participantName, participantEmail, participantPhone: "+55 11 99999-0000" });
    const first = await register("Participante Um", "um@example.test");
    const second = await register("Participante Dois", "dois@example.test");
    const full = await register("Participante Três", "tres@example.test");
    expect([first.status, second.status, full.status]).toEqual([201, 201, 409]);
    expect(full.body.error.code).toBe("EVENT_FULL");

    const beforeCancellation = await request(app)
      .get(`/api/admin/events/${created.body.event.id}/participants`)
      .set(admin);
    expect(beforeCancellation.body.metrics).toEqual({
      capacity: 2,
      activeRegistrations: 2,
      availableSeats: 0,
    });

    const cancelled = await request(app).post(
      `/api/public/registrations/cancel/${first.body.registration.cancellationToken}`,
    );
    expect(cancelled.body.registration.status).toBe("CANCELLED");

    const third = await register("Participante Três", "tres@example.test");
    expect(third.status).toBe(201);
    const afterReplacement = await request(app)
      .get(`/api/admin/events/${created.body.event.id}/participants`)
      .set(admin);
    expect(afterReplacement.body.metrics).toEqual({
      capacity: 2,
      activeRegistrations: 2,
      availableSeats: 0,
    });

    const byName = await request(app)
      .get(`/api/admin/events/${created.body.event.id}/check-in?query=Dois`)
      .set(admin);
    const secondRegistration = byName.body.registrations[0];
    const secondCheckIn = await request(app)
      .post(`/api/admin/events/${created.body.event.id}/registrations/${secondRegistration.id}/check-in`)
      .set(admin);
    expect(secondCheckIn.status).toBe(200);

    const byCode = await request(app)
      .get(`/api/admin/events/${created.body.event.id}/check-in?query=${third.body.registration.confirmationCode}`)
      .set(admin);
    const thirdCheckIn = await request(app)
      .post(`/api/admin/events/${created.body.event.id}/registrations/${byCode.body.registrations[0].id}/check-in`)
      .set(admin);
    expect(thirdCheckIn.status).toBe(200);

    const duplicateCheckIn = await request(app)
      .post(`/api/admin/events/${created.body.event.id}/registrations/${secondRegistration.id}/check-in`)
      .set(admin);
    expect(duplicateCheckIn.status).toBe(409);
    expect(duplicateCheckIn.body.error.code).toBe("ALREADY_CHECKED_IN");

    const finalMetrics = await request(app)
      .get(`/api/admin/events/${created.body.event.id}/check-in`)
      .set(admin);
    expect(finalMetrics.body.metrics).toEqual({
      activeRegistrations: 2,
      checkIns: 2,
      pending: 0,
    });
  });
});
