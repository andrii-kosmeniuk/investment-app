import type {
  DailyClose,
  LatestClose,
  LedgerAccountDirectory,
  ModelCatalog,
  ModelDefinition,
  OpenOrder,
  OrderListing,
  PortfolioAssignment,
  PortfolioAssignmentRepository,
  PriceRepository,
  RecordedClose,
  StoredClose,
} from "@corgi/application";
import { type OrderState, parseDecimal } from "@corgi/domain";
import { and, desc, eq, gte, inArray, isNotNull, lte, notInArray } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import {
  customerPortfolios,
  ledgerAccounts,
  modelAllocations,
  modelPortfolios,
  orders,
  prices,
} from "../schema.js";

export class DrizzleModelCatalog implements ModelCatalog {
  constructor(private readonly db: TransactionalDatabase) {}

  async list(): Promise<readonly ModelDefinition[]> {
    const models = await this.db.select().from(modelPortfolios).orderBy(modelPortfolios.riskLevel, modelPortfolios.code);
    if (models.length === 0) return [];
    const allocations = await this.db
      .select()
      .from(modelAllocations)
      .where(inArray(modelAllocations.modelId, models.map((model) => model.id)))
      .orderBy(desc(modelAllocations.targetWeightBps), modelAllocations.symbol);
    return models.map((model) => ({
      id: model.id,
      code: model.code,
      name: model.name,
      riskLevel: model.riskLevel,
      cashBufferBps: model.cashBufferBps,
      allocations: allocations
        .filter((allocation) => allocation.modelId === model.id)
        .map((allocation) => ({
          symbol: allocation.symbol,
          targetWeightBps: allocation.targetWeightBps,
          minimumTradeCents: allocation.minimumTradeCents,
          fractionalAllowed: allocation.fractionalAllowed,
        })),
    }));
  }

  async findByCode(code: string): Promise<ModelDefinition | null> {
    const models = await this.list();
    return models.find((model) => model.code === code) ?? null;
  }

  async findById(id: string): Promise<ModelDefinition | null> {
    const models = await this.list();
    return models.find((model) => model.id === id) ?? null;
  }
}

export class DrizzlePortfolioAssignmentRepository implements PortfolioAssignmentRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async findForCustomer(customerId: string): Promise<PortfolioAssignment | null> {
    const [row] = await this.db
      .select()
      .from(customerPortfolios)
      .where(eq(customerPortfolios.customerId, customerId))
      .limit(1);
    if (!row) return null;
    return {
      customerId: row.customerId,
      modelId: row.modelId,
      brokerAccountId: row.brokerAccountId,
      status: row.status === "closed" ? "closed" : "open",
    };
  }

  async assign(assignment: PortfolioAssignment): Promise<void> {
    await this.db
      .insert(customerPortfolios)
      .values({
        customerId: assignment.customerId,
        modelId: assignment.modelId,
        brokerAccountId: assignment.brokerAccountId,
        status: assignment.status,
        openedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: customerPortfolios.customerId,
        set: {
          modelId: assignment.modelId,
          brokerAccountId: assignment.brokerAccountId,
          status: assignment.status,
        },
      });
  }
}

/** A close older than this, relative to the valuation date, is shown as stale. */
const STALE_AFTER_DAYS = 3;

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.UTC(
    Number(fromIsoDate.slice(0, 4)),
    Number(fromIsoDate.slice(5, 7)) - 1,
    Number(fromIsoDate.slice(8, 10)),
  );
  const to = Date.UTC(Number(toIsoDate.slice(0, 4)), Number(toIsoDate.slice(5, 7)) - 1, Number(toIsoDate.slice(8, 10)));
  return Math.round((to - from) / 86_400_000);
}

const PRICE_SCALE = 8;

type PriceRow = typeof prices.$inferSelect;

function toStoredClose(row: PriceRow): StoredClose {
  return {
    id: row.id,
    symbol: row.symbol,
    tradeDate: row.tradeDate,
    price: row.close,
    source: row.source,
    version: row.version,
    supersedesId: row.supersedesId,
    receivedAt: row.receivedAt,
  };
}

export class DrizzlePriceRepository implements PriceRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  /**
   * Latest close per symbol on or before `asOf`, highest version wins (a
   * corrected close supersedes the original for the same date). A close more
   * than three calendar days old — a weekend plus a holiday — is marked stale.
   */
  async latestCloses(symbols: readonly string[], asOf: string): Promise<ReadonlyMap<string, LatestClose>> {
    if (symbols.length === 0) return new Map();
    const rows = await this.db
      .select({ symbol: prices.symbol, tradeDate: prices.tradeDate, close: prices.close, version: prices.version })
      .from(prices)
      .where(and(inArray(prices.symbol, symbols), lte(prices.tradeDate, asOf)))
      .orderBy(prices.symbol, desc(prices.tradeDate), desc(prices.version));

    const latest = new Map<string, LatestClose>();
    for (const row of rows) {
      if (latest.has(row.symbol)) continue;
      latest.set(row.symbol, {
        symbol: row.symbol,
        price: row.close,
        tradeDate: row.tradeDate,
        version: row.version,
        status: daysBetween(row.tradeDate, asOf) > STALE_AFTER_DAYS ? "stale" : "final",
      });
    }
    return latest;
  }

  /**
   * Appends closes as versions. Equality is decided on the exact 8-place value,
   * so a feed re-sending "255" for a stored "255.00000000" is a no-op while a
   * genuine correction becomes version n+1 pointing at the row it supersedes.
   * The unique (symbol, date, version) index makes a concurrent double-write
   * lose quietly instead of forking the chain.
   */
  async record(closes: readonly DailyClose[], receivedAt: Date): Promise<readonly RecordedClose[]> {
    const written: RecordedClose[] = [];
    for (const close of closes) {
      const current = await this.current(close.symbol, close.tradeDate);
      if (current && parseDecimal(current.price, PRICE_SCALE) === parseDecimal(close.price, PRICE_SCALE)) continue;
      const [row] = await this.db
        .insert(prices)
        .values({
          symbol: close.symbol,
          tradeDate: close.tradeDate,
          close: close.price,
          source: close.source,
          version: (current?.version ?? 0) + 1,
          supersedesId: current?.id ?? null,
          receivedAt,
          status: "final",
        })
        .onConflictDoNothing({ target: [prices.symbol, prices.tradeDate, prices.version] })
        .returning();
      if (row) written.push({ ...toStoredClose(row), corrected: current !== null });
    }
    return written;
  }

  async listForSymbol(symbol: string, fromDate: string): Promise<readonly StoredClose[]> {
    const rows = await this.db
      .select()
      .from(prices)
      .where(and(eq(prices.symbol, symbol), gte(prices.tradeDate, fromDate)))
      .orderBy(prices.tradeDate, desc(prices.version));
    const latestPerDate: StoredClose[] = [];
    for (const row of rows) {
      if (latestPerDate.at(-1)?.tradeDate === row.tradeDate) continue;
      latestPerDate.push(toStoredClose(row));
    }
    return latestPerDate;
  }

  private async current(symbol: string, tradeDate: string): Promise<StoredClose | null> {
    const [row] = await this.db
      .select()
      .from(prices)
      .where(and(eq(prices.symbol, symbol), eq(prices.tradeDate, tradeDate)))
      .orderBy(desc(prices.version))
      .limit(1);
    return row ? toStoredClose(row) : null;
  }
}

export class DrizzleLedgerAccountDirectory implements LedgerAccountDirectory {
  constructor(private readonly db: TransactionalDatabase) {}

  async pathsById(accountIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (accountIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: ledgerAccounts.id, path: ledgerAccounts.path })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, [...accountIds]));
    return new Map(rows.map((row) => [row.id, row.path]));
  }

  async positionSymbols(customerId: string): Promise<readonly string[]> {
    const rows = await this.db
      .select({ symbol: ledgerAccounts.commodityConstraint })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.customerId, customerId), eq(ledgerAccounts.kind, "position")));
    return rows.flatMap((row) => (row.symbol ? [row.symbol] : [])).sort();
  }

  async allPositionSymbols(): Promise<readonly string[]> {
    const rows = await this.db
      .selectDistinct({ symbol: ledgerAccounts.commodityConstraint })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.kind, "position"), isNotNull(ledgerAccounts.customerId)));
    return rows.flatMap((row) => (row.symbol ? [row.symbol] : [])).sort();
  }

  async customersWithAccounts(): Promise<readonly string[]> {
    const rows = await this.db
      .selectDistinct({ customerId: ledgerAccounts.customerId })
      .from(ledgerAccounts)
      .where(isNotNull(ledgerAccounts.customerId));
    return rows.flatMap((row) => (row.customerId ? [row.customerId] : [])).sort();
  }

  async customersHolding(symbol: string): Promise<readonly string[]> {
    const rows = await this.db
      .selectDistinct({ customerId: ledgerAccounts.customerId })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.kind, "position"),
          eq(ledgerAccounts.commodityConstraint, symbol),
          isNotNull(ledgerAccounts.customerId),
        ),
      );
    return rows.flatMap((row) => (row.customerId ? [row.customerId] : [])).sort();
  }
}

const CLOSED_STATES: readonly OrderState[] = ["filled", "cancelled", "rejected", "expired"];

export class DrizzleOrderListing implements OrderListing {
  constructor(private readonly db: TransactionalDatabase) {}

  async listOpenForCustomer(customerId: string): Promise<readonly OpenOrder[]> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customerId), notInArray(orders.state, [...CLOSED_STATES])))
      .orderBy(desc(orders.createdAt));
    return rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side as "buy" | "sell",
      requestedNotionalCents: row.requestedNotionalCents ?? 0n,
      state: row.state as OrderState,
    }));
  }
}
