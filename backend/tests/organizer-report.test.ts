import { EventStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";

const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn().mockResolvedValue({ id: "resend-id" }) };
});

vi.mock("resend", () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: mockSend },
    })),
  };
});

import {
  checkAndSendClosedEventReports,
  sendOrganizerEventSummary,
} from "../src/services/organizer-report.js";

describe("Organizer Report Service", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.registration.deleteMany();
    await prisma.event.deleteMany();
    await prisma.organizer.deleteMany();
  });

  afterEach(async () => {
    await prisma.registration.deleteMany();
    await prisma.event.deleteMany();
    await prisma.organizer.deleteMany();
  });

  it("generates CSV and sends email only once", async () => {
    const organizer = await prisma.organizer.create({
      data: { email: "org@example.com", passwordHash: "hash" },
    });
    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: "Test Event",
        date: new Date(),
        location: "Online",
        capacity: 10,
        status: EventStatus.PUBLISHED,
        registrationDeadline: new Date(Date.now() - 10000), // in the past
      },
    });

    await prisma.registration.create({
      data: {
        eventId: event.id,
        participantName: "Alice",
        participantEmail: "alice@example.com",
        confirmationCode: "CODE123",
      },
    });

    // Run automated job
    await checkAndSendClosedEventReports();

    expect(mockSend).toHaveBeenCalledOnce();
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toBe("org@example.com");
    expect(callArgs.subject).toContain("Test Event");
    
    // Check CSV buffer
    const attachment = callArgs.attachments[0];
    expect(attachment.filename).toBe(`participantes-${event.publicId}.csv`);
    const csvStr = Buffer.from(attachment.content).toString("utf-8");
    expect(csvStr).toContain('"Alice","alice@example.com","","CODE123"');

    // Ensure it doesn't send again
    await checkAndSendClosedEventReports();
    expect(mockSend).toHaveBeenCalledOnce(); // Still 1

    // Or manual trigger won't send again
    await sendOrganizerEventSummary(event.id);
    expect(mockSend).toHaveBeenCalledOnce(); 
  });
});
