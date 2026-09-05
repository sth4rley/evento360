import { HttpError } from "../errors/http-error.js";

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} é obrigatório`);
  }
  return value.trim();
}

export function validUsername(value: unknown): string {
  const username = requiredString(value, "Login").toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Login deve ter de 3 a 30 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado",
    );
  }
  return username;
}

export function validEmail(value: unknown): string {
  const email = requiredString(value, "E-mail").toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "VALIDATION_ERROR", "E-mail inválido");
  }
  return email;
}

export function validName(value: unknown): string {
  const name = requiredString(value, "Nome");
  if (name.length < 2 || name.length > 100) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Nome deve ter entre 2 e 100 caracteres",
    );
  }
  return name;
}

export function validNewPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Senha deve ter entre 8 e 128 caracteres",
    );
  }
  return value;
}
