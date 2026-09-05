import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { isAuthRole, type AuthRole, type AuthSession } from "./types.js";

type TokenPayload = {
  sub: string;
  role: AuthRole;
  ver: number;
  exp: number;
};

const tokenLifetimeSeconds = 60 * 60 * 12;

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", env.authTokenSecret)
    .update(encodedPayload)
    .digest("base64url");
}

export function createAccessToken(
  accountId: string,
  role: AuthRole = "ORGANIZER",
  sessionVersion = 0,
): string {
  const payload: TokenPayload = {
    sub: accountId,
    role,
    ver: sessionVersion,
    exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds,
  };
  const encodedPayload = encode(JSON.stringify(payload));

  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyAccessToken(token: string): AuthSession | null {
  const [encodedPayload, receivedSignature, ...rest] = token.split(".");

  if (!encodedPayload || !receivedSignature || rest.length > 0) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<TokenPayload>;

    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      !isAuthRole(payload.role) ||
      typeof payload.ver !== "number" ||
      !Number.isInteger(payload.ver) ||
      payload.ver < 0 ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      accountId: payload.sub,
      role: payload.role,
      sessionVersion: payload.ver,
    };
  } catch {
    return null;
  }
}
