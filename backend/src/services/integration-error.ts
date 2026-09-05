export type IntegrationErrorCode =
  | "CONFIGURATION_INCOMPLETE"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR";

export class IntegrationError extends Error {
  override readonly name = "IntegrationError";

  constructor(
    public readonly code: IntegrationErrorCode,
    public readonly status?: number,
  ) {
    super(code);
  }
}

export function normalizeIntegrationRequestError(error: unknown): IntegrationError {
  const isTimeout =
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError");

  return new IntegrationError(isTimeout ? "TIMEOUT" : "NETWORK_ERROR");
}

export function safeIntegrationErrorDetails(error: unknown): {
  errorType: string;
  errorCode?: IntegrationErrorCode;
  status?: number;
} {
  if (error instanceof IntegrationError) {
    return {
      errorType: error.name,
      errorCode: error.code,
      ...(error.status === undefined ? {} : { status: error.status }),
    };
  }

  return {
    errorType: error instanceof Error ? error.name : typeof error,
  };
}
