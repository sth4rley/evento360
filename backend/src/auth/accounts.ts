import type { Organizer, Participant } from "@prisma/client";
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
