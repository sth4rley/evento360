import { prisma } from "../lib/prisma.js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "re_placeholder");

export async function sendOrganizerEventSummary(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { organizer: true },
  });

  if (!event) {
    throw new Error("Event not found");
  }

  if (event.organizerReportSentAt) {
    return; // Abort if already sent
  }

  const registrations = await prisma.registration.findMany({
    where: { eventId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  const escapeCsv = (str: string | null | undefined) => {
    if (!str) return '""';
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const header = "Nome,E-mail,Telefone,Código,Data de Inscrição\n";
  const rows = registrations.map((reg) => {
    return [
      escapeCsv(reg.participantName),
      escapeCsv(reg.participantEmail),
      escapeCsv(reg.participantPhone),
      escapeCsv(reg.confirmationCode),
      escapeCsv(reg.createdAt.toISOString()),
    ].join(",");
  });

  const csvContent = "\uFEFF" + header + rows.join("\n");
  const csvBuffer = Buffer.from(csvContent, "utf-8");

  const totalRegistrations = registrations.length;

  const html = `
    <h2>Relatório de Inscrições: ${event.name}</h2>
    <p>Olá,</p>
    <p>As inscrições para o evento <strong>${event.name}</strong> foram encerradas.</p>
    <p>Total de inscritos ativos: <strong>${totalRegistrations}</strong></p>
    <p>Em anexo, enviamos a lista completa de participantes no formato CSV.</p>
    <br/>
    <p>Atenciosamente,<br/>Equipe Evento360</p>
  `;

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "ingressos@seuevento.com.br",
    to: event.organizer.email,
    subject: `Relatório Final de Participantes: ${event.name}`,
    html: html,
    attachments: [
      {
        filename: `participantes-${event.publicId}.csv`,
        content: csvBuffer,
      },
    ],
  });

  await prisma.event.update({
    where: { id: eventId },
    data: { organizerReportSentAt: new Date() },
  });
}

export async function checkAndSendClosedEventReports(): Promise<void> {
  const now = new Date();
  
  const events = await prisma.event.findMany({
    where: {
      registrationDeadline: { lte: now },
      organizerReportSentAt: null,
      status: "PUBLISHED",
    },
    select: { id: true },
  });

  for (const event of events) {
    try {
      await sendOrganizerEventSummary(event.id);
    } catch (error) {
      console.error(`Failed to send report for event ${event.id}`, error);
    }
  }
}
