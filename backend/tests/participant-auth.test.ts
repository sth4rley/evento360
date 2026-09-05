import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const participantEmails = [
  "participant.auth@example.test",
  "participant.other@example.test",
];
const participantUsernames = ["participant_auth", "participant_other"];

async function removeTestData() {
  await prisma.registration.deleteMany({
    where: { participant: { email: { in: participantEmails } } },
  });
  await prisma.participant.deleteMany({
    where: { email: { in: participantEmails } },
  });
}

beforeEach(removeTestData);
afterEach(removeTestData);

describe("participant authentication", () => {
  it("registers, authenticates and restores only a participant session", async () => {
    const registered = await request(app).post("/api/public/auth/register").send({
      username: participantUsernames[0],
      name: "Participante Autenticado",
      email: participantEmails[0],
      password: "participant-password",
    });

    expect(registered.status).toBe(201);
    expect(registered.body.token).toEqual(expect.any(String));
    expect(registered.body.participant).toMatchObject({
      username: participantUsernames[0],
      name: "Participante Autenticado",
      email: participantEmails[0],
    });
    expect(JSON.stringify(registered.body)).not.toContain("passwordHash");

    const me = await request(app)
      .get("/api/public/auth/me")
      .set("Authorization", `Bearer ${registered.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.participant.email).toBe(participantEmails[0]);

    const adminAttempt = await request(app)
      .get("/api/admin/events")
      .set("Authorization", `Bearer ${registered.body.token}`);
    expect(adminAttempt.status).toBe(403);

    const login = await request(app).post("/api/public/auth/login").send({
      identifier: `  ${participantUsernames[0].toUpperCase()}  `,
      password: "participant-password",
    });
    expect(login.status).toBe(200);
  });

  it("uses generic credential errors and protects the me endpoint", async () => {
    const [unknown, unauthenticated] = await Promise.all([
      request(app).post("/api/public/auth/login").send({
        identifier: "nobody",
        password: "wrong-password",
      }),
      request(app).get("/api/public/auth/me"),
    ]);

    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rejects duplicate participant identities", async () => {
    const account = {
      username: participantUsernames[0],
      name: "Participante Autenticado",
      email: participantEmails[0],
      password: "participant-password",
    };
    expect(
      (await request(app).post("/api/public/auth/register").send(account)).status,
    ).toBe(201);

    const duplicate = await request(app)
      .post("/api/public/auth/register")
      .send({ ...account, email: participantEmails[1] });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ACCOUNT_ALREADY_EXISTS");
  });
});
