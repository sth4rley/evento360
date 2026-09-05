import { EventStatus, type Event } from "@prisma/client";
import { HttpError } from "../errors/http-error.js";

type CreateEventInput = {
  name: string;
  date: Date;
  location: string;
  capacity: number;
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 300) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} é obrigatório`);
  }

  return value.trim();
}

function validDate(value: unknown): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "VALIDATION_ERROR", "Data é obrigatória");
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const date = new Date(value);

  if (!match || Number.isNaN(date.getTime())) {
    throw new HttpError(400, "VALIDATION_ERROR", "Data inválida");
  }

  const [year, month, day] = match.slice(1).map(Number);
  const usesExplicitOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const receivedYear = usesExplicitOffset ? date.getUTCFullYear() : date.getFullYear();
  const receivedMonth = usesExplicitOffset ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const receivedDay = usesExplicitOffset ? date.getUTCDate() : date.getDate();

  if (receivedYear !== year || receivedMonth !== month || receivedDay !== day) {
    throw new HttpError(400, "VALIDATION_ERROR", "Data inválida");
  }

  return date;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Capacidade deve ser um número inteiro maior que zero",
    );
  }

  return value;
}

export function parseCreateEventInput(body: unknown): CreateEventInput {
  const input = body as Record<string, unknown> | null;

  return {
    name: requiredText(input?.name, "Nome"),
    date: validDate(input?.date),
    location: requiredText(input?.location, "Local"),
    capacity: positiveInteger(input?.capacity),
  };
}

export function assertEventReadyForPublication(event: Event): void {
  parseCreateEventInput({
    name: event.name,
    date: event.date.toISOString(),
    location: event.location,
    capacity: event.capacity,
  });
}

export function serializeAdminEvent(event: Event) {
  return {
    id: event.id,
    name: event.name,
    date: event.date,
    location: event.location,
    capacity: event.capacity,
    status: event.status,
    publicId: event.publicId,
    publishedAt: event.publishedAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function isPublished(event: Event): boolean {
  return event.status === EventStatus.PUBLISHED;
}
