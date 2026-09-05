import { createHash, randomBytes } from "node:crypto";

const passwordResetLifetimeMs = 30 * 60 * 1000;

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createPasswordResetCredentials(now = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(now.getTime() + passwordResetLifetimeMs),
  };
}
