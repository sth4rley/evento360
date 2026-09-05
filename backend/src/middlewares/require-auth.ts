import type { RequestHandler } from "express";
import { findAccountBySession } from "../auth/accounts.js";
import { verifyAccessToken } from "../auth/token.js";
import type { AuthRole } from "../auth/types.js";
import { HttpError } from "../errors/http-error.js";

function sessionFromAuthorization(authorization: string | undefined) {
  const [scheme, token, ...rest] = authorization?.split(" ") ?? [];
  return scheme === "Bearer" && token && rest.length === 0
    ? verifyAccessToken(token)
    : null;
}

export const requireAuth: RequestHandler = async (request, _response, next) => {
  const session = sessionFromAuthorization(request.header("authorization"));

  if (!session) {
    next(
      new HttpError(401, "AUTHENTICATION_REQUIRED", "Autenticação necessária"),
    );
    return;
  }

  try {
    const account = await findAccountBySession(session);
    if (!account) {
      next(
        new HttpError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Sessão inválida ou expirada",
        ),
      );
      return;
    }

    request.auth = session;
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuth: RequestHandler = async (request, _response, next) => {
  const authorization = request.header("authorization");

  if (!authorization) {
    next();
    return;
  }

  const session = sessionFromAuthorization(authorization);
  if (!session) {
    next(new HttpError(401, "AUTHENTICATION_REQUIRED", "Sessão inválida ou expirada"));
    return;
  }

  try {
    const account = await findAccountBySession(session);
    if (!account) {
      next(
        new HttpError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Sessão inválida ou expirada",
        ),
      );
      return;
    }

    request.auth = session;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRole(role: AuthRole): RequestHandler[] {
  const authorize: RequestHandler = (request, _response, next) => {
    if (request.auth?.role !== role) {
      next(new HttpError(403, "FORBIDDEN", "Este perfil não pode acessar esta área"));
      return;
    }

    next();
  };

  return [requireAuth, authorize];
}

export const requireOrganizerAuth = requireRole("ORGANIZER");
export const requireParticipantAuth = requireRole("PARTICIPANT");

const allowGuestOrParticipant: RequestHandler = (request, _response, next) => {
  if (request.auth && request.auth.role !== "PARTICIPANT") {
    next(new HttpError(403, "FORBIDDEN", "Este perfil não pode realizar a inscrição"));
    return;
  }
  next();
};

export const optionalParticipantAuth = [optionalAuth, allowGuestOrParticipant];
