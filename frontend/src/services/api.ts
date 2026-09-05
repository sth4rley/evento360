const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type AuthScope = "organizer" | "participant";

const tokenKeys: Record<AuthScope, string> = {
  organizer: "evento360.accessToken",
  participant: "evento360.participantToken",
};
const lastScopeKey = "evento360.lastAuthScope";

export const sessionExpiredEvent = "evento360:session-expired";

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getApiUrl(path: string): string {
  return `${apiUrl}${path}`;
}

export function getAccessToken(scope: AuthScope = "organizer"): string | null {
  return localStorage.getItem(tokenKeys[scope]);
}

export function setAccessToken(
  token: string,
  scope: AuthScope = "organizer",
): void {
  localStorage.setItem(tokenKeys[scope], token);
  localStorage.setItem(lastScopeKey, scope);
}

export function clearAccessToken(scope: AuthScope = "organizer"): void {
  localStorage.removeItem(tokenKeys[scope]);
  if (localStorage.getItem(lastScopeKey) === scope) {
    const remainingScope: AuthScope | null =
      scope === "organizer" && localStorage.getItem(tokenKeys.participant)
        ? "participant"
        : scope === "participant" && localStorage.getItem(tokenKeys.organizer)
          ? "organizer"
          : null;
    if (remainingScope) localStorage.setItem(lastScopeKey, remainingScope);
    else localStorage.removeItem(lastScopeKey);
  }
}

export function getPreferredAuthScope(): AuthScope | null {
  const preferred = localStorage.getItem(lastScopeKey);
  if (
    (preferred === "organizer" || preferred === "participant") &&
    getAccessToken(preferred)
  ) {
    return preferred;
  }
  if (getAccessToken("participant")) return "participant";
  if (getAccessToken("organizer")) return "organizer";
  return null;
}

export type ApiRequestOptions = RequestInit & {
  auth?: AuthScope;
  skipAuth?: boolean;
};

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { auth, skipAuth = false, ...requestOptions } = options;
  const scope = skipAuth ? undefined : auth;
  const token = scope ? getAccessToken(scope) : null;
  const headers = new Headers(requestOptions.headers);

  if (requestOptions.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(getApiUrl(path), { ...requestOptions, headers });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;

  if (!response.ok) {
    if (response.status === 401 && token && scope && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(sessionExpiredEvent, { detail: { scope } }),
      );
    }
    throw new ApiError(
      response.status,
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? "Não foi possível concluir a solicitação.",
    );
  }

  return payload;
}
