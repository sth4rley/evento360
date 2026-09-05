import "dotenv/config";

const port = Number(process.env.PORT ?? 3000);
const authTokenSecret = process.env.AUTH_TOKEN_SECRET;
const nodeEnv = process.env.NODE_ENV ?? "development";

if (!["development", "test", "production"].includes(nodeEnv)) {
  throw new Error("NODE_ENV must be development, test or production");
}

function applicationUrl(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || (nodeEnv === "production" ? "" : fallback);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid application URL`); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || (nodeEnv === "production" && url.protocol !== "https:")) {
    throw new Error(`${name} must be an HTTP(S) origin, with HTTPS in production`);
  }
  return url.origin;
}

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

const webhookUrl = optionalEnvironmentValue("N8N_REGISTRATION_WEBHOOK_URL");
if (webhookUrl) {
  let url: URL;
  try { url = new URL(webhookUrl); } catch { throw new Error("N8N_REGISTRATION_WEBHOOK_URL must be a valid URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || (nodeEnv === "production" && url.protocol !== "https:")) {
    throw new Error("N8N_REGISTRATION_WEBHOOK_URL must use HTTP(S), with HTTPS in production and no embedded credentials");
  }
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

if (!authTokenSecret || authTokenSecret.trim().length < 32 || /replace-with|change-me|example|test-auth-token-secret/i.test(authTokenSecret) && nodeEnv !== "test") {
  throw new Error("AUTH_TOKEN_SECRET must contain at least 32 characters and must not be an example value");
}

export const env = {
  port,
  frontendUrl: applicationUrl("FRONTEND_URL", "http://localhost:5173"),
  publicAppUrl: applicationUrl("PUBLIC_APP_URL", "http://localhost:5173"),
  nodeEnv,
  authTokenSecret,
  resendApiKey: optionalEnvironmentValue("RESEND_API_KEY"),
  resendFromEmail: optionalEnvironmentValue("RESEND_FROM_EMAIL"),
  n8nRegistrationWebhookUrl: webhookUrl,
  n8nWebhookSecret: optionalEnvironmentValue("N8N_WEBHOOK_SECRET"),
};
