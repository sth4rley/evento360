import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmails = [
  "organizer.auth@example.test",
  "other.auth@example.test",
];

beforeEach(async () => {
  await prisma.organizer.deleteMany({ where: { email: { in: organizerEmails } } });
});

afterEach(async () => {
  await prisma.organizer.deleteMany({ where: { email: { in: organizerEmails } } });
});

describe("organizer authentication", () => {
  it("authenticates normalized credentials and never returns the password hash", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");
    const organizer = await prisma.organizer.create({
      data: { email: organizerEmails[0], passwordHash },
    });

    const response = await request(app).post("/api/admin/auth/login").send({
      email: `  ${organizer.email.toUpperCase()}  `,
      password: "correct horse battery staple",
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.organizer).toMatchObject({
      id: organizer.id,
      email: organizer.email,
    });
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("returns the same generic error for an unknown email and an invalid password", async () => {
    await prisma.organizer.create({
      data: {
        email: organizerEmails[0],
        passwordHash: await hashPassword("a valid password"),
      },
    });

    const [unknownEmail, invalidPassword] = await Promise.all([
      request(app).post("/api/admin/auth/login").send({
        email: organizerEmails[1],
        password: "a valid password",
      }),
      request(app).post("/api/admin/auth/login").send({
        email: organizerEmails[0],
        password: "wrong password",
      }),
    ]);

    expect(unknownEmail.status).toBe(401);
    expect(invalidPassword.status).toBe(401);
    expect(unknownEmail.body).toEqual(invalidPassword.body);
    expect(unknownEmail.body).toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "E-mail ou senha inválidos",
      },
    });
  });

  it("rejects administrative requests without a valid session", async () => {
    const response = await request(app).get("/api/admin/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("acknowledges logout only for an authenticated organizer", async () => {
    const organizer = await prisma.organizer.create({
      data: {
        email: organizerEmails[0],
        passwordHash: await hashPassword("a valid password"),
      },
    });
    const login = await request(app).post("/api/admin/auth/login").send({
      email: organizer.email,
      password: "a valid password",
    });

    const logout = await request(app)
      .post("/api/admin/auth/logout")
      .set("Authorization", `Bearer ${login.body.token}`);

    expect(logout.status).toBe(204);
    expect(logout.text).toBe("");
  });
});
