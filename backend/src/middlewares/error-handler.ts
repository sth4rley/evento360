import type { ErrorRequestHandler } from "express";
import { HttpError } from "../errors/http-error.js";

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const knownError = error instanceof HttpError;
  const parserError = error?.type === "entity.parse.failed" || error?.type === "entity.too.large";
  const statusCode = knownError ? error.statusCode : parserError ? (error.type === "entity.too.large" ? 413 : 400) : 500;
  const code = knownError ? error.code : parserError ? "INVALID_REQUEST_BODY" : "INTERNAL_ERROR";
  const message = knownError ? error.message : parserError ? "Corpo da requisição inválido ou muito grande" : "Erro interno do servidor";

  if (!knownError) {
    request.app.get("logger")?.error?.({ code, statusCode });
  }

  response.status(statusCode).json({ error: { code, message } });
};
