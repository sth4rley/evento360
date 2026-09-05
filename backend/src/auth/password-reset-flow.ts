import { hashPassword } from "./password.js";
import {
  createPasswordResetCredentials,
  hashPasswordResetToken,
} from "./password-reset.js";
import {
  findOrganizerByIdentifier,
  findParticipantByIdentifier,
} from "./accounts.js";
import { HttpError } from "../errors/http-error.js";
import { prisma } from "../lib/prisma.js";
import { safeIntegrationErrorDetails } from "../services/integration-error.js";
import { sendPasswordResetEmail } from "../services/password-reset-email.js";

export type PasswordResetProfile = "organizer" | "participant";

export const genericRecoveryResponse = {
  message:
    "Se a conta existir, enviaremos as instruções de recuperação para o e-mail cadastrado.",
};

export async function requestPasswordReset(
  profile: PasswordResetProfile,
  identifier: unknown,
): Promise<void> {
  const account =
    profile === "organizer"
      ? await findOrganizerByIdentifier(identifier)
      : await findParticipantByIdentifier(identifier);

  if (!account) {
    return;
  }

  const reset = createPasswordResetCredentials();
  if (profile === "organizer") {
    await prisma.organizer.update({
      where: { id: account.id },
      data: {
        passwordResetTokenHash: reset.tokenHash,
        passwordResetExpiresAt: reset.expiresAt,
      },
    });
  } else {
    await prisma.participant.update({
      where: { id: account.id },
      data: {
        passwordResetTokenHash: reset.tokenHash,
        passwordResetExpiresAt: reset.expiresAt,
      },
    });
  }

  try {
    await sendPasswordResetEmail({
      email: account.email,
      name:
        profile === "participant" &&
        "name" in account &&
        typeof account.name === "string"
          ? account.name
          : account.username ?? account.email.split("@")[0],
      token: reset.token,
      profile,
    });
  } catch (error) {
    console.error({
      integration: "resend-password-reset",
      accountProfile: profile,
      ...safeIntegrationErrorDetails(error),
    });
  }
}

export async function resetPassword(
  profile: PasswordResetProfile,
  token: string,
  newPassword: string,
): Promise<void> {
  const tokenHash = hashPasswordResetToken(token);
  const now = new Date();
  const passwordHash = await hashPassword(newPassword);
  const update =
    profile === "organizer"
      ? await prisma.organizer.updateMany({
          where: {
            passwordResetTokenHash: tokenHash,
            passwordResetExpiresAt: { gt: now },
          },
          data: {
            passwordHash,
            passwordResetTokenHash: null,
            passwordResetExpiresAt: null,
            sessionVersion: { increment: 1 },
          },
        })
      : await prisma.participant.updateMany({
          where: {
            passwordResetTokenHash: tokenHash,
            passwordResetExpiresAt: { gt: now },
          },
          data: {
            passwordHash,
            passwordResetTokenHash: null,
            passwordResetExpiresAt: null,
            sessionVersion: { increment: 1 },
          },
        });

  if (update.count !== 1) {
    throw new HttpError(
      400,
      "INVALID_RESET_TOKEN",
      "Token de recuperação inválido ou expirado",
    );
  }
}
