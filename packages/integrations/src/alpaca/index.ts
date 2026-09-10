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

  async createAccount(customerId: string): Promise<{ accountId: string; status: string }> {
    try {
      const result = await this.#request<{ id: string; status: string }>("/v1/accounts", {
        method: "POST",
        body: JSON.stringify({
          contact: { email_address: `${customerId}@sandbox.invalid` },
          identity: { given_name: "Sandbox", family_name: "Investor" },
          agreements: [],
          disclosures: {},
          trusted_contact: {},
        }),
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
