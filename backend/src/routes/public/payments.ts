import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../errors/http-error.js";
import crypto from "node:crypto";
import { createRegistration } from "../../domain/registrations.js";
import { optionalParticipantAuth } from "../../middlewares/require-auth.js";

export const paymentsRouter = Router();

function serializePayment(payment: any) {
  return {
    id: payment.id,
    participantName: payment.participantName,
    amountInCents: payment.amountInCents,
    platformFeeInCents: payment.platformFeeInCents,
    method: payment.method,
    status: payment.status,
    installments: payment.installments,
    cardLastFour: payment.cardLastFour,
    externalReference: payment.externalReference,
    expiresAt: payment.expiresAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() || null,
    refundedAt: payment.refundedAt?.toISOString() || null,
    waitlisted: payment.waitlisted,
    waitlistPosition: null,
    event: {
      publicId: payment.event.publicId,
      name: payment.event.name,
      date: payment.event.date.toISOString(),
      location: payment.event.location,
    },
    registration: payment.registration ? {
      confirmationCode: payment.registration.confirmationCode,
      cancellationToken: payment.registration.cancellationToken,
      status: payment.registration.status,
    } : null,
  };
}

paymentsRouter.post("/events/:publicId/payment-intents", ...optionalParticipantAuth, async (request: any, response: any, next: any) => {
  try {
    const event = await prisma.event.findFirst({
      where: { publicId: request.params.publicId, status: "PUBLISHED" },
    });
    if (!event) throw new HttpError(404, "EVENT_NOT_FOUND", "Evento não encontrado");
    if (!event.isPaid) throw new HttpError(400, "EVENT_NOT_PAID", "Evento não é pago");

    const input = request.body as any;
    const accessToken = crypto.randomBytes(32).toString("hex");

    const payment = await prisma.payment.create({
      data: {
        eventId: event.id,
        participantName: input.participantName || "",
        participantEmail: input.participantEmail || "",
        participantPhone: input.participantPhone || null,
        amountInCents: event.priceInCents || 0,
        status: "PENDING",
        accessToken,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
      include: { event: true, registration: true },
    });

    response.status(201).json({ payment: serializePayment(payment), accessToken });
  } catch (error) { next(error); }
});

paymentsRouter.get("/payments/:id", async (request: any, response: any, next: any) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: request.params.id },
      include: { event: true, registration: true },
    });
    if (!payment) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Pagamento não encontrado");
    if (payment.accessToken !== request.headers["x-payment-token"]) {
      throw new HttpError(401, "UNAUTHORIZED", "Token inválido");
    }

    response.json({ payment: serializePayment(payment) });
  } catch (error) { next(error); }
});

paymentsRouter.post("/payments/:id/process", async (request: any, response: any, next: any) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: request.params.id },
      include: { event: true, registration: true },
    });
    if (!payment) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Pagamento não encontrado");
    if (payment.accessToken !== request.headers["x-payment-token"]) {
      throw new HttpError(401, "UNAUTHORIZED", "Token inválido");
    }

    if (payment.status === "APPROVED") {
      return response.json({ payment: serializePayment(payment) });
    }

    const input = request.body as any;

    const registrationRes = await createRegistration(
      payment.event.publicId,
      {
        participantName: payment.participantName,
        participantEmail: payment.participantEmail,
        participantPhone: payment.participantPhone || "",
        joinWaitlist: payment.waitlisted,
      },
      request.auth?.accountId ?? null
    );

    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "APPROVED",
        method: input.method || "CREDIT_CARD",
        cardLastFour: input.card?.slice(-4) || null,
        installments: input.installments || 1,
        paidAt: new Date(),
        registrationId: registrationRes.registration.id,
      },
      include: { event: true, registration: true },
    });

    response.json({ payment: serializePayment(updatedPayment) });
  } catch (error) { next(error); }
});
