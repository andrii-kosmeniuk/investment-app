/**
 * In-memory implementations of the price, valuation and period-return ports.
 * They honour the same version-chain contract as the Drizzle adapters, so
 * use-case and route tests exercise real semantics without Postgres. Imported
 * only from test code via `@corgi/application/testing`.
 */
import { daysBetween } from "@corgi/domain";
import type {
  DailyClose,
  LatestClose,
  PeriodReturnRecord,
  PeriodReturnRepository,
  PriceRepository,
  RecordedClose,
  ReturnPeriod,
  StoredClose,
  ValuationRange,
  ValuationRecord,
  ValuationRepository,
} from "../ports.js";

const STALE_AFTER_DAYS = 3;

export class InMemoryPriceRepository implements PriceRepository {
  readonly rows: StoredClose[] = [];
  private counter = 0;

  latestCloses(symbols: readonly string[], asOf: string): Promise<ReadonlyMap<string, LatestClose>> {
    const latest = new Map<string, LatestClose>();
    for (const symbol of symbols) {
      const candidates = this.rows
        .filter((row) => row.symbol === symbol && row.tradeDate <= asOf)
        .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.version - a.version);
      const row = candidates[0];
      if (!row) continue;
      latest.set(symbol, {
        symbol,
        price: row.price,
        tradeDate: row.tradeDate,
        version: row.version,
        status: daysBetween(row.tradeDate, asOf) > STALE_AFTER_DAYS ? "stale" : "final",
      });
    }
    return Promise.resolve(latest);
  }

  record(closes: readonly DailyClose[], receivedAt: Date): Promise<readonly RecordedClose[]> {
    const written: RecordedClose[] = [];
    for (const close of closes) {
      const current = this.current(close.symbol, close.tradeDate);
      if (current && current.price === close.price) continue;
      this.counter += 1;
      const row: StoredClose = {
        id: `price-${this.counter}`,
        symbol: close.symbol,
        tradeDate: close.tradeDate,
        price: close.price,
        source: close.source,
        version: (current?.version ?? 0) + 1,
        supersedesId: current?.id ?? null,
        receivedAt,
      };
      this.rows.push(row);
      written.push({ ...row, corrected: current !== null });
    }
    return Promise.resolve(written);
  }

  listForSymbol(symbol: string, fromDate: string): Promise<readonly StoredClose[]> {
    const dates = [...new Set(this.rows.filter((r) => r.symbol === symbol && r.tradeDate >= fromDate).map((r) => r.tradeDate))];
    return Promise.resolve(dates.sort().map((date) => this.current(symbol, date)!));
  }

  private current(symbol: string, tradeDate: string): StoredClose | null {
    return (
      this.rows
        .filter((row) => row.symbol === symbol && row.tradeDate === tradeDate)
        .sort((a, b) => b.version - a.version)[0] ?? null
    );
  }
}

export class InMemoryValuationRepository implements ValuationRepository {
  readonly rows: ValuationRecord[] = [];
  constructor(private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  series(customerId: string, range: ValuationRange): Promise<readonly ValuationRecord[]> {
    const visible = this.rows.filter(
      (row) =>
        row.customerId === customerId &&
        (range.from === undefined || row.asOfDate >= range.from) &&
        (range.to === undefined || row.asOfDate <= range.to) &&
        (range.publishedAt === undefined || row.computedAt <= range.publishedAt),
    );
    const byDate = new Map<string, ValuationRecord>();
    for (const row of visible) {
      const existing = byDate.get(row.asOfDate);
      if (!existing || row.version > existing.version) byDate.set(row.asOfDate, row);
    }
    return Promise.resolve([...byDate.values()].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate)));
  }

  versions(customerId: string, asOfDate: string): Promise<readonly ValuationRecord[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.customerId === customerId && row.asOfDate === asOfDate).sort((a, b) => a.version - b.version),
    );
  }

  insert(record: Omit<ValuationRecord, "computedAt">): Promise<ValuationRecord> {
    const row: ValuationRecord = { ...record, computedAt: this.clock.now() };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  listRestated(limit: number): Promise<readonly ValuationRecord[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.version > 1)
        .sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())
        .slice(0, limit),
    );
  }
}

export class InMemoryPeriodReturnRepository implements PeriodReturnRepository {
  readonly rows: PeriodReturnRecord[] = [];
  constructor(private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  latest(customerId: string, period: ReturnPeriod, periodEnd: string, publishedAt?: Date): Promise<PeriodReturnRecord | null> {
    const rows = this.rows
      .filter(
        (row) =>
          row.customerId === customerId &&
          row.period === period &&
          row.periodEnd === periodEnd &&
          (publishedAt === undefined || row.computedAt <= publishedAt),
      )
      .sort((a, b) => b.version - a.version);
    return Promise.resolve(rows[0] ?? null);
  }

  versions(customerId: string, period: ReturnPeriod, periodEnd: string): Promise<readonly PeriodReturnRecord[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.customerId === customerId && row.period === period && row.periodEnd === periodEnd)
        .sort((a, b) => a.version - b.version),
    );
  }

  insert(record: Omit<PeriodReturnRecord, "computedAt">): Promise<PeriodReturnRecord> {
    const row: PeriodReturnRecord = { ...record, computedAt: this.clock.now() };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  listRestated(limit: number): Promise<readonly PeriodReturnRecord[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.version > 1)
        .sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())
        .slice(0, limit),
    );
  }
}
