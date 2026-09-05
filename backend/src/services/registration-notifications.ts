import type { CreatedRegistration } from "../domain/registrations.js";
import { safeIntegrationErrorDetails } from "./integration-error.js";
import { sendRegistrationCreatedWebhook } from "./n8n.js";
import { sendRegistrationConfirmationEmail } from "./resend.js";

type RegistrationIntegration = "resend" | "n8n";

export async function notifyRegistrationCreated(
  created: CreatedRegistration,
): Promise<void> {
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
