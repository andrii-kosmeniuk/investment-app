import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rawBody from "fastify-raw-body";
import { sql } from "drizzle-orm";
import type { ApiConfig } from "./config.js";
import type { ApiServices } from "./services.js";
import { registerMcpRoute } from "./routes/mcp.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export async function buildApi(
  config: ApiConfig,
  services: ApiServices,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.plaid-verification",
          "req.headers.persona-signature",
        ],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id",
  });

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST"],
  });
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await services.database.execute(sql`select 1`);
    return { status: "ready" };
  });

  await app.register(
    async (api) => {
      await registerWebhookRoutes(api, services, config);
      await registerMcpRoute(api, services, config);
    },
    { prefix: "/v1" },
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, "request failed");
    const candidate =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const status = candidate < 500 ? candidate : 500;
    const name =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      typeof error.name === "string"
        ? error.name
        : "request_error";
    return reply.code(status).send({
      error: status === 500 ? "internal_error" : name,
      requestId: request.id,
    });
  });
  return app;
}
