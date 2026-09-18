import { EventStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";

const { mockSend, mockPrisma } = vi.hoisted(() => {
  return {
    mockSend: vi.fn().mockResolvedValue({ id: "resend-id" }),
    mockPrisma: {
      event: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      registration: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      organizer: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

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
    const fakeDate = new Date("2026-09-09T18:05:07.327Z");
    
    // Simulate events found by the cron job
    mockPrisma.event.findMany.mockResolvedValueOnce([{ id: "event-1" }]);
    
    // Simulate event findUnique with organizer include
    mockPrisma.event.findUnique.mockResolvedValueOnce({
      id: "event-1",
      name: "Test Event",
      publicId: "pub-123",
      organizerReportSentAt: null,
      organizer: { email: "org@example.com" },
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
    // Simulate registrations findMany
    mockPrisma.registration.findMany.mockResolvedValueOnce([
      {
        participantName: "Alice",
        participantEmail: "alice@example.com",
        participantPhone: null,
        confirmationCode: "CODE123",
        createdAt: fakeDate,
      },
    });
    ]);

    // Run automated job
    await checkAndSendClosedEventReports();

    // Verification
    expect(mockSend).toHaveBeenCalledOnce();
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toBe("org@example.com");
    expect(callArgs.subject).toContain("Test Event");

    
    // Check CSV buffer
    const attachment = callArgs.attachments[0];
    expect(attachment.filename).toBe(`participantes-${event.publicId}.csv`);
    expect(attachment.filename).toBe(`participantes-pub-123.csv`);
    const csvStr = Buffer.from(attachment.content).toString("utf-8");
    expect(csvStr).toContain('"Alice","alice@example.com","","CODE123"');
    expect(csvStr).toContain('\ufeffNome,E-mail,Telefone,Código,Data de Inscrição');
    expect(csvStr).toContain('"Alice","alice@example.com","","CODE123","2026-09-09T18:05:07.327Z"');

    // Ensure it doesn't send again
    await checkAndSendClosedEventReports();
    expect(mockSend).toHaveBeenCalledOnce(); // Still 1
    // Check that event was updated
    expect(mockPrisma.event.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { organizerReportSentAt: expect.any(Date) },
    });

    // Or manual trigger won't send again
    await sendOrganizerEventSummary(event.id);
    // --- Second part: test idempotence ---
    mockPrisma.event.findUnique.mockResolvedValueOnce({
      id: "event-1",
      name: "Test Event",
      publicId: "pub-123",
      organizerReportSentAt: new Date(),
      organizer: { email: "org@example.com" },
    });

    await sendOrganizerEventSummary("event-1");
    // Should still be called only once
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
