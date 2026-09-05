import { env } from "../config/env.js";
import type { CreatedRegistration } from "../domain/registrations.js";
import {
  IntegrationError,
  normalizeIntegrationRequestError,
} from "./integration-error.js";

const WEBHOOK_TIMEOUT_MS = 5_000;

export function buildRegistrationCreatedWebhookPayload(
  created: CreatedRegistration,
  occurredAt = new Date(),
) {
  return {
    type: "registration.created",
    occurredAt: occurredAt.toISOString(),
    event: {
      id: created.event.id,
      publicId: created.event.publicId,
      name: created.event.name,
      date: created.event.date.toISOString(),
      location: created.event.location,
      capacity: created.event.capacity,
    },
    registration: {
      id: created.registration.confirmationCode,
      participantName: created.registration.participantName,
      participantEmail: created.registration.participantEmail,
      participantPhone: created.registration.participantPhone,
      status: created.registration.status,
      confirmationCode: created.registration.confirmationCode,
      createdAt: created.registration.createdAt.toISOString(),
    },
  };
}

export async function sendRegistrationCreatedWebhook(
  created: CreatedRegistration,
): Promise<void> {
  const { n8nRegistrationWebhookUrl, n8nWebhookSecret } = env;

  if (!n8nRegistrationWebhookUrl && !n8nWebhookSecret) {
    return;
  }

  if (!n8nRegistrationWebhookUrl || !n8nWebhookSecret) {
    throw new IntegrationError("CONFIGURATION_INCOMPLETE");
  }

  let response: Response;

  try {
    response = await fetch(n8nRegistrationWebhookUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-Evento360-Webhook-Secret": n8nWebhookSecret,
      },
      body: JSON.stringify(buildRegistrationCreatedWebhookPayload(created)),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
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
