import type {
  Clock,
  DailyClose,
  LedgerAccountDirectory,
  MarketDataPort,
  ModelCatalog,
  PriceRepository,
  RecordedClose,
} from "../ports.js";
import { type RestateDeps, type RestateResult, restate } from "./restate.js";

export interface RecordClosesDeps {
  readonly prices: PriceRepository;
  readonly clock: Clock;
}

export interface RecordClosesResult {
  readonly recorded: readonly RecordedClose[];
  /** Subset of `recorded` that superseded a different close for the same date. */
  readonly corrections: readonly RecordedClose[];
}

/** Stores closes; identical values are no-ops, differing ones become corrections. */
export async function recordCloses(deps: RecordClosesDeps, closes: readonly DailyClose[]): Promise<RecordClosesResult> {
  const recorded = await deps.prices.record(closes, deps.clock.now());
  return { recorded, corrections: recorded.filter((close) => close.corrected) };
}

export interface CollectClosesDeps extends RecordClosesDeps {
  readonly marketData: MarketDataPort;
  readonly accounts: LedgerAccountDirectory;
  readonly models: ModelCatalog;
}

/**
 * Pulls daily closes for every symbol we hold or could buy (model universe)
 * and records them. Re-pulling a window is safe: unchanged closes are skipped,
 * and a changed one is surfaced as a correction for the caller to restate.
 */
export async function collectDailyCloses(
  deps: CollectClosesDeps,
  window: { from: string; to: string },
): Promise<RecordClosesResult & { symbols: readonly string[] }> {
  const [held, models] = await Promise.all([deps.accounts.allPositionSymbols(), deps.models.list()]);
  const symbols = [...new Set([...held, ...models.flatMap((model) => model.allocations.map((a) => a.symbol))])].sort();
  if (symbols.length === 0) return { recorded: [], corrections: [], symbols };
  const closes = await deps.marketData.getDailyCloses({ symbols, from: window.from, to: window.to });
  return { ...(await recordCloses(deps, closes)), symbols };
}

export interface RestateForCorrectionsDeps extends RestateDeps {
  readonly accounts: LedgerAccountDirectory;
}

/**
 * A corrected close changes the value of everyone who held the symbol on or
 * after that date. Each affected customer is restated once, from the earliest
 * corrected date for any of their symbols.
 */
export async function restateForCorrectedCloses(
  deps: RestateForCorrectionsDeps,
  corrections: readonly RecordedClose[],
): Promise<readonly RestateResult[]> {
  const earliestBySymbol = new Map<string, string>();
  for (const correction of corrections) {
    const current = earliestBySymbol.get(correction.symbol);
    if (!current || correction.tradeDate < current) earliestBySymbol.set(correction.symbol, correction.tradeDate);
  }

  const byCustomer = new Map<string, { fromDate: string; symbols: string[] }>();
  for (const [symbol, fromDate] of earliestBySymbol) {
    for (const customerId of await deps.accounts.customersHolding(symbol)) {
      const existing = byCustomer.get(customerId);
      if (!existing) byCustomer.set(customerId, { fromDate, symbols: [symbol] });
      else {
        existing.symbols.push(symbol);
        if (fromDate < existing.fromDate) existing.fromDate = fromDate;
      }
    }
  }

  const results: RestateResult[] = [];
  for (const [customerId, { fromDate, symbols }] of byCustomer) {
    results.push(
      await restate(deps, { customerId, fromDate, reason: `corrected_close:${symbols.sort().join(",")}@${fromDate}` }),
    );
  }
  return results;
}
