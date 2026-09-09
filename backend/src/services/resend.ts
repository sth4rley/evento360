import { Resend } from "resend";
import { env } from "../config/env.js";
import type { CreatedRegistration } from "../domain/registrations.js";
import {
  IntegrationError,
  normalizeIntegrationRequestError,
} from "./integration-error.js";

const resend = new Resend(process.env.RESEND_API_KEY || "re_placeholder");
export { resend };

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 5_000;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function registrationUrl(
  publicAppUrl: string,
  path: string,
  value: string,
): string {
  const baseUrl = publicAppUrl.replace(/\/+$/, "");
  return `${baseUrl}/${path}/${encodeURIComponent(value)}`;
}

export function buildRegistrationConfirmationEmail(
  created: CreatedRegistration,
  publicAppUrl = env.publicAppUrl,
): { subject: string; html: string } {
  const { event, registration } = created;
  const confirmationUrl = registrationUrl(
    publicAppUrl,
    "registration",
    registration.confirmationCode,
  );
  const cancellationUrl = registrationUrl(
    publicAppUrl,
    "registration/cancel",
    registration.cancellationToken,
  );
  const formattedDate = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(event.date);

  return {
    subject: `Inscrição confirmada — ${event.name}`,
    html: `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { margin: 0; padding: 0; background: #f3f4f6; color: #172033; font-family: Arial, sans-serif; }
      .shell { width: 100%; padding: 32px 12px; }
      .card { width: 100%; max-width: 600px; margin: 0 auto; overflow: hidden; border-radius: 18px; background: #ffffff; box-shadow: 0 8px 30px rgba(23, 32, 51, 0.08); }
      .header { padding: 32px; background: #172554; color: #ffffff; }
      .brand { margin: 0 0 18px; font-size: 18px; font-weight: 700; letter-spacing: 0.03em; }
      .header h1 { margin: 0; font-size: 28px; line-height: 1.25; }
      .content { padding: 32px; }
      .content p { margin: 0 0 20px; line-height: 1.6; }
      .status { display: inline-block; margin-bottom: 24px; border-radius: 999px; padding: 8px 14px; background: #dcfce7; color: #166534; font-size: 13px; font-weight: 700; text-transform: uppercase; }
      .details { margin: 0 0 28px; padding: 0; list-style: none; border: 1px solid #e5e7eb; border-radius: 12px; }
      .details li { padding: 14px 18px; border-bottom: 1px solid #e5e7eb; line-height: 1.45; }
      .details li:last-child { border-bottom: 0; }
      .label { display: block; margin-bottom: 3px; color: #64748b; font-size: 12px; font-weight: 700; text-transform: uppercase; }
      .code { font-family: Consolas, Monaco, monospace; font-size: 18px; font-weight: 700; letter-spacing: 0.08em; }
      .button { display: inline-block; border-radius: 10px; padding: 14px 22px; background: #2563eb; color: #ffffff !important; font-weight: 700; text-decoration: none; }
      .secondary { margin-top: 18px; }
      .secondary a { color: #475569; font-size: 13px; }
      .footer { padding: 22px 32px; background: #f8fafc; color: #64748b; font-size: 12px; line-height: 1.5; }
      @media only screen and (max-width: 620px) {
        .shell { padding: 0; }
        .card { border-radius: 0; }
        .header, .content, .footer { padding: 24px 20px; }
        .button { display: block; text-align: center; }
      }
    </style>
  </head>
  <body>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="shell">
      <tr>
        <td>
          <div class="card">
            <div class="header">
              <p class="brand">Evento360</p>
              <h1>Sua inscrição está confirmada</h1>
            </div>
            <div class="content">
              <span class="status">Confirmada</span>
              <p>Olá, <strong>${escapeHtml(registration.participantName)}</strong>! Sua vaga foi reservada com sucesso.</p>
              <ul class="details">
                <li><span class="label">Evento</span>${escapeHtml(event.name)}</li>
                <li><span class="label">Data</span><time datetime="${escapeHtml(event.date.toISOString())}">${escapeHtml(formattedDate)}</time></li>
                <li><span class="label">Local</span>${escapeHtml(event.location)}</li>
                <li><span class="label">Código de confirmação</span><span class="code">${escapeHtml(registration.confirmationCode)}</span></li>
              </ul>
              <a class="button" href="${escapeHtml(confirmationUrl)}">Ver minha inscrição</a>
              <p class="secondary">Não poderá participar? <a href="${escapeHtml(cancellationUrl)}">Cancelar inscrição</a></p>
            </div>
            <div class="footer">Guarde este e-mail para consultar os dados da sua inscrição.</div>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export async function sendRegistrationConfirmationEmail(
  created: CreatedRegistration,
): Promise<void> {
  const { resendApiKey, resendFromEmail } = env;

  if (!resendApiKey && !resendFromEmail) {
    return;
  }

  if (!resendApiKey || !resendFromEmail) {
    throw new IntegrationError("CONFIGURATION_INCOMPLETE");
  }

  const email = buildRegistrationConfirmationEmail(created);
  let response: Response;

  try {
    response = await fetch(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: created.registration.participantEmail,
        subject: email.subject,
        html: email.html,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (error) {
    throw normalizeIntegrationRequestError(error);
  }

  try {
    await response.body?.cancel();
  } catch {
    // The delivery result is determined by the HTTP status, not by body disposal.
  }

  if (!response.ok) {
    throw new IntegrationError("HTTP_ERROR", response.status);
  }
}

export interface SendTicketEmailParams {
  to: string;
  participantName: string;
  eventName: string;
  ticketCode: string;
  qrCode: string;
}

export type SendTicketEmailResult = {
  success: boolean;
  data?: unknown;
  error?: unknown;
};

export function buildTicketEmailHtml(
  participantName: string,
  eventName: string,
  ticketCode: string,
  qrCode: string,
): string {
  const safeParticipantName = escapeHtml(participantName);
  const safeEventName = escapeHtml(eventName);
  const safeTicketCode = escapeHtml(ticketCode);

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Seu ingresso — ${safeEventName}</title>
    <style>
      body { margin: 0; padding: 0; background: #f3f4f6; color: #172033; font-family: Arial, sans-serif; }
      .shell { width: 100%; padding: 32px 12px; }
      .card { width: 100%; max-width: 600px; margin: 0 auto; overflow: hidden; border-radius: 18px; background: #ffffff; box-shadow: 0 8px 30px rgba(23, 32, 51, 0.08); }
      .header { padding: 32px; background: #172554; color: #ffffff; text-align: center; }
      .brand { margin: 0 0 12px; font-size: 16px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #93c5fd; }
      .header h1 { margin: 0; font-size: 26px; line-height: 1.3; }
      .content { padding: 32px; }
      .greeting { margin: 0 0 16px; font-size: 16px; line-height: 1.5; }
      .ticket-box { margin: 24px 0; padding: 24px; border: 2px dashed #93c5fd; border-radius: 14px; background: #eff6ff; text-align: center; }
      .ticket-label { margin: 0 0 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #1e40af; }
      .ticket-code { margin: 0 0 20px; font-family: Consolas, Monaco, monospace; font-size: 24px; font-weight: 700; letter-spacing: 0.1em; color: #1e3a8a; }
      .qr-container { display: inline-block; padding: 12px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
      .qr-code-img { display: block; max-width: 220px; width: 100%; height: auto; margin: 0 auto; }
      .instructions { margin: 20px 0 0; font-size: 14px; color: #475569; line-height: 1.5; }
      .footer { padding: 20px 32px; background: #f8fafc; color: #64748b; font-size: 12px; text-align: center; border-top: 1px solid #e2e8f0; }
    </style>
  </head>
  <body>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="shell">
      <tr>
        <td align="center">
          <div class="card">
            <div class="header">
              <p class="brand">Evento360</p>
              <h1>${safeEventName}</h1>
            </div>
            <div class="content">
              <p class="greeting">Olá, <strong>${safeParticipantName}</strong>! Aqui está o seu ingresso confirmado para o evento.</p>
              <div class="ticket-box">
                <p class="ticket-label">Código do Ingresso</p>
                <div class="ticket-code">${safeTicketCode}</div>
                <div class="qr-container">
                  <img src="${qrCode}" alt="QR Code do Ingresso" class="qr-code-img" />
                </div>
                <p class="instructions">Apresente este QR Code no credenciamento ou envie no chatbot para validar seu acesso.</p>
              </div>
            </div>
            <div class="footer">
              Guarde este e-mail. Ele é seu comprovante oficial de entrada.
            </div>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendTicketEmail(
  to: string,
  participantName: string,
  eventName: string,
  ticketCode: string,
  qrCode: string,
): Promise<SendTicketEmailResult>;
export async function sendTicketEmail(
  params: SendTicketEmailParams,
): Promise<SendTicketEmailResult>;
export async function sendTicketEmail(
  toOrParams: string | SendTicketEmailParams,
  participantName?: string,
  eventName?: string,
  ticketCode?: string,
  qrCode?: string,
): Promise<SendTicketEmailResult> {
  let to: string;
  let name: string;
  let event: string;
  let code: string;
  let qr: string;

  if (typeof toOrParams === "object" && toOrParams !== null) {
    to = toOrParams.to;
    name = toOrParams.participantName;
    event = toOrParams.eventName;
    code = toOrParams.ticketCode;
    qr = toOrParams.qrCode;
  } else {
    to = toOrParams;
    name = participantName ?? "";
    event = eventName ?? "";
    code = ticketCode ?? "";
    qr = qrCode ?? "";
  }

  const html = buildTicketEmailHtml(name, event, code, qr);
  const from =
    process.env.RESEND_FROM_EMAIL ||
    env.resendFromEmail ||
    "ingressos@seuevento.com.br";

  try {
    const response = await resend.emails.send({
      from,
      to,
      subject: `Seu ingresso para ${event} — ${code}`,
      html,
    });

    if (response.error) {
      console.error(
        "Falha na API do Resend ao enviar ingresso:",
        response.error,
      );
      return { success: false, error: response.error };
    }

    return { success: true, data: response.data };
  } catch (error) {
    console.error("Erro ao enviar e-mail com Resend:", error);
    return { success: false, error };
  }
}
