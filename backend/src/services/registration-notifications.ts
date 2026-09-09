import type { CreatedRegistration } from "../domain/registrations.js";
import { safeIntegrationErrorDetails } from "./integration-error.js";
import { sendRegistrationCreatedWebhook } from "./n8n.js";
import {
  sendRegistrationConfirmationEmail,
  sendTicketEmail,
} from "./resend.js";

type RegistrationIntegration = "resend" | "n8n";

export function buildTicketQrCodeUrl(confirmationCode: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(confirmationCode)}`;
}

export async function notifyRegistrationCreated(
  created: CreatedRegistration,
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

  const integrations: Array<{
    integration: RegistrationIntegration;
    run: () => Promise<void>;
  }> = [
    {
      integration: "resend",
      run: () => sendRegistrationConfirmationEmail(created),
    },
    {
      integration: "n8n",
      run: () => sendRegistrationCreatedWebhook(created),
    },
  ];
  const results = await Promise.allSettled(
    integrations.map(({ run }) => Promise.resolve().then(run)),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error({
        integration: integrations[index].integration,
        registrationId: created.registration.id,
        ...safeIntegrationErrorDetails(result.reason),
      });
    }
  });
}
