import { randomBytes, randomInt } from "node:crypto";

export function generateConfirmationCode(): string {
  return randomInt(10_000_000, 100_000_000).toString();
}

export function generateCancellationToken(): string {
  return randomBytes(32).toString("hex");
}
