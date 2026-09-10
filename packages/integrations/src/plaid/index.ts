import { createHash } from "node:crypto";
import { importJWK, jwtVerify, type JWK } from "jose";
import type { FundingPort, ProviderEvent } from "@corgi/application";
import { createProviderClient } from "../http.js";

export interface PlaidConfig {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly secret: string;
}

export async function verifyPlaidWebhook(input: {
  rawBody: string;
  signedJwt: string;
  getVerificationKey: (keyId: string) => Promise<JWK>;
}): Promise<boolean> {
  const [protectedHeader] = input.signedJwt.split(".");
  if (!protectedHeader) return false;
  const header = JSON.parse(
    Buffer.from(protectedHeader, "base64url").toString("utf8"),
  ) as { kid?: string; alg?: string };
  if (!header.kid || header.alg !== "ES256") return false;
  const key = await importJWK(await input.getVerificationKey(header.kid), "ES256");
  const { payload } = await jwtVerify(input.signedJwt, key, {
    algorithms: ["ES256"],
    maxTokenAge: "5 min",
  });
  const digest = createHash("sha256").update(input.rawBody).digest("hex");
  return payload.request_body_sha256 === digest;
}

export class PlaidFundingAdapter implements FundingPort {
  readonly #request;
  constructor(private readonly config: PlaidConfig) {
    this.#request = createProviderClient("plaid", {
      baseUrl: config.baseUrl,
      headers: {},
    });
  }

  #body(payload: Record<string, unknown>) {
    return JSON.stringify({
      client_id: this.config.clientId,
      secret: this.config.secret,
      ...payload,
    });
  }

  async createLinkToken(customerId: string): Promise<string> {
    const response = await this.#request<{ link_token: string }>("/link/token/create", {
      method: "POST",
      body: this.#body({
        client_name: "Corgi Invest",
        user: { client_user_id: customerId },
        products: ["auth", "transfer"],
        country_codes: ["US"],
        language: "en",
      }),
    });
    return response.link_token;
  }

  async createDeposit(input: {
    customerId: string;
    bankAccountId: string;
    amountCents: bigint;
    idempotencyKey: string;
  }): Promise<{ transferId: string; status: string }> {
    const response = await this.#request<{
      transfer: { id: string; status: string };
    }>("/transfer/create", {
      method: "POST",
      body: this.#body({
        account_id: input.bankAccountId,
        idempotency_key: input.idempotencyKey,
        amount: (Number(input.amountCents) / 100).toFixed(2),
        description: `Investment deposit ${input.customerId}`,
        type: "debit",
        network: "ach",
        ach_class: "web",
        user: { legal_name: "Sandbox Investor" },
      }),
    });
    return { transferId: response.transfer.id, status: response.transfer.status };
  }

  async syncEvents(cursor?: string): Promise<{
    events: readonly ProviderEvent[];
    nextCursor: string;
  }> {
    const response = await this.#request<{
      transfer_events: Array<{
        event_id: number;
        event_type: string;
        timestamp: string;
        transfer_id: string;
      }>;
      next_cursor: string;
    }>("/transfer/event/sync", {
      method: "POST",
      body: this.#body({ after_id: cursor ? Number(cursor) : 0 }),
    });
    return {
      events: response.transfer_events.map((event) => ({
        id: String(event.event_id),
        type: event.event_type,
        occurredAt: new Date(event.timestamp),
        payload: event,
        cursor: String(event.event_id),
      })),
      nextCursor: response.next_cursor,
    };
  }
}
