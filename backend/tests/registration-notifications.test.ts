import { RegistrationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/resend.js", () => ({
  sendRegistrationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendTicketEmail: vi.fn().mockResolvedValue({ success: true }),
  sendWaitlistEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/services/n8n.js", () => ({
  sendRegistrationCreatedWebhook: vi.fn().mockResolvedValue(undefined),
}));

import type { CreatedRegistration } from "../src/domain/registrations.js";
import { sendRegistrationCreatedWebhook } from "../src/services/n8n.js";
import {
  buildTicketQrCodeUrl,
  notifyRegistrationCreated,
  notifyRegistrationPromoted,
} from "../src/services/registration-notifications.js";
import {
  sendRegistrationConfirmationEmail,
  sendTicketEmail,
  sendWaitlistEmail,
} from "../src/services/resend.js";

const mockSendRegistrationConfirmationEmail = vi.mocked(
  sendRegistrationConfirmationEmail,
);
const mockSendTicketEmail = vi.mocked(sendTicketEmail);
const mockSendWaitlistEmail = vi.mocked(sendWaitlistEmail);
const mockSendWebhook = vi.mocked(sendRegistrationCreatedWebhook);

describe("registration notifications service", () => {
  const fakeCreatedRegistration: CreatedRegistration = {
    event: {
      id: "event-uuid-1",
      publicId: "evt-pub-1",
      name: "Summit de Tecnologia",
      date: new Date("2026-10-15T14:00:00.000Z"),
      location: "Auditório Central",
      capacity: 100,
    },
    registration: {
      id: "reg-uuid-1",
      participantName: "Ana Silva",
      participantEmail: "ana@example.test",
      participantPhone: "11988887777",
      status: RegistrationStatus.ACTIVE,
      confirmationCode: "CONF-ANA-2026",
      cancellationToken: "cancel-token-123",
      createdAt: new Date(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendRegistrationConfirmationEmail.mockResolvedValue(undefined);
    mockSendTicketEmail.mockResolvedValue({ success: true });
  });

  it("builds the QR code URL encoding the confirmation code", () => {
    const url = buildTicketQrCodeUrl("CONF-123/ABC");
    expect(url).toContain("https://api.qrserver.com/v1/create-qr-code/");
    expect(url).toContain(encodeURIComponent("CONF-123/ABC"));
  });

  it("triggers sendTicketEmail with participant and ticket data including QR code", async () => {
    await notifyRegistrationCreated(fakeCreatedRegistration);

    // Wait for async background promise
    await vi.waitFor(() => {
      expect(mockSendTicketEmail).toHaveBeenCalledOnce();
    });

    const expectedQrCode = buildTicketQrCodeUrl("CONF-ANA-2026");
    expect(mockSendTicketEmail).toHaveBeenCalledWith(
      "ana@example.test",
      "Ana Silva",
      "Summit de Tecnologia",
      "CONF-ANA-2026",
      expectedQrCode,
    );
  });

  it("does not crash if sendTicketEmail fails asynchronously", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendTicketEmail.mockRejectedValueOnce(
      new Error("Resend network failure"),
    );

    await expect(
      notifyRegistrationCreated(fakeCreatedRegistration),
    ).resolves.toBeUndefined();

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });

  it("sends only the waitlist notice, without a ticket, for a waitlisted registration", async () => {
    const waitlisted: CreatedRegistration = {
      ...fakeCreatedRegistration,
      registration: {
        ...fakeCreatedRegistration.registration,
        status: RegistrationStatus.WAITLISTED,
        waitlistPosition: 2,
      },
    };

    await notifyRegistrationCreated(waitlisted);

    expect(mockSendWaitlistEmail).toHaveBeenCalledWith(waitlisted);
    expect(mockSendWebhook).toHaveBeenCalledWith(waitlisted, "registration.waitlisted");
    expect(mockSendRegistrationConfirmationEmail).not.toHaveBeenCalled();
    expect(mockSendTicketEmail).not.toHaveBeenCalled();
  });

  it("sends the ticket and confirmation when a waitlisted registration is promoted", async () => {
    await notifyRegistrationPromoted(fakeCreatedRegistration);

    await vi.waitFor(() => {
      expect(mockSendTicketEmail).toHaveBeenCalledOnce();
    });
    expect(mockSendRegistrationConfirmationEmail).toHaveBeenCalledWith(fakeCreatedRegistration);
    expect(mockSendWebhook).toHaveBeenCalledWith(fakeCreatedRegistration, "registration.promoted");
    expect(mockSendWaitlistEmail).not.toHaveBeenCalled();
  });

  it("keeps the created webhook type for confirmed registrations", async () => {
    await notifyRegistrationCreated(fakeCreatedRegistration);

    expect(mockSendWebhook).toHaveBeenCalledWith(fakeCreatedRegistration, "registration.created");
  });
});
