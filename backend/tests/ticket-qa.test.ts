import { describe, expect, it } from "vitest";
import { buildTicketEmailHtml } from "../src/services/resend.js";
import { buildTicketQrCodeUrl } from "../src/services/registration-notifications.js";

describe("Task 5: QA Homologation — Ticket Email & QR Code", () => {
  const sampleTicket = {
    participantName: "Carlos Augusto QA",
    eventName: "Congresso Nacional Evento360",
    ticketCode: "EV360-998877-QA",
  };

  it("generates a QR code URL whose payload matches the database confirmation code exactly", () => {
    const qrCodeUrl = buildTicketQrCodeUrl(sampleTicket.ticketCode);
    const parsedUrl = new URL(qrCodeUrl);

    expect(parsedUrl.protocol).toBe("https:");
    expect(parsedUrl.searchParams.get("data")).toBe(sampleTicket.ticketCode);
  });

  it("renders a responsive HTML email that adheres to email client compatibility guidelines", () => {
    const qrCodeUrl = buildTicketQrCodeUrl(sampleTicket.ticketCode);
    const html = buildTicketEmailHtml(
      sampleTicket.participantName,
      sampleTicket.eventName,
      sampleTicket.ticketCode,
      qrCodeUrl,
    );

    // Verificações essenciais de integridade dos dados
    expect(html).toContain(sampleTicket.participantName);
    expect(html).toContain(sampleTicket.eventName);
    expect(html).toContain(sampleTicket.ticketCode);

    // Validação da tag de imagem do QR Code
    expect(html).toMatch(
      new RegExp(
        `<img[^>]*src="${qrCodeUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`,
      ),
    );

    // Validações de compatibilidade para Gmail, Outlook e clientes móveis
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width: 600px");
    expect(html).toContain("chatbot");
  });
});
