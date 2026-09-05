import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

describe("technical foundation", () => {
  it("returns a healthy status", async () => {
    const response = await request(app).get("/api/public/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("initializes the Prisma persistence layer", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe("function");
  });

  it("protects the administrative route boundary", async () => {
    const response = await request(app).get("/api/admin/status");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Autenticação necessária",
      },
    });
  });
});
