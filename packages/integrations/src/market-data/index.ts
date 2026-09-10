import type { DailyClose, MarketDataPort } from "@corgi/application";
import { createProviderClient } from "../http.js";

export interface AlpacaMarketDataConfig {
  readonly baseUrl: string;
  readonly key: string;
  readonly secret: string;
}

export class AlpacaMarketDataAdapter implements MarketDataPort {
  readonly #request;
  constructor(config: AlpacaMarketDataConfig) {
    this.#request = createProviderClient("alpaca-market-data", {
      baseUrl: config.baseUrl,
      headers: {
        "APCA-API-KEY-ID": config.key,
        "APCA-API-SECRET-KEY": config.secret,
      },
    });
  }

  async getDailyCloses(input: {
    symbols: readonly string[];
    from: string;
    to: string;
  }): Promise<readonly DailyClose[]> {
    const query = new URLSearchParams({
      symbols: input.symbols.join(","),
      timeframe: "1Day",
      start: input.from,
      end: input.to,
      feed: "iex",
    });
    const response = await this.#request<{
      bars: Record<string, Array<{ t: string; c: number }>>;
    }>(`/v2/stocks/bars?${query}`);
    return Object.entries(response.bars).flatMap(([symbol, bars]) =>
      bars.map((bar) => ({
        symbol,
        tradeDate: bar.t.slice(0, 10),
        price: bar.c.toFixed(8),
        source: "alpaca-iex",
      })),
    );
  }
}
