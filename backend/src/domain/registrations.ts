import { Prisma, RegistrationStatus } from "@prisma/client";
import {
  generateCancellationToken,
  generateConfirmationCode,
} from "./confirmation.js";
import { HttpError } from "../errors/http-error.js";
import { prisma } from "../lib/prisma.js";
import { availableSeats } from "./public-events.js";

type RegistrationInput = {
  participantName: string;
  participantEmail: string;
  participantPhone: string;
};

const CONFIRMATION_CODE_ATTEMPTS = 10;

export type CreatedRegistration = {
  event: {
    id: string;
    publicId: string;
    name: string;
    date: Date;
    location: string;
    capacity: number;
  };
  registration: {
    id: string;
    participantName: string;
    participantEmail: string;
    participantPhone: string;
    status: RegistrationStatus;
    confirmationCode: string;
    cancellationToken: string;
    createdAt: Date;
  };
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 254) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} é obrigatório`);
  }

  return value.trim();
}

export function parseRegistrationInput(body: unknown): RegistrationInput {
  const input = body as Record<string, unknown> | null;
  const participantEmail = requiredText(input?.participantEmail, "E-mail").toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(participantEmail)) {
    throw new HttpError(400, "VALIDATION_ERROR", "E-mail inválido");
  }

  const participantPhone = requiredText(
    input?.participantPhone,
    "WhatsApp",
  ).replace(/\D/g, "");

  if (participantPhone.length < 10 || participantPhone.length > 15) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "WhatsApp deve conter entre 10 e 15 dígitos",
    );
  }

  return {
    participantName: requiredText(input?.participantName, "Nome"),
    participantEmail,
    participantPhone,
  };
}

export async function createRegistration(
  publicId: string,
  input: RegistrationInput,
  participantId: string | null = null,
): Promise<CreatedRegistration> {
  return prisma.$transaction(async (transaction) => {
    const initialEvent = await transaction.event.findUnique({
      where: { publicId },
      select: { id: true },
    });

    if (!initialEvent) {
      throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
    }

    await transaction.$executeRaw(
      Prisma.sql`SELECT id FROM "Event" WHERE id = ${initialEvent.id}::uuid FOR UPDATE`,
    );

    const event = await transaction.event.findUnique({
      where: { id: initialEvent.id },
      select: {
        id: true,
        publicId: true,
        name: true,
        date: true,
        location: true,
        capacity: true,
        status: true,
        registrationDeadline: true,
      },
    });

    if (!event) {
      throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
    }

    if (event.status !== "PUBLISHED") {
      throw new HttpError(
        409,
        "EVENT_NOT_PUBLISHED",
        "Este evento não está disponível para inscrições",
      );
    }

    if (event.registrationDeadline && event.registrationDeadline < new Date()) {
      throw new HttpError(
        409,
        "EVENT_CLOSED",
        "As inscrições para este evento já foram encerradas",
      );
    }

    const duplicate = await transaction.registration.findFirst({
      where: {
        eventId: event.id,
        status: RegistrationStatus.ACTIVE,
        OR: [
          { participantEmail: input.participantEmail },
          ...(participantId ? [{ participantId }] : []),
        ],
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new HttpError(
        409,
        "REGISTRATION_DUPLICATE",
        "Este e-mail já possui uma inscrição ativa neste evento",
      );
    }

    const activeRegistrations = await transaction.registration.count({
      where: { eventId: event.id, status: RegistrationStatus.ACTIVE },
    });

    if (availableSeats(event, activeRegistrations) === 0) {
      throw new HttpError(409, "EVENT_FULL", "Não há mais vagas disponíveis");
    }

    let confirmationCode: string | null = null;

    for (let attempt = 0; attempt < CONFIRMATION_CODE_ATTEMPTS; attempt += 1) {
      const candidate = generateConfirmationCode();
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`registration-confirmation:${candidate}`}))`,
      );
      const existingCode = await transaction.registration.findUnique({
        where: { confirmationCode: candidate },
        select: { id: true },
      });

      if (!existingCode) {
        confirmationCode = candidate;
        break;
      }
    }

    if (!confirmationCode) {
      throw new Error("Could not allocate a unique registration confirmation code");
    }

    const registration = await transaction.registration.create({
      data: {
        eventId: event.id,
        participantId,
        ...input,
        confirmationCode,
        cancellationToken: generateCancellationToken(),
      },
      select: {
        id: true,
        participantName: true,
        participantEmail: true,
        participantPhone: true,
        status: true,
        confirmationCode: true,
        cancellationToken: true,
        createdAt: true,
      },
    });

    const participantPhone = registration.participantPhone;

    if (
      !registration.confirmationCode ||
      !registration.cancellationToken ||
      !participantPhone
    ) {
      throw new Error("Registration confirmation credentials were not generated");
    }

    return {
      event: {
        id: event.id,
        publicId: event.publicId,
        name: event.name,
        date: event.date,
        location: event.location,
        capacity: event.capacity,
      },
      registration: {
        ...registration,
        participantPhone,
        confirmationCode: registration.confirmationCode,
        cancellationToken: registration.cancellationToken,
      },
    };
  });
}
