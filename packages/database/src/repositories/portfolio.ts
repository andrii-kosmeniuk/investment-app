import type {
  LatestClose,
  LedgerAccountDirectory,
  ModelCatalog,
  ModelDefinition,
  OpenOrder,
  OrderListing,
  PortfolioAssignment,
  PortfolioAssignmentRepository,
  PriceRepository,
} from "@corgi/application";
import type { OrderState } from "@corgi/domain";
import { and, desc, eq, inArray, lte, notInArray } from "drizzle-orm";
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
        status: daysBetween(row.tradeDate, asOf) > STALE_AFTER_DAYS ? "stale" : "final",
      });
    }
    return latest;
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
