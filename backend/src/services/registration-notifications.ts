import { RegistrationStatus } from "@prisma/client";
import type { CreatedRegistration } from "../domain/registrations.js";
import { safeIntegrationErrorDetails } from "./integration-error.js";
import {
  type RegistrationWebhookType,
  sendRegistrationCreatedWebhook,
} from "./n8n.js";
import {
  sendRegistrationConfirmationEmail,
  sendTicketEmail,
  sendWaitlistEmail,
} from "./resend.js";

type RegistrationIntegration = "resend" | "n8n";

export function buildTicketQrCodeUrl(confirmationCode: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(confirmationCode)}`;
}

async function runIntegrations(
  registrationId: string,
  integrations: Array<{ integration: RegistrationIntegration; run: () => Promise<void> }>,
): Promise<void> {
  const results = await Promise.allSettled(
    integrations.map(({ run }) => Promise.resolve().then(run)),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error({
        integration: integrations[index].integration,
        registrationId,
        ...safeIntegrationErrorDetails(result.reason),
      });
    }
  });
}

async function notifyConfirmedSeat(
  created: CreatedRegistration,
  webhookType: RegistrationWebhookType,
): Promise<void> {
  const qrCodeUrl = buildTicketQrCodeUrl(created.registration.confirmationCode);

  // Disparo assíncrono do e-mail com ingresso e QR Code (não bloqueia a resposta HTTP)
  if (typeof sendTicketEmail === "function") {
    void Promise.resolve()
      .then(() =>
        sendTicketEmail(
          created.registration.participantEmail,
          created.registration.participantName,
          created.event.name,
          created.registration.confirmationCode,
          qrCodeUrl,
        ),
      )
      .catch((error) => {
        console.error({
          integration: "ticket-email",
          registrationId: created.registration.id,
          ...safeIntegrationErrorDetails(error),
        });
      });
  }

  await runIntegrations(created.registration.id, [
    {
      integration: "resend",
      run: () => sendRegistrationConfirmationEmail(created),
    },
    {
      integration: "n8n",
      run: () => sendRegistrationCreatedWebhook(created, webhookType),
    },
  ]);
}

export async function notifyRegistrationCreated(
  created: CreatedRegistration,
): Promise<void> {
  if (created.registration.status === RegistrationStatus.WAITLISTED) {
    // Sem vaga garantida ainda: nada de ingresso, apenas o aviso da fila.
    await runIntegrations(created.registration.id, [
      { integration: "resend", run: () => sendWaitlistEmail(created) },
      {
        integration: "n8n",
        run: () => sendRegistrationCreatedWebhook(created, "registration.waitlisted"),
      },
    ]);
    return;
  }

  await notifyConfirmedSeat(created, "registration.created");
}

export async function notifyRegistrationPromoted(
  created: CreatedRegistration,
): Promise<void> {
  await notifyConfirmedSeat(created, "registration.promoted");
}
