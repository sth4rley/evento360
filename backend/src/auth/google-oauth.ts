import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../errors/http-error.js";

export type GoogleProfile = "organizer" | "participant";

type State = { profile: GoogleProfile; nonce: string; exp: number };
type GoogleUser = { sub: string; email: string; email_verified: boolean; name?: string };
const stateCookie = "evento360_google_oauth";

function sign(value: string) {
  return createHmac("sha256", env.authTokenSecret).update(value).digest("base64url");
}

function encodeState(value: State) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeState(value: string | undefined): State | null {
  if (!value) return null;
  const [payload, signature, ...rest] = value.split(".");
  if (!payload || !signature || rest.length) return null;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<State>;
    return (parsed.profile === "organizer" || parsed.profile === "participant") && typeof parsed.nonce === "string" && parsed.exp && parsed.exp > Date.now() ? parsed as State : null;
  } catch { return null; }
}

function cookie(request: Request, name: string): string | undefined {
  const encoded = request.header("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  try { return encoded ? decodeURIComponent(encoded) : undefined; } catch { return undefined; }
}

function ensureConfigured() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleOAuthRedirectUri) {
    throw new HttpError(503, "GOOGLE_AUTH_UNAVAILABLE", "O login com Google ainda não está configurado.");
  }
}

export function beginGoogleOAuth(profile: GoogleProfile, request: Request, response: Response) {
  ensureConfigured();
  const state = encodeState({ profile, nonce: randomBytes(24).toString("base64url"), exp: Date.now() + 10 * 60_000 });
  response.cookie(stateCookie, state, { httpOnly: true, sameSite: "lax", secure: env.nodeEnv === "production", maxAge: 10 * 60_000, path: "/api" });
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", env.googleClientId!);
  authorization.searchParams.set("redirect_uri", env.googleOAuthRedirectUri!);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", "openid email profile");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("prompt", "select_account");
  response.redirect(302, authorization.toString());
}

export async function googleUserFromCallback(request: Request): Promise<{ profile: GoogleProfile; user: GoogleUser }> {
  ensureConfigured();
  const state = typeof request.query.state === "string" ? request.query.state : undefined;
  const saved = decodeState(cookie(request, stateCookie));
  if (!saved || !state || saved.nonce !== decodeState(state)?.nonce || saved.profile !== decodeState(state)?.profile) throw new HttpError(400, "INVALID_OAUTH_STATE", "Não foi possível validar o retorno do Google.");
  const code = typeof request.query.code === "string" ? request.query.code : "";
  if (!code) throw new HttpError(400, "INVALID_OAUTH_RESPONSE", "O Google não retornou uma autorização válida.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.googleClientId!, client_secret: env.googleClientSecret!, redirect_uri: env.googleOAuthRedirectUri!, grant_type: "authorization_code" }) });
  const token = await tokenResponse.json().catch(() => ({})) as { access_token?: unknown };
  if (!tokenResponse.ok || typeof token.access_token !== "string") throw new HttpError(401, "GOOGLE_AUTH_FAILED", "Não foi possível concluir a autenticação com Google.");
  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
  const user = await userResponse.json().catch(() => ({})) as Partial<GoogleUser>;
  if (!userResponse.ok || typeof user.sub !== "string" || typeof user.email !== "string" || user.email_verified !== true) throw new HttpError(401, "GOOGLE_AUTH_FAILED", "É necessário usar um e-mail Google verificado.");
  return { profile: saved.profile, user: { sub: user.sub, email: user.email.trim().toLowerCase(), email_verified: true, name: typeof user.name === "string" ? user.name : undefined } };
}

export function clearGoogleOAuthState(response: Response) {
  response.clearCookie(stateCookie, { httpOnly: true, sameSite: "lax", secure: env.nodeEnv === "production", path: "/api" });
}
