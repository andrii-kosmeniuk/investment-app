import type {
  BrokerPort,
  BrokerPosition,
  ProviderEvent,
} from "@corgi/application";
import { z } from "zod";
import { ProviderHttpError, createProviderClient } from "../http.js";

export interface AlpacaConfig {
  readonly baseUrl: string;
  readonly key: string;
  readonly secret: string;
  /**
   * Sandbox only. Some Broker sandbox tenants answer `403 request is forbidden`
   * to `POST /v1/accounts` until Alpaca completes the correspondent setup. When
   * set, that pre-provisioned dashboard account is used instead of failing, so
   * the order rail can still be exercised end to end (ADR-0004 assumptions).
   */
  readonly sandboxAccountId?: string | undefined;
  /** Source of "now" for agreement timestamps; defaults to the system clock. */
  readonly clock?: (() => Date) | undefined;
}

/**
 * Deterministic 9-digit tax id derived from the customer id that passes
 * Alpaca's SSN format rules: area not 000/666/9xx, group not 00, serial not
 * 0000, and no run of consecutive or identical digits.
 */
export function sandboxTaxId(customerId: string): string {
  let hash = 2166136261;
  for (const char of customerId) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  const area = 100 + (hash % 566); // 100..665
  const group = 10 + ((hash >>> 8) % 90); // 10..99
  let serial = 1000 + ((hash >>> 16) % 9000); // 1000..9999
  let digits = `${area}${String(group).padStart(2, "0")}${serial}`;
  const monotone = (value: string) =>
    [...value].every((d, i, all) => i === 0 || Number(d) === Number(all[i - 1]) + 1) ||
    [...value].every((d, i, all) => i === 0 || Number(d) === Number(all[i - 1]) - 1) ||
    new Set(value).size === 1;
  if (monotone(digits)) {
    serial = serial === 9999 ? 1001 : serial + 1;
    digits = `${area}${String(group).padStart(2, "0")}${serial}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * Sandbox account application. The identity is a placeholder keyed to the
 * customer id: the customer's real KYC lives in Persona (ADR-0002) and the
 * brief does not ask us to forward it to the broker, so only the fields Alpaca
 * requires to open a fully-disclosed sandbox account are sent.
 */
export function sandboxAccountApplication(customerId: string, now: Date) {
  return {
    contact: {
      email_address: `corgi+${customerId}@example.com`,
      phone_number: "555-666-7788",
      street_address: ["20 N San Mateo Dr"],
      city: "San Mateo",
      state: "CA",
      postal_code: "94401",
      country: "USA",
    },
    identity: {
      given_name: "Sandbox",
      family_name: `Customer ${customerId.slice(0, 8)}`,
      date_of_birth: "1990-01-01",
      tax_id: sandboxTaxId(customerId),
      tax_id_type: "USA_SSN",
      country_of_citizenship: "USA",
      country_of_birth: "USA",
      country_of_tax_residence: "USA",
      funding_source: ["employment_income"],
    },
    disclosures: {
      is_control_person: false,
      is_affiliated_exchange_or_finra: false,
      is_politically_exposed: false,
      immediate_family_exposed: false,
    },
    agreements: [
      { agreement: "customer_agreement", signed_at: now.toISOString(), ip_address: "127.0.0.1" },
    ],
    enabled_assets: ["us_equity"],
  };
}

const positionSchema = z.object({
  symbol: z.string(),
  qty: z.string(),
});

export class AlpacaBrokerAdapter implements BrokerPort {
  readonly #request;
  readonly #config: AlpacaConfig;

  constructor(config: AlpacaConfig) {
    this.#config = config;
    this.#request = createProviderClient("alpaca", {
      baseUrl: config.baseUrl,
      headers: {
        "APCA-API-KEY-ID": config.key,
        "APCA-API-SECRET-KEY": config.secret,
      },
    });
  }

  async ensureAccount(customerId: string, existingAccountId?: string | null): Promise<{ accountId: string; status: string }> {
    if (this.#config.sandboxAccountId) {
      return { accountId: this.#config.sandboxAccountId, status: "ACTIVE" };
    }
    if (existingAccountId) return { accountId: existingAccountId, status: "ACTIVE" };
    return this.createAccount(customerId);
  }

  async createAccount(customerId: string): Promise<{ accountId: string; status: string }> {
    if (this.#config.sandboxAccountId) {
      return { accountId: this.#config.sandboxAccountId, status: "ACTIVE" };
    }
    try {
      const result = await this.#request<{ id: string; status: string }>("/v1/accounts", {
        method: "POST",
        body: JSON.stringify(sandboxAccountApplication(customerId, this.#config.clock?.() ?? new Date())),
      });
      return { accountId: result.id, status: result.status };
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 403 && this.#config.sandboxAccountId) {
        return { accountId: this.#config.sandboxAccountId, status: "ACTIVE" };
      }
      throw error;
    }
  }

  async submitNotionalOrder(input: {
    accountId: string;
    clientOrderId: string;
    symbol: string;
    notionalCents: bigint;
    side: "buy" | "sell";
  }): Promise<{ providerOrderId: string; status: "submitted" }> {
    const order = await this.#request<{ id: string }>(
      `/v1/trading/accounts/${input.accountId}/orders`,
      {
        method: "POST",
        body: JSON.stringify({
          symbol: input.symbol,
          notional: (Number(input.notionalCents) / 100).toFixed(2),
          side: input.side,
          type: "market",
          time_in_force: "day",
          client_order_id: input.clientOrderId,
        }),
      },
    );
    return { providerOrderId: order.id, status: "submitted" };
  }

  async getPositions(accountId: string): Promise<readonly BrokerPosition[]> {
    const raw = await this.#request<unknown[]>(
      `/v1/trading/accounts/${accountId}/positions`,
    );
    return raw.map((position) => {
      const parsed = positionSchema.parse(position);
      return {
        symbol: parsed.symbol,
        unitsMicro: BigInt(Math.round(Number(parsed.qty) * 1_000_000)),
      };
    });
  }

  async *streamTradeEvents(cursor?: string): AsyncIterable<ProviderEvent> {
    const url = new URL("/v2/events/trades", this.#config.baseUrl);
    if (cursor) url.searchParams.set("since_id", cursor);
    const response = await fetch(url, {
      headers: {
        accept: "text/event-stream",
        "APCA-API-KEY-ID": this.#config.key,
        "APCA-API-SECRET-KEY": this.#config.secret,
      },
    });
    if (!response.ok || !response.body) throw new Error(`Alpaca SSE failed: ${response.status}`);

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data) continue;
        const payload = JSON.parse(data) as Record<string, unknown>;
        const event = String(payload.event ?? "unknown");
        const id = String(payload.id ?? payload.execution_id ?? crypto.randomUUID());
        yield {
          id,
          type: event,
          occurredAt: new Date(String(payload.timestamp ?? new Date().toISOString())),
          payload,
          cursor: id,
        };
      }
    }
  }
}
