import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { createSecurityLimits } from "../src/middlewares/rate-limit.js";
import { parseCreateEventInput } from "../src/domain/events.js";
import { parseRegistrationInput } from "../src/domain/registrations.js";

describe("HTTP security", () => {
  it("does not cache private responses or reveal the framework", async () => {
    const response = await request(app).get("/api/admin/status");
    expect(response.status).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("rejects malformed and oversized JSON without reflecting submitted secrets", async () => {
    for (const [body, status] of [["{\"password\":\"private-value\"", 400], [JSON.stringify({ password: "x".repeat(110_000) }), 413]] as const) {
      const response = await request(app).post("/api/public/auth/login").set("Content-Type", "application/json").send(body);
      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe("INVALID_REQUEST_BODY");
      expect(response.text).not.toContain("private-value");
      expect(response.text).not.toContain("stack");
    }
  });

  it("limits authentication attempts even when the profile or identifier changes", async () => {
    const limited = express();
    limited.use(createSecurityLimits());
    limited.use((_request, response) => { response.sendStatus(204); });
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await request(limited).post(`/api/${attempt % 2 ? "admin" : "public"}/auth/login`)).status).toBe(204);
    }
    const blocked = await request(limited).post("/api/public/auth/forgot-password");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect((await request(limited).get("/api/public/health")).status).toBe(204);
  });

  it("limits enumeration across different confirmation codes", async () => {
    const limited = express();
    limited.use(createSecurityLimits());
    limited.use((_request, response) => { response.sendStatus(404); });
    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await request(limited).get(`/api/public/registrations/confirmation/${10_000_000 + attempt}`)).status).toBe(404);
    }
    expect((await request(limited).get("/api/public/registrations/confirmation/99999999")).status).toBe(429);
  });
});

describe("bounded input", () => {
  it("rejects capacities outside PostgreSQL integer range and oversized names", () => {
    const event = { name: "Evento", date: "2027-01-01", location: "Local", capacity: 10 };
    expect(() => parseCreateEventInput({ ...event, capacity: 2 ** 31 })).toThrow();
    expect(() => parseCreateEventInput({ ...event, name: "x".repeat(301) })).toThrow();
    expect(() => parseRegistrationInput({ participantName: "x".repeat(255), participantEmail: "test@example.test", participantPhone: "11999999999" })).toThrow();
  });
});
