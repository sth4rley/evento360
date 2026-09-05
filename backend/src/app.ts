import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createSecurityLimits } from "./middlewares/rate-limit.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { adminRouter } from "./routes/admin/index.js";
import { publicRouter } from "./routes/public/index.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmet({ strictTransportSecurity: env.nodeEnv === "production" ? undefined : false }));
app.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});
app.use(cors({ origin: env.frontendUrl }));
app.use(createSecurityLimits());
app.use(express.json({ limit: "100kb" }));
app.use("/api/public", publicRouter);
app.use("/api/admin", adminRouter);
app.use(errorHandler);
