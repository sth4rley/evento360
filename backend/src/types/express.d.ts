import type { AuthSession } from "../auth/types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthSession;
    }
  }
}

export {};
