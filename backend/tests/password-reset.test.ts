import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { hashPasswordResetToken } from "../src/auth/password-reset.js";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const organizerEmail = "password.reset.owner@example.test";
const participantEmail = "password.reset.participant@example.test";

async function removeTestData() {
  await prisma.participant.deleteMany({ where: { email: participantEmail } });
  await prisma.organizer.deleteMany({ where: { email: organizerEmail } });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("password recovery", () => {
  it("does not reveal whether an organizer or participant exists", async () => {
    await Promise.all([
      prisma.organizer.create({
        data: {
          username: "password_reset_owner",
          email: organizerEmail,
          passwordHash: await hashPassword("old-password"),
        },
      }),
      prisma.participant.create({
        data: {
          username: "password_reset_participant",
          name: "Participante Reset",
          email: participantEmail,
          passwordHash: await hashPassword("old-password"),
        },
      }),
    ]);

    const responses = await Promise.all([
      request(app)
        .post("/api/admin/auth/forgot-password")
        .send({ email: organizerEmail }),
      request(app)
        .post("/api/admin/auth/forgot-password")
        .send({ email: "unknown.organizer@example.test" }),
      request(app)
        .post("/api/public/auth/forgot-password")
        .send({ email: participantEmail }),
      request(app)
        .post("/api/public/auth/forgot-password")
        .send({ email: "unknown.participant@example.test" }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      202, 202, 202, 202,
    ]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[2].body).toEqual(responses[3].body);
  });

  it("resets an organizer password once and invalidates the old session", async () => {
    const rawToken = "organizer-one-use-reset-token";
    const organizer = await prisma.organizer.create({
      data: {
        username: "password_reset_owner",
        email: organizerEmail,
        passwordHash: await hashPassword("old-password"),
        passwordResetTokenHash: hashPasswordResetToken(rawToken),
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const oldLogin = await request(app).post("/api/admin/auth/login").send({
      identifier: organizer.username,
      password: "old-password",
    });

    const reset = await request(app)
      .post("/api/admin/auth/reset-password")
      .send({ token: rawToken, password: "new-password" });
    expect(reset.status).toBe(204);
    expect(
      (
        await request(app)
          .get("/api/admin/auth/me")
          .set("Authorization", `Bearer ${oldLogin.body.token}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app).post("/api/admin/auth/login").send({
          identifier: organizer.username,
          password: "old-password",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app).post("/api/admin/auth/login").send({
          identifier: organizer.username,
          password: "new-password",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/admin/auth/reset-password")
          .send({ token: rawToken, password: "another-password" })
      ).body.error.code,
    ).toBe("INVALID_RESET_TOKEN");
  });

  it("resets a participant password through the public account endpoints", async () => {
    const rawToken = "participant-one-use-reset-token";
    const participant = await prisma.participant.create({
      data: {
        username: "password_reset_participant",
        name: "Participante Reset",
        email: participantEmail,
        passwordHash: await hashPassword("old-password"),
        passwordResetTokenHash: hashPasswordResetToken(rawToken),
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(
      (
        await request(app)
          .post("/api/public/auth/reset-password")
          .send({ token: rawToken, password: "new-password" })
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app).post("/api/public/auth/login").send({
          identifier: participant.username,
          password: "new-password",
        })
      ).status,
    ).toBe(200);
  });
});
