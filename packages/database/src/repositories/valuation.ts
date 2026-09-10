import type {
  PeriodReturnRecord,
  PeriodReturnRepository,
  ReturnPeriod,
  ValuationPositionSnapshot,
  ValuationRecord,
  ValuationRepository,
  ValuationStatus,
} from "@corgi/application";
import { and, asc, desc, eq, gt, gte, lte } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { periodReturns, valuations } from "../schema.js";

/* ------------------------------------------------------------------ */
/* Valuations                                                           */
/* ------------------------------------------------------------------ */

interface StoredPosition {
  symbol: string;
  unitsMicro: string;
  price: string;
  priceDate: string;
  priceVersion: number;
  priceStatus: "final" | "stale";
  valueCents: string;
}

function toStored(position: ValuationPositionSnapshot): StoredPosition {
  return {
    symbol: position.symbol,
    unitsMicro: position.unitsMicro.toString(),
    price: position.price,
    priceDate: position.priceDate,
    priceVersion: position.priceVersion,
    priceStatus: position.priceStatus,
    valueCents: position.valueCents.toString(),
  };
}

function fromStored(positions: unknown): readonly ValuationPositionSnapshot[] {
  if (!Array.isArray(positions)) return [];
  return (positions as StoredPosition[]).map((position) => ({
    symbol: position.symbol,
    unitsMicro: BigInt(position.unitsMicro),
    price: position.price,
    priceDate: position.priceDate,
    priceVersion: position.priceVersion,
    priceStatus: position.priceStatus,
    valueCents: BigInt(position.valueCents),
  }));
}

type ValuationRow = typeof valuations.$inferSelect;

function toValuation(row: ValuationRow): ValuationRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    asOfDate: row.asOfDate,
    valueCents: row.valueCents,
    cashCents: row.cashCents,
    positions: fromStored(row.positions),
    priceSetHash: row.priceSetHash,
    status: row.status as ValuationStatus,
    version: row.version,
    supersedesId: row.supersedesId,
    reason: row.reason,
    computedAt: row.computedAt,
  };
}

/**
 * Versioned valuations. Rows are append-only (trigger + revoked grants); the
 * "current" figure for a date is simply its highest version, and the figure
 * "as published on D" is the highest version computed on or before D.
 */
export class DrizzleValuationRepository implements ValuationRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async series(customerId: string, range: { from?: string; to?: string; publishedAt?: Date }): Promise<readonly ValuationRecord[]> {
    const predicates = [eq(valuations.customerId, customerId)];
    if (range.from) predicates.push(gte(valuations.asOfDate, range.from));
    if (range.to) predicates.push(lte(valuations.asOfDate, range.to));
    if (range.publishedAt) predicates.push(lte(valuations.computedAt, range.publishedAt));
    const rows = await this.db
      .select()
      .from(valuations)
      .where(and(...predicates))
      .orderBy(asc(valuations.asOfDate), desc(valuations.version));
    const latestPerDate: ValuationRecord[] = [];
    for (const row of rows) {
      if (latestPerDate.at(-1)?.asOfDate === row.asOfDate) continue;
      latestPerDate.push(toValuation(row));
    }
    return latestPerDate;
  }

  async versions(customerId: string, asOfDate: string): Promise<readonly ValuationRecord[]> {
    const rows = await this.db
      .select()
      .from(valuations)
      .where(and(eq(valuations.customerId, customerId), eq(valuations.asOfDate, asOfDate)))
      .orderBy(asc(valuations.version));
    return rows.map(toValuation);
  }

  async insert(record: Omit<ValuationRecord, "computedAt">): Promise<ValuationRecord> {
    const [row] = await this.db
      .insert(valuations)
      .values({
        id: record.id,
        customerId: record.customerId,
        asOfDate: record.asOfDate,
        valueCents: record.valueCents,
        cashCents: record.cashCents,
        positions: record.positions.map(toStored),
        priceSetHash: record.priceSetHash,
        status: record.status,
        version: record.version,
        supersedesId: record.supersedesId,
        reason: record.reason,
      })
      .returning();
    if (!row) throw new Error("valuation insert returned no row");
    return toValuation(row);
  }

  async listRestated(limit: number): Promise<readonly ValuationRecord[]> {
    const rows = await this.db
      .select()
      .from(valuations)
      .where(gt(valuations.version, 1))
      .orderBy(desc(valuations.computedAt))
      .limit(limit);
    return rows.map(toValuation);
  }
}

/* ------------------------------------------------------------------ */
/* Period returns                                                       */
/* ------------------------------------------------------------------ */

type PeriodReturnRow = typeof periodReturns.$inferSelect;

function toPeriodReturn(row: PeriodReturnRow): PeriodReturnRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    period: row.period as ReturnPeriod,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    twrBpsE4: row.twrBpsE4,
    mwrBpsE4: row.mwrBpsE4,
    flowsCents: row.flowsCents,
    version: row.version,
    supersedesId: row.supersedesId,
    reason: row.reason,
    computedAt: row.computedAt,
  };
}

export class DrizzlePeriodReturnRepository implements PeriodReturnRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async latest(customerId: string, period: ReturnPeriod, periodEnd: string, publishedAt?: Date): Promise<PeriodReturnRecord | null> {
    const predicates = [
      eq(periodReturns.customerId, customerId),
      eq(periodReturns.period, period),
      eq(periodReturns.periodEnd, periodEnd),
    ];
    if (publishedAt) predicates.push(lte(periodReturns.computedAt, publishedAt));
    const [row] = await this.db
      .select()
      .from(periodReturns)
      .where(and(...predicates))
      .orderBy(desc(periodReturns.version))
      .limit(1);
    return row ? toPeriodReturn(row) : null;
  }

  async versions(customerId: string, period: ReturnPeriod, periodEnd: string): Promise<readonly PeriodReturnRecord[]> {
    const rows = await this.db
      .select()
      .from(periodReturns)
      .where(and(eq(periodReturns.customerId, customerId), eq(periodReturns.period, period), eq(periodReturns.periodEnd, periodEnd)))
      .orderBy(asc(periodReturns.version));
    return rows.map(toPeriodReturn);
  }

  async insert(record: Omit<PeriodReturnRecord, "computedAt">): Promise<PeriodReturnRecord> {
    const [row] = await this.db
      .insert(periodReturns)
      .values({
        id: record.id,
        customerId: record.customerId,
        period: record.period,
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        twrBpsE4: record.twrBpsE4,
        mwrBpsE4: record.mwrBpsE4,
        flowsCents: record.flowsCents,
        version: record.version,
        supersedesId: record.supersedesId,
        reason: record.reason,
      })
      .returning();
    if (!row) throw new Error("period_return insert returned no row");
    return toPeriodReturn(row);
  }

  async listRestated(limit: number): Promise<readonly PeriodReturnRecord[]> {
    const rows = await this.db
      .select()
      .from(periodReturns)
      .where(gt(periodReturns.version, 1))
      .orderBy(desc(periodReturns.computedAt))
      .limit(limit);
    return rows.map(toPeriodReturn);
  }
}
