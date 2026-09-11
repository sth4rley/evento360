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
  joinWaitlist: boolean;
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
    waitlistPosition?: number;
  };
};

const registrationSelect = {
  id: true,
  participantName: true,
  participantEmail: true,
  participantPhone: true,
  status: true,
  confirmationCode: true,
  cancellationToken: true,
  createdAt: true,
} as const;

const eventSelect = {
  id: true,
  publicId: true,
  name: true,
  date: true,
  location: true,
  capacity: true,
} as const;

// A fila é atendida por ordem de chegada; o id desempata inscrições
// gravadas no mesmo milissegundo.
const waitlistOrder: Prisma.RegistrationOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { id: "asc" },
];

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
    joinWaitlist: input?.joinWaitlist === true,
  };
}

// Serializa inscrições, cancelamentos e promoções do mesmo evento.
async function lockEvent(transaction: Prisma.TransactionClient, eventId: string) {
  await transaction.$executeRaw(
    Prisma.sql`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`,
  );
}

export async function waitlistPosition(
  client: Prisma.TransactionClient,
  registration: { id: string; eventId: string; createdAt: Date },
): Promise<number> {
  const ahead = await client.registration.count({
    where: {
      eventId: registration.eventId,
      status: RegistrationStatus.WAITLISTED,
      OR: [
        { createdAt: { lt: registration.createdAt } },
        { createdAt: registration.createdAt, id: { lt: registration.id } },
      ],
    },
  });

  return ahead + 1;
}

function withCredentials(
  event: CreatedRegistration["event"],
  registration: {
    id: string;
    participantName: string;
    participantEmail: string;
    participantPhone: string | null;
    status: RegistrationStatus;
    confirmationCode: string | null;
    cancellationToken: string | null;
    createdAt: Date;
  },
): CreatedRegistration {
  const { confirmationCode, cancellationToken, participantPhone } = registration;

  if (!confirmationCode || !cancellationToken || !participantPhone) {
    throw new Error("Registration confirmation credentials were not generated");
  }

  return {
    event,
    registration: { ...registration, confirmationCode, cancellationToken, participantPhone },
  };
}

export async function createRegistration(
  publicId: string,
  input: RegistrationInput,
  participantId: string | null = null,
): Promise<CreatedRegistration> {
  const { joinWaitlist, ...participantData } = input;

  return prisma.$transaction(async (transaction) => {
    const initialEvent = await transaction.event.findUnique({
      where: { publicId },
      select: { id: true },
    });

    if (!initialEvent) {
      throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
    }

    await lockEvent(transaction, initialEvent.id);

    const event = await transaction.event.findUnique({
      where: { id: initialEvent.id },
      select: { ...eventSelect, status: true, registrationDeadline: true },
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
        status: { in: [RegistrationStatus.ACTIVE, RegistrationStatus.WAITLISTED] },
        OR: [
          { participantEmail: input.participantEmail },
          ...(participantId ? [{ participantId }] : []),
        ],
      },
      select: { status: true },
    });

    if (duplicate) {
      throw new HttpError(
        409,
        "REGISTRATION_DUPLICATE",
        duplicate.status === RegistrationStatus.WAITLISTED
          ? "Este e-mail já está na lista de espera deste evento"
          : "Este e-mail já possui uma inscrição ativa neste evento",
      );
    }

    const activeRegistrations = await transaction.registration.count({
      where: { eventId: event.id, status: RegistrationStatus.ACTIVE },
    });
    const isFull = availableSeats(event, activeRegistrations) === 0;

    if (isFull && !joinWaitlist) {
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
        ...participantData,
        status: isFull ? RegistrationStatus.WAITLISTED : RegistrationStatus.ACTIVE,
        confirmationCode,
        cancellationToken: generateCancellationToken(),
      },
      select: registrationSelect,
    });

    const created = withCredentials(
      {
        id: event.id,
        publicId: event.publicId,
        name: event.name,
        date: event.date,
        location: event.location,
        capacity: event.capacity,
      },
      registration,
    );

    if (isFull) {
      created.registration.waitlistPosition = await waitlistPosition(transaction, {
        ...registration,
        eventId: event.id,
      });
    }

    return created;
  });
}

// Preenche as vagas livres com as primeiras inscrições da fila. Deve ser
// chamada dentro de uma transação que já bloqueou o evento.
export async function promoteFromWaitlist(
  transaction: Prisma.TransactionClient,
  eventId: string,
): Promise<CreatedRegistration[]> {
  const event = await transaction.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { ...eventSelect, status: true },
  });

  if (event.status !== "PUBLISHED" || event.date <= new Date()) {
    return [];
  }

  const activeRegistrations = await transaction.registration.count({
    where: { eventId, status: RegistrationStatus.ACTIVE },
  });
  const seats = availableSeats(event, activeRegistrations);

  if (seats === 0) {
    return [];
  }

  const next = await transaction.registration.findMany({
    where: { eventId, status: RegistrationStatus.WAITLISTED },
    orderBy: waitlistOrder,
    take: seats,
    select: registrationSelect,
  });

  if (next.length === 0) {
    return [];
  }

  await transaction.registration.updateMany({
    where: { id: { in: next.map((registration) => registration.id) } },
    data: { status: RegistrationStatus.ACTIVE, promotedAt: new Date() },
  });

  const { status: _status, ...eventData } = event;
  return next.map((registration) =>
    withCredentials(eventData, { ...registration, status: RegistrationStatus.ACTIVE }),
  );
}

export type CancellationResult = {
  registrationId: string;
  promoted: CreatedRegistration[];
};

export async function cancelRegistration(
  cancellationToken: string,
): Promise<CancellationResult | null> {
  return prisma.$transaction(async (transaction) => {
    const found = await transaction.registration.findUnique({
      where: { cancellationToken },
      select: { id: true, eventId: true },
    });

    if (!found) {
      return null;
    }

    await lockEvent(transaction, found.eventId);

    // Relido sob o bloqueio: uma promoção concorrente pode ter mudado o status.
    const { status } = await transaction.registration.findUniqueOrThrow({
      where: { id: found.id },
      select: { status: true },
    });

    if (status === RegistrationStatus.CANCELLED) {
      return { registrationId: found.id, promoted: [] };
    }

    await transaction.registration.update({
      where: { id: found.id },
      data: { status: RegistrationStatus.CANCELLED, cancelledAt: new Date() },
    });

    return {
      registrationId: found.id,
      promoted:
        status === RegistrationStatus.ACTIVE
          ? await promoteFromWaitlist(transaction, found.eventId)
          : [],
    };
  });
}
