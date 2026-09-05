import { Router } from "express";
import { rateLimit } from "express-rate-limit";

// Per-process stores: multi-instance deployments also need a shared gateway limit.
export function createSecurityLimits() {
  const router = Router();
  const limiter = (limit: number, windowMs: number) => rateLimit({
    limit,
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Muitas tentativas. Aguarde e tente novamente." } },
  });

  const auth = limiter(20, 15 * 60_000);
  for (const scope of ["public", "admin"]) {
    for (const action of ["login", "register", "forgot-password", "reset-password"]) {
      router.post(`/api/${scope}/auth/${action}`, auth);
    }
  }
  router.use("/api/public/registrations", limiter(30, 15 * 60_000));
  router.post("/api/public/events/:publicId/registrations", limiter(20, 15 * 60_000));
  router.use("/api", limiter(300, 60_000));
  return router;
}
