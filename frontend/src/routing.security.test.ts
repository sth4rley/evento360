import { describe, expect, it } from "vitest";
import { accessDecision, matchRoute } from "./routing";

describe("route matching", () => {
  it.each(["/", "/events", "/evento360_publico", "/events/"])(
    "keeps the public event catalog available at %s",
    (pathname) => {
      expect(matchRoute(pathname)).toEqual({
        id: "home",
        access: "public",
        params: {},
      });
    },
  );

  it("matches public lookup, account and password recovery pages", () => {
    expect(matchRoute("/find-registration").access).toBe("public");
    expect(matchRoute("/find-event").id).toBe("event-lookup");
    expect(matchRoute("/signup").access).toBe("public");
    expect(matchRoute("/forgot-password/participant")).toMatchObject({
      id: "forgot-password",
      params: { profile: "participant" },
    });
    expect(matchRoute("/reset-password/organizer/reset-token")).toMatchObject({
      id: "reset-password",
      access: "public",
      params: { profile: "organizer", token: "reset-token" },
    });
  });

  it("extracts dynamic identifiers without confusing private event routes", () => {
    expect(matchRoute("/event/public-id/register")).toMatchObject({
      id: "event-registration",
      params: { publicId: "public-id" },
    });
    expect(matchRoute("/admin/events/event-id/participants")).toMatchObject({
      id: "admin-event-participants",
      access: "ORGANIZER",
      params: { eventId: "event-id" },
    });
    expect(matchRoute("/admin/events/event-id/check-in")).toMatchObject({
      id: "admin-event-checkin",
      access: "ORGANIZER",
      params: { eventId: "event-id" },
    });
    expect(matchRoute("/admin/participants")).toMatchObject({
      id: "admin-participants",
      access: "ORGANIZER",
    });
    expect(matchRoute("/admin/check-in")).toMatchObject({
      id: "admin-checkin",
      access: "ORGANIZER",
    });
  });

  it("returns an explicit not-found route instead of a private dashboard", () => {
    expect(matchRoute("/rota-inexistente")).toEqual({
      id: "not-found",
      access: "public",
      params: {},
    });
  });
});

describe("route authorization", () => {
  const adminRoute = matchRoute("/admin/events");
  const participantRoute = matchRoute("/minhas-inscricoes");
  const roleSelection = matchRoute("/login");

  it("redirects unauthenticated visitors away from every private area", () => {
    expect(accessDecision(adminRoute, [])).toBe("unauthenticated");
    expect(accessDecision(participantRoute, [])).toBe("unauthenticated");
    expect(accessDecision(roleSelection, [])).toBe("allowed");
  });

  it("does not let a participant enter organizer routes", () => {
    expect(accessDecision(adminRoute, ["PARTICIPANT"])).toBe("forbidden");
    expect(accessDecision(participantRoute, ["PARTICIPANT"])).toBe("allowed");
  });

  it("does not let an organizer enter participant routes", () => {
    expect(accessDecision(participantRoute, ["ORGANIZER"])).toBe("forbidden");
    expect(accessDecision(adminRoute, ["ORGANIZER"])).toBe("allowed");
  });

  it("keeps the profile choice public for visitors and active sessions", () => {
    expect(accessDecision(roleSelection, [])).toBe("allowed");
    expect(accessDecision(roleSelection, ["PARTICIPANT"])).toBe("allowed");
    expect(accessDecision(roleSelection, ["ORGANIZER"])).toBe("allowed");
  });
});
