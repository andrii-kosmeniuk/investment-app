import type { FastifyInstance } from "fastify";
import { verifyPersonaWebhook, verifyPlaidWebhook } from "@corgi/integrations";
import type { JWK } from "jose";
import type { ApiConfig } from "../config.js";
import type { ApiServices } from "../services.js";

interface EventBody {
  readonly id?: string;
  readonly event_id?: string | number;
  readonly type?: string;
  readonly webhook_type?: string;
  readonly webhook_code?: string;
  readonly data?: { readonly id?: string; readonly type?: string };
}

function eventIdentity(body: EventBody): { externalId: string; eventType: string } {
  const externalId = String(body.id ?? body.event_id ?? body.data?.id ?? "");
  const eventType = String(
    body.type ?? body.webhook_code ?? body.webhook_type ?? body.data?.type ?? "unknown",
  );
  if (!externalId) throw new Error("Webhook payload has no stable event identifier");
  return { externalId, eventType };
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  services: ApiServices,
  config: ApiConfig,
): Promise<void> {
  app.post("/webhooks/persona", { config: { rawBody: true } }, async (request, reply) => {
    const rawBody =
      typeof request.rawBody === "string"
        ? request.rawBody
        : request.rawBody?.toString("utf8");
    const signature = request.headers["persona-signature"];
    if (!rawBody || typeof signature !== "string") return reply.code(401).send({ error: "invalid_signature" });
    const valid = verifyPersonaWebhook({
      rawBody,
      signatureHeader: signature,
      secret: config.PERSONA_WEBHOOK_SECRET,
    });
    if (!valid) return reply.code(401).send({ error: "invalid_signature" });
    const body = JSON.parse(rawBody) as EventBody;
    const identity = eventIdentity(body);
    const status = await services.inbox.receive({
      provider: "persona",
      ...identity,
      dedupeKey: `persona:${identity.externalId}`,
      payload: body,
      signatureValid: true,
    });
    return reply.send({ status });
  });

  app.post("/webhooks/plaid", { config: { rawBody: true } }, async (request, reply) => {
    const rawBody =
      typeof request.rawBody === "string"
        ? request.rawBody
        : request.rawBody?.toString("utf8");
    const signedJwt = request.headers["plaid-verification"];
    if (!rawBody || typeof signedJwt !== "string") return reply.code(401).send({ error: "invalid_signature" });
    const valid = await verifyPlaidWebhook({
      rawBody,
      signedJwt,
      getVerificationKey: async (keyId) => {
        const response = await fetch(`${config.PLAID_BASE_URL}/webhook_verification_key/get`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: config.PLAID_CLIENT_ID,
            secret: config.PLAID_SECRET,
            key_id: keyId,
          }),
        });
        if (!response.ok) throw new Error(`Plaid key lookup failed: ${response.status}`);
        const body = (await response.json()) as { key: JWK };
        return body.key;
      },
    });
    if (!valid) return reply.code(401).send({ error: "invalid_signature" });
    const body = JSON.parse(rawBody) as EventBody;
    const identity = eventIdentity(body);
    const status = await services.inbox.receive({
      provider: "plaid",
      ...identity,
      dedupeKey: `plaid:${identity.externalId}`,
      payload: body,
      signatureValid: true,
    });
    return reply.send({ status });
  });
}
