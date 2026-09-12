import { Prisma, type Organizer, type Participant } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { verifyPassword } from "./password.js";
import type { AuthSession } from "./types.js";

export type OrganizerAccount = {
  role: "ORGANIZER";
  record: Organizer;
};

export type ParticipantAccount = {
  role: "PARTICIPANT";
  record: Participant;
};

export type AuthAccount = OrganizerAccount | ParticipantAccount;

export function normalizeIdentifier(value: unknown): string {
  return typeof value === "string" && value.length <= 254 ? value.trim().toLowerCase() : "";
}

export function serializeOrganizer(organizer: Organizer) {
  return {
    id: organizer.id,
    username: organizer.username ?? organizer.email,
    email: organizer.email,
    createdAt: organizer.createdAt,
  };
}

export function serializeParticipant(participant: Participant) {
  return {
    id: participant.id,
    username: participant.username,
    name: participant.name,
    email: participant.email,
    createdAt: participant.createdAt,
  };
}

export async function findOrganizerByIdentifier(
  identifierValue: unknown,
): Promise<Organizer | null> {
  const identifier = normalizeIdentifier(identifierValue);
  return identifier
    ? prisma.organizer.findFirst({
        where: { OR: [{ username: identifier }, { email: identifier }] },
      })
    : null;
}

export async function findParticipantByIdentifier(
  identifierValue: unknown,
): Promise<Participant | null> {
  const identifier = normalizeIdentifier(identifierValue);
  return identifier
    ? prisma.participant.findFirst({
        where: { OR: [{ username: identifier }, { email: identifier }] },
      })
    : null;
}

export async function authenticateOrganizer(
  identifierValue: unknown,
  passwordValue: unknown,
): Promise<Organizer | null> {
  const organizer = await findOrganizerByIdentifier(identifierValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  return (await verifyPassword(password, organizer?.passwordHash))
    ? organizer
    : null;
}

export async function authenticateParticipant(
  identifierValue: unknown,
  passwordValue: unknown,
): Promise<Participant | null> {
  const participant = await findParticipantByIdentifier(identifierValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  return (await verifyPassword(password, participant?.passwordHash))
    ? participant
    : null;
}

function googleUsername(email: string): string {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return (base.length >= 3 ? base : "usuario").slice(0, 24);
}

export async function findOrCreateGoogleParticipant(input: { sub: string; email: string; name?: string }): Promise<Participant> {
  const bySubject = await prisma.participant.findUnique({ where: { googleSubject: input.sub } });
  if (bySubject) return bySubject;
  const byEmail = await prisma.participant.findUnique({ where: { email: input.email } });
  if (byEmail) return prisma.participant.update({ where: { id: byEmail.id }, data: { googleSubject: input.sub, authProvider: byEmail.authProvider === "password" ? "password+google" : "google" } });
  const base = googleUsername(input.email);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const username = suffix ? `${base.slice(0, 30 - String(suffix).length - 1)}-${suffix}` : base;
    try { return await prisma.participant.create({ data: { username, name: input.name?.trim().slice(0, 100) || username, email: input.email, authProvider: "google", googleSubject: input.sub } }); }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error; }
  }
  throw new Error("Could not allocate a username for Google account");
}

export async function findGoogleOrganizer(input: { sub: string; email: string }): Promise<Organizer | null> {
  const bySubject = await prisma.organizer.findUnique({ where: { googleSubject: input.sub } });
  if (bySubject) return bySubject;
  const byEmail = await prisma.organizer.findUnique({ where: { email: input.email } });
  return byEmail ? prisma.organizer.update({ where: { id: byEmail.id }, data: { googleSubject: input.sub, authProvider: byEmail.authProvider === "password" ? "password+google" : "google" } }) : null;
}

export async function findAccountBySession(
  session: AuthSession,
): Promise<AuthAccount | null> {
  if (session.role === "ORGANIZER") {
    const organizer = await prisma.organizer.findUnique({
      where: { id: session.accountId },
    });
    return organizer && organizer.sessionVersion === session.sessionVersion
      ? { role: "ORGANIZER", record: organizer }
      : null;
  }

  const participant = await prisma.participant.findUnique({
    where: { id: session.accountId },
  });
  return participant && participant.sessionVersion === session.sessionVersion
    ? { role: "PARTICIPANT", record: participant }
    : null;
}

export async function invalidateAccountSessions(
  session: AuthSession,
): Promise<void> {
  if (session.role === "ORGANIZER") {
    await prisma.organizer.updateMany({
      where: { id: session.accountId, sessionVersion: session.sessionVersion },
      data: { sessionVersion: { increment: 1 } },
    });
    return;
  }

  await prisma.participant.updateMany({
    where: { id: session.accountId, sessionVersion: session.sessionVersion },
    data: { sessionVersion: { increment: 1 } },
  });
}
