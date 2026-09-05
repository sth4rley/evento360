import { Prisma } from "@prisma/client";
import { Router } from "express";
import {
  authenticateParticipant,
  invalidateAccountSessions,
  serializeParticipant,
} from "../../auth/accounts.js";
import {
  requiredString,
  validEmail,
  validName,
  validNewPassword,
  validUsername,
} from "../../auth/inputs.js";
import { hashPassword } from "../../auth/password.js";
import {
  genericRecoveryResponse,
  requestPasswordReset,
  resetPassword,
} from "../../auth/password-reset-flow.js";
import { createAccessToken } from "../../auth/token.js";
import { serializePublicEvent } from "../../domain/public-events.js";
import {
  createRegistration,
  parseRegistrationInput,
} from "../../domain/registrations.js";
import { HttpError } from "../../errors/http-error.js";
import { prisma } from "../../lib/prisma.js";
import {
  optionalParticipantAuth,
  requireParticipantAuth,
} from "../../middlewares/require-auth.js";
import { notifyRegistrationCreated } from "../../services/registration-notifications.js";

export const publicRouter = Router();

publicRouter.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

publicRouter.post("/auth/register", async (request, response, next) => {
  try {
    const username = validUsername(request.body?.username);
    const name = validName(request.body?.name);
    const email = validEmail(request.body?.email);
    const password = validNewPassword(request.body?.password);
    const existing = await prisma.participant.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { id: true },
    });

    if (existing) {
      throw new HttpError(
        409,
        "ACCOUNT_ALREADY_EXISTS",
        "Login ou e-mail já cadastrado",
      );
    }

    const participant = await prisma.participant.create({
      data: {
        username,
        name,
        email,
        passwordHash: await hashPassword(password),
        authProvider: "password",
      },
    });

    response.status(201).json({
      token: createAccessToken(
        participant.id,
        "PARTICIPANT",
        participant.sessionVersion,
      ),
      participant: serializeParticipant(participant),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      next(
        new HttpError(
          409,
          "ACCOUNT_ALREADY_EXISTS",
          "Login ou e-mail já cadastrado",
        ),
      );
      return;
    }
    next(error);
  }
});

publicRouter.post("/auth/login", async (request, response, next) => {
  try {
    const participant = await authenticateParticipant(
      request.body?.identifier ?? request.body?.email,
      request.body?.password,
    );

    if (!participant) {
      throw new HttpError(
        401,
        "INVALID_CREDENTIALS",
        "Login, e-mail ou senha inválidos",
      );
    }

    response.json({
      token: createAccessToken(
        participant.id,
        "PARTICIPANT",
        participant.sessionVersion,
      ),
      participant: serializeParticipant(participant),
    });
  } catch (error) {
    next(error);
  }
});

publicRouter.post("/auth/forgot-password", async (request, response, next) => {
  try {
    await requestPasswordReset(
      "participant",
      request.body?.identifier ?? request.body?.email,
    );
    response.status(202).json(genericRecoveryResponse);
  } catch (error) {
    next(error);
  }
});

publicRouter.post("/auth/reset-password", async (request, response, next) => {
  try {
    const token = requiredString(request.body?.token, "Token");
    const password = validNewPassword(
      request.body?.password ?? request.body?.newPassword,
    );
    await resetPassword("participant", token, password);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

publicRouter.get(
  "/auth/me",
  ...requireParticipantAuth,
  async (request, response, next) => {
    try {
      const participant = await prisma.participant.findUnique({
        where: { id: request.auth!.accountId },
      });
      if (!participant) {
        throw new HttpError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Autenticação necessária",
        );
      }
      response.json({ participant: serializeParticipant(participant) });
    } catch (error) {
      next(error);
    }
  },
);

publicRouter.post(
  "/auth/logout",
  ...requireParticipantAuth,
  async (request, response, next) => {
    try {
      await invalidateAccountSessions(request.auth!);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

publicRouter.get(
  "/auth/me/registrations",
  ...requireParticipantAuth,
  async (request, response, next) => {
    try {
      const registrations = await prisma.registration.findMany({
        where: { participantId: request.auth!.accountId },
        select: {
          id: true,
          status: true,
          confirmationCode: true,
          cancellationToken: true,
          createdAt: true,
          cancelledAt: true,
          event: {
            select: {
              publicId: true,
              name: true,
              date: true,
              location: true,
              capacity: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      response.json({
        registrations: registrations.map((registration) => ({
          id: registration.id,
          status: registration.status,
          confirmationCode: registration.confirmationCode,
          cancellationToken: registration.cancellationToken,
          createdAt: registration.createdAt,
          cancelledAt: registration.cancelledAt,
          event: {
            publicId: registration.event.publicId,
            name: registration.event.name,
            date: registration.event.date,
            location: registration.event.location,
            capacity: registration.event.capacity,
            available: registration.event.status === "PUBLISHED",
          },
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

publicRouter.get("/events", async (_request, response, next) => {
  try {
    const events = await prisma.event.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { date: "asc" },
      select: {
        publicId: true,
        name: true,
        date: true,
        location: true,
        capacity: true,
        _count: {
          select: { registrations: { where: { status: "ACTIVE" } } },
        },
      },
    });

    response.json({
      events: events.map((event) => serializePublicEvent(event, event._count.registrations)),
    });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/events/:publicId", async (request, response, next) => {
  try {
    const event = await prisma.event.findFirst({
      where: { publicId: request.params.publicId, status: "PUBLISHED" },
      select: {
        publicId: true,
        name: true,
        date: true,
        location: true,
        capacity: true,
        _count: {
          select: { registrations: { where: { status: "ACTIVE" } } },
        },
      },
    });

    if (!event) {
      throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
    }

    response.json({
      event: serializePublicEvent(event, event._count.registrations),
    });
  } catch (error) {
    next(error);
  }
});

publicRouter.post(
  "/events/:publicId/registrations",
  ...optionalParticipantAuth,
  async (request, response, next) => {
    try {
      const participant = request.auth
        ? await prisma.participant.findUnique({
            where: { id: request.auth.accountId },
            select: { id: true, name: true, email: true },
          })
        : null;
      if (request.auth && !participant) {
        throw new HttpError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Sessão inválida ou expirada",
        );
      }

      const input = parseRegistrationInput({
        ...(request.body as Record<string, unknown>),
        ...(participant
          ? {
              participantName: participant.name,
              participantEmail: participant.email,
            }
          : {}),
      });
      const registration = await createRegistration(
        String(request.params.publicId),
        input,
        participant?.id ?? null,
      );

      await notifyRegistrationCreated(registration);

      response.status(201).json({
        event: {
          publicId: registration.event.publicId,
          name: registration.event.name,
        },
        registration: {
          participantName: registration.registration.participantName,
          participantEmail: registration.registration.participantEmail,
          participantPhone: registration.registration.participantPhone,
          status: registration.registration.status,
          confirmationCode: registration.registration.confirmationCode,
          cancellationToken: registration.registration.cancellationToken,
          createdAt: registration.registration.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

publicRouter.get("/registrations/confirmation/:confirmationCode", async (request, response, next) => {
  try {
    const registration = await prisma.registration.findUnique({
      where: { confirmationCode: request.params.confirmationCode.trim().toUpperCase() },
      select: {
        participantName: true,
        confirmationCode: true,
        status: true,
        createdAt: true,
        cancelledAt: true,
        checkedInAt: true,
        event: {
          select: {
            name: true,
            publicId: true,
            date: true,
            location: true,
          },
        },
      },
    });

    if (!registration) {
      throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada");
    }

    response.json({ registration });
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/registrations/cancel/:cancellationToken", async (request, response, next) => {
  try {
    const registration = await prisma.registration.findUnique({
      where: { cancellationToken: request.params.cancellationToken },
      select: {
        participantName: true,
        status: true,
        cancelledAt: true,
        event: { select: { name: true, publicId: true } },
      },
    });

    if (!registration) {
      throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada");
    }

    response.json({ registration });
  } catch (error) {
    next(error);
  }
});

publicRouter.post("/registrations/cancel/:cancellationToken", async (request, response, next) => {
  try {
    const cancellationToken = request.params.cancellationToken;
    const existing = await prisma.registration.findUnique({
      where: { cancellationToken },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Inscrição não encontrada");
    }

    if (existing.status === "ACTIVE") {
      await prisma.registration.updateMany({
        where: { id: existing.id, status: "ACTIVE" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }

    const registration = await prisma.registration.findUniqueOrThrow({
      where: { id: existing.id },
      select: {
        participantName: true,
        status: true,
        cancelledAt: true,
        event: { select: { name: true, publicId: true } },
      },
    });

    response.json({ registration });
  } catch (error) {
    next(error);
  }
});
