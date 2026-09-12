import { Prisma, RegistrationStatus } from "@prisma/client";
import { Router } from "express";
import {
  authenticateOrganizer,
  invalidateAccountSessions,
  serializeOrganizer,
} from "../../auth/accounts.js";
import { requiredString, validNewPassword } from "../../auth/inputs.js";
import {
  genericRecoveryResponse,
  requestPasswordReset,
  resetPassword,
} from "../../auth/password-reset-flow.js";
import { createAccessToken } from "../../auth/token.js";
import {
  assertEventReadyForPublication,
  parseCreateEventInput,
  serializeAdminEvent,
} from "../../domain/events.js";
import { availableSeats } from "../../domain/public-events.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../errors/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { requireOrganizerAuth } from "../../middlewares/require-auth.js";

export const adminRouter = Router();

adminRouter.post("/auth/login", async (request, response, next) => {
  try {
    const organizer = await authenticateOrganizer(
      request.body?.identifier ?? request.body?.email,
      request.body?.password,
    );

    if (!organizer) {
      throw new HttpError(
        401,
        "INVALID_CREDENTIALS",
        "E-mail ou senha inválidos",
      );
    }

    response.json({
      token: createAccessToken(
        organizer.id,
        "ORGANIZER",
        organizer.sessionVersion,
      ),
      organizer: serializeOrganizer(organizer),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/auth/forgot-password", async (request, response, next) => {
  try {
    await requestPasswordReset(
      "organizer",
      request.body?.identifier ?? request.body?.email,
    );
    response.status(202).json(genericRecoveryResponse);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/auth/reset-password", async (request, response, next) => {
  try {
    const token = requiredString(request.body?.token, "Token");
    const password = validNewPassword(
      request.body?.password ?? request.body?.newPassword,
    );
    await resetPassword("organizer", token, password);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

adminRouter.use(...requireOrganizerAuth);

adminRouter.post("/auth/logout", async (request, response, next) => {
  try {
    await invalidateAccountSessions(request.auth!);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/auth/me", async (request, response, next) => {
  try {
    const organizer = await prisma.organizer.findUnique({
      where: { id: request.auth!.accountId },
    });

    if (!organizer) {
      throw new HttpError(401, "AUTHENTICATION_REQUIRED", "Autenticação necessária");
    }

    response.json({ organizer: serializeOrganizer(organizer) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/events", async (request, response, next) => {
  try {
    const input = parseCreateEventInput(request.body as unknown);
    const event = await prisma.event.create({
      data: {
        ...input,
        organizerId: request.auth!.accountId,
      },
    });

    response.status(201).json({ event: serializeAdminEvent(event) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/events", async (request, response, next) => {
  try {
    const events = await prisma.event.findMany({
      where: {
        organizerId: request.auth!.accountId,
        status: { not: "ARCHIVED" },
      },
      orderBy: { createdAt: "desc" },
    });

    response.json({ events: events.map(serializeAdminEvent) });
  } catch (error) {
    next(error);
  }
});

async function findOwnedEvent(eventId: string, organizerId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });

  if (!event) {
    throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
  }

  if (event.organizerId !== organizerId) {
    throw new HttpError(403, "FORBIDDEN", "Você não tem acesso a este evento");
  }

  if (event.status === "ARCHIVED") {
    throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
  }

  return event;
}

adminRouter.delete("/events/:eventId", async (request, response, next) => {
  try {
    const event = await findOwnedEvent(
      request.params.eventId,
      request.auth!.accountId,
    );

    // Arquivamento preserva inscrições, confirmações e auditoria. O evento
    // deixa imediatamente as listas e não aceita novas inscrições.
    await prisma.event.update({
      where: { id: event.id },
      data: { status: "ARCHIVED" },
    });

    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/events/:eventId", async (request, response, next) => {
  try {
    const event = await findOwnedEvent(
      request.params.eventId,
      request.auth!.accountId,
    );

    response.json({ event: serializeAdminEvent(event) });
  } catch (error) {
    next(error);
  }
});

adminRouter.put("/events/:eventId", async (request, response, next) => {
  try {
    const input = parseCreateEventInput(request.body as unknown);
    const owned = await findOwnedEvent(
      request.params.eventId,
      request.auth!.accountId,
    );

    // Mesmo bloqueio usado nas inscrições: reduzir a capacidade não pode
    // concorrer com uma nova inscrição e deixar o evento acima do limite.
    const event = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT id FROM "Event" WHERE id = ${owned.id}::uuid FOR UPDATE`,
      );
      const current = await transaction.event.findUniqueOrThrow({
        where: { id: owned.id },
        select: { status: true },
      });

      if (current.status === "ARCHIVED") {
        throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
      }

      const activeRegistrations = await transaction.registration.count({
        where: { eventId: owned.id, status: RegistrationStatus.ACTIVE },
      });

      if (input.capacity < activeRegistrations) {
        throw new HttpError(
          409,
          "CAPACITY_BELOW_REGISTRATIONS",
          `A capacidade não pode ser menor que as ${activeRegistrations} inscrições ativas`,
        );
      }

      return transaction.event.update({ where: { id: owned.id }, data: input });
    });

    response.json({ event: serializeAdminEvent(event) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/events/:eventId/publish", async (request, response, next) => {
  try {
    const event = await findOwnedEvent(
      request.params.eventId,
      request.auth!.accountId,
    );
    assertEventReadyForPublication(event);
    // Only drafts may transition to published; a concurrent archive must win.
    if (event.status === "DRAFT") {
      await prisma.event.updateMany({
        where: { id: event.id, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
    }
    const publishedEvent =
      event.status === "PUBLISHED"
        ? event
        : await findOwnedEvent(event.id, request.auth!.accountId);

    response.json({
      event: serializeAdminEvent(publishedEvent),
      publicUrl: `${env.publicAppUrl}/event/${publishedEvent.publicId}`,
    });
  } catch (error) {
    next(error);
  }
});

import { sendOrganizerEventSummary } from "../../services/organizer-report.js";

adminRouter.post("/events/:eventId/close", async (request, response, next) => {
  try {
    const event = await findOwnedEvent(
      request.params.eventId,
      request.auth!.accountId,
    );
    
    // Set deadline to now so it stops accepting public registrations
    await prisma.event.update({
      where: { id: event.id },
      data: { registrationDeadline: new Date() }
    });

    // Fire the report manually
    await sendOrganizerEventSummary(event.id);

    const closedEvent = await findOwnedEvent(event.id, request.auth!.accountId);
    response.json({ event: serializeAdminEvent(closedEvent) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/events/:eventId/participants", async (request, response, next) => {
  try {
    const event = await findOwnedEvent(
      request.params.eventId,
      request.auth!.accountId,
    );
    const [activeRegistrations, registrations] = await Promise.all([
      prisma.registration.count({
        where: { eventId: event.id, status: "ACTIVE" },
      }),
      prisma.registration.findMany({
        where: { eventId: event.id },
        select: {
          id: true,
          participantName: true,
          participantEmail: true,
          participantPhone: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    response.json({
      event: serializeAdminEvent(event),
      metrics: {
        capacity: event.capacity,
        activeRegistrations,
        availableSeats: availableSeats(event, activeRegistrations),
      },
      participants: registrations,
    });
  } catch (error) {
    next(error);
  }
});

async function getCheckInMetrics(eventId: string) {
  const [activeRegistrations, checkIns] = await Promise.all([
    prisma.registration.count({ where: { eventId, status: "ACTIVE" } }),
    prisma.registration.count({
      where: { eventId, status: "ACTIVE", checkedInAt: { not: null } },
    }),
  ]);

  return {
    activeRegistrations,
    checkIns,
    pending: Math.max(activeRegistrations - checkIns, 0),
  };
}

adminRouter.get("/events/:eventId/check-in", async (request, response, next) => {
  try {
    const event = await findOwnedEvent(
      request.params.eventId,
      request.auth!.accountId,
    );
    const query = typeof request.query.query === "string" ? request.query.query.trim() : "";
    const metrics = await getCheckInMetrics(event.id);

    if (!query) {
      response.json({ metrics, registrations: [] });
      return;
    }

    const normalizedCode = query.toUpperCase();
    const registrations = await prisma.registration.findMany({
      where: {
        eventId: event.id,
        OR: [
          { confirmationCode: normalizedCode },
          { participantName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        participantName: true,
        participantEmail: true,
        confirmationCode: true,
        status: true,
        checkedInAt: true,
      },
      orderBy: { participantName: "asc" },
      take: 25,
    });

    response.json({ metrics, registrations });
  } catch (error) {
    next(error);
  }
});

adminRouter.post(
  "/events/:eventId/registrations/:registrationId/check-in",
  async (request, response, next) => {
    try {
      const event = await findOwnedEvent(
        request.params.eventId,
        request.auth!.accountId,
      );
      const registration = await prisma.registration.findFirst({
        where: { id: request.params.registrationId, eventId: event.id },
        select: { id: true, status: true, checkedInAt: true },
      });

      if (!registration) {
        throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada");
      }

      if (registration.status === "CANCELLED") {
        throw new HttpError(
          409,
          "REGISTRATION_CANCELLED",
          "Inscrições canceladas não podem receber check-in",
        );
      }

      if (registration.status === "WAITLISTED") {
        throw new HttpError(
          409,
          "REGISTRATION_WAITLISTED",
          "Inscrições na lista de espera não podem receber check-in",
        );
      }

      const update = await prisma.registration.updateMany({
        where: {
          id: registration.id,
          status: "ACTIVE",
          checkedInAt: null,
        },
        data: { checkedInAt: new Date() },
      });

      if (update.count === 0) {
        throw new HttpError(
          409,
          "ALREADY_CHECKED_IN",
          "Check-in já realizado para esta inscrição",
        );
      }

      const checkedInRegistration = await prisma.registration.findUniqueOrThrow({
        where: { id: registration.id },
        select: {
          id: true,
          participantName: true,
          participantEmail: true,
          confirmationCode: true,
          status: true,
          checkedInAt: true,
        },
      });

      response.json({
        registration: checkedInRegistration,
        metrics: await getCheckInMetrics(event.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get("/status", (_request, response) => {
  response.json({ status: "ok" });
});
