import { EventStatus, RegistrationStatus } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { prisma } from "../src/lib/prisma.js";

// Mock to capture email notification containing QR Code and Ticket details
vi.mock("../src/services/resend.js", () => ({
  buildRegistrationConfirmationEmail: vi.fn(),
  sendRegistrationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendTicketEmail: vi.fn().mockResolvedValue({ success: true }),
}));
import { sendTicketEmail } from "../src/services/resend.js";

const organizerEmail = "e2e.flow@example.test";
const sendTicketEmailMock = vi.mocked(sendTicketEmail);

async function removeTestData() {
  await prisma.event.deleteMany({
    where: { organizer: { email: organizerEmail } },
  });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await removeTestData();
});
afterEach(removeTestData);

describe("E2E Ticket Flow: from registration to check-in", () => {
  it("executes the full lifecycle of a ticket", async () => {
    // 1. Create Organizer and Login
    await prisma.organizer.create({
      data: {
        email: organizerEmail,
        passwordHash: await hashPassword("pass123"),
      },
    });
    const loginRes = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: organizerEmail, password: "pass123" });
    const adminToken = loginRes.body.token;

    // 2. Create and Publish Event
    const createEventRes = await request(app)
      .post("/api/admin/events")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "E2E Masterclass",
        date: new Date("2026-12-10T14:00:00Z").toISOString(),
        location: "Auditório Online",
        capacity: 100,
      });
    const eventId = createEventRes.body.event.id;
    const publishEventRes = await request(app)
      .post(`/api/admin/events/${eventId}/publish`)
      .set("Authorization", `Bearer ${adminToken}`);
    const publicId = publishEventRes.body.event.publicId;

    // 3. Register Participant
    const registerRes = await request(app)
      .post(`/api/public/events/${publicId}/registrations`)
      .send({
        participantName: "Juliana Silva",
        participantEmail: "juliana@example.test",
        participantPhone: "+55 11 99999-9999",
      });

    expect(registerRes.status).toBe(201);
    const confirmationCode = registerRes.body.registration.confirmationCode;
    expect(confirmationCode).toBeTruthy();

    // 4. Verify QR Code and Notification payload
    // Wait for async promises to flush since sendTicketEmail is wrapped in Promise.resolve().then()
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendTicketEmailMock).toHaveBeenCalledOnce();
    const [to, name, eventName, ticketCode, qrCodeUrl] =
      sendTicketEmailMock.mock.calls[0];
    expect(to).toBe("juliana@example.test");
    expect(name).toBe("Juliana Silva");
    expect(eventName).toBe("E2E Masterclass");
    expect(ticketCode).toBe(confirmationCode);
    expect(qrCodeUrl).toContain(encodeURIComponent(confirmationCode)); // QR code URL contains the string code

    // 5. Organizer searches for ticket in check-in endpoint
    const searchRes = await request(app)
      .get(`/api/admin/events/${eventId}/check-in?query=${confirmationCode}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.registrations).toHaveLength(1);
    const registrationId = searchRes.body.registrations[0].id;
    expect(searchRes.body.registrations[0].checkedInAt).toBeNull();

    // 6. Organizer checks-in the ticket
    const checkinRes = await request(app)
      .post(
        `/api/admin/events/${eventId}/registrations/${registrationId}/check-in`,
      )
      .set("Authorization", `Bearer ${adminToken}`);

    expect(checkinRes.status).toBe(200);
    expect(checkinRes.body.registration.checkedInAt).not.toBeNull();

    // 7. Verify Duplicate check-in is prevented
    const duplicateCheckinRes = await request(app)
      .post(
        `/api/admin/events/${eventId}/registrations/${registrationId}/check-in`,
      )
      .set("Authorization", `Bearer ${adminToken}`);

    expect(duplicateCheckinRes.status).toBe(409);
    expect(duplicateCheckinRes.body.error.code).toBe("ALREADY_CHECKED_IN");
  });
});
