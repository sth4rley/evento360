export type UserRole = "ORGANIZER" | "PARTICIPANT";
export type AccountProfile = "organizer" | "participant";

export type RouteId =
  | "home"
  | "role-selection"
  | "organizer-login"
  | "participant-login"
  | "signup"
  | "forgot-password"
  | "reset-password"
  | "event-lookup"
  | "public-event"
  | "event-registration"
  | "registration-confirmation"
  | "registration-cancellation"
  | "participant-events"
  | "admin-events"
  | "admin-participants"
  | "admin-checkin"
  | "admin-event-new"
  | "admin-event"
  | "admin-event-edit"
  | "admin-event-participants"
  | "admin-event-checkin"
  | "not-found";

export type RouteAccess = "public" | UserRole;

export type RouteMatch = {
  id: RouteId;
  access: RouteAccess;
  params: Record<string, string>;
};

export type AccessDecision = "allowed" | "unauthenticated" | "forbidden";

export const paths = {
  home: "/",
  login: "/login",
  organizerLogin: "/login/organizer",
  participantLogin: "/login/participant",
  signup: "/signup",
  eventLookup: "/find-registration",
  participantEvents: "/my-events",
  adminEvents: "/admin/events",
  adminParticipants: "/admin/participants",
  adminCheckIn: "/admin/check-in",
  forgotPassword: (profile: AccountProfile) => `/forgot-password/${profile}`,
  resetPassword: (profile: AccountProfile, token: string) =>
    `/reset-password/${profile}/${encodeURIComponent(token)}`,
} as const;

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function matched(
  id: RouteId,
  access: RouteAccess,
  params: Record<string, string> = {},
): RouteMatch {
  return { id, access, params };
}

export function matchRoute(pathname: string): RouteMatch {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  if (path === "/" || path === "/events" || path === "/evento360_publico") {
    return matched("home", "public");
  }
  if (path === "/login" || path === "/escolher-perfil") {
    return matched("role-selection", "public");
  }
  if (path === "/login/organizer") return matched("organizer-login", "public");
  if (path === "/login/participant") return matched("participant-login", "public");
  if (path === "/signup" || path === "/cadastro") {
    return matched("signup", "public");
  }
  if (
    path === "/find-registration" ||
    path === "/consultar-inscricao" ||
    path === "/find-event" ||
    path === "/buscar-evento"
  ) {
    return matched("event-lookup", "public");
  }
  if (
    path === "/my-events" ||
    path === "/account" ||
    path === "/minhas-inscricoes" ||
    path === "/participante/eventos"
  ) {
    return matched("participant-events", "PARTICIPANT");
  }

  let result = path.match(/^\/forgot-password\/(organizer|participant)$/);
  if (result) {
    return matched("forgot-password", "public", { profile: result[1] });
  }

  result = path.match(
    /^\/reset-password\/(organizer|participant)\/([^/]+)$/,
  );
  if (result) {
    return matched("reset-password", "public", {
      profile: result[1],
      token: decoded(result[2]),
    });
  }

  result = path.match(/^\/event\/([^/]+)\/register$/);
  if (result) {
    return matched("event-registration", "public", {
      publicId: decoded(result[1]),
    });
  }

  result = path.match(/^\/event\/([^/]+)$/);
  if (result) {
    return matched("public-event", "public", { publicId: decoded(result[1]) });
  }

  result = path.match(/^\/registration\/cancel\/([^/]+)$/);
  if (result) {
    return matched("registration-cancellation", "public", {
      token: decoded(result[1]),
    });
  }

  result = path.match(/^\/registration\/([^/]+)$/);
  if (result) {
    return matched("registration-confirmation", "public", {
      code: decoded(result[1]),
    });
  }

  if (path === "/admin/events") return matched("admin-events", "ORGANIZER");
  if (path === "/admin/participants") {
    return matched("admin-participants", "ORGANIZER");
  }
  if (path === "/admin/check-in") {
    return matched("admin-checkin", "ORGANIZER");
  }
  if (path === "/admin/events/new") {
    return matched("admin-event-new", "ORGANIZER");
  }

  result = path.match(/^\/admin\/events\/([^/]+)\/edit$/);
  if (result) {
    return matched("admin-event-edit", "ORGANIZER", {
      eventId: decoded(result[1]),
    });
  }

  result = path.match(/^\/admin\/events\/([^/]+)\/participants$/);
  if (result) {
    return matched("admin-event-participants", "ORGANIZER", {
      eventId: decoded(result[1]),
    });
  }

  result = path.match(/^\/admin\/events\/([^/]+)\/check-in$/);
  if (result) {
    return matched("admin-event-checkin", "ORGANIZER", {
      eventId: decoded(result[1]),
    });
  }

  result = path.match(/^\/admin\/events\/([^/]+)$/);
  if (result) {
    return matched("admin-event", "ORGANIZER", {
      eventId: decoded(result[1]),
    });
  }

  return matched("not-found", "public");
}

export function accessDecision(
  route: RouteMatch,
  activeRoles: readonly UserRole[],
): AccessDecision {
  if (route.access === "public") return "allowed";
  if (activeRoles.includes(route.access)) return "allowed";
  return activeRoles.length === 0 ? "unauthenticated" : "forbidden";
}

export function navigate(
  path: string,
  options: { replace?: boolean } = {},
): void {
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
