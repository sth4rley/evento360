import { env } from "../config/env.js";
import {
  IntegrationError,
  normalizeIntegrationRequestError,
} from "./integration-error.js";

const resendEmailsEndpoint = "https://api.resend.com/emails";
const resendTimeoutMs = 5_000;

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

export function buildPasswordResetUrl(
  token: string,
  profile: "organizer" | "participant",
  publicAppUrl = env.publicAppUrl,
): string {
  const baseUrl = publicAppUrl.replace(/\/+$/, "");
  return `${baseUrl}/reset-password/${profile}/${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail(input: {
  email: string;
  name: string;
  token: string;
  profile: "organizer" | "participant";
}): Promise<void> {
  const { resendApiKey, resendFromEmail } = env;
  if (!resendApiKey && !resendFromEmail) {
    return;
  }
  if (!resendApiKey || !resendFromEmail) {
    throw new IntegrationError("CONFIGURATION_INCOMPLETE");
  }

  const resetUrl = buildPasswordResetUrl(input.token, input.profile);
  let response: Response;
  try {
    response = await fetch(resendEmailsEndpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: input.email,
        subject: "Redefinição de senha — Evento360",
        html: `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:32px"><main style="max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:32px"><h1 style="color:#0b3b60">Redefina sua senha</h1><p>Olá, ${escapeHtml(input.name)}.</p><p>Recebemos uma solicitação para redefinir a senha da sua conta Evento360. O link expira em 30 minutos.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">Criar nova senha</a></p><p>Se você não solicitou a alteração, ignore este e-mail.</p></main></body></html>`,
      }),
      signal: AbortSignal.timeout(resendTimeoutMs),
    });
  } catch (error) {
    throw normalizeIntegrationRequestError(error);
  }

  try {
    await response.body?.cancel();
  } catch {
    // The status code is authoritative for this best-effort notification.
  }

  if (!response.ok) {
    throw new IntegrationError("HTTP_ERROR", response.status);
  }
}
