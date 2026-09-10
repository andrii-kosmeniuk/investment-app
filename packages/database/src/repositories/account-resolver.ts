import type { AccountResolver } from "@corgi/application";
import type { ClearingAccounts, CustomerLedgerAccounts } from "@corgi/domain";
import { inArray } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { ledgerAccounts } from "../schema.js";

interface AccountSpec {
  readonly path: string;
  readonly kind: string;
  readonly commodityConstraint: string | null;
  readonly customerId: string | null;
}

const USD = "USD";

/**
 * Resolves stable ledger-account ids by canonical path, creating any missing
 * account on demand (idempotent on the unique `path`). Callers pass the symbols
 * they need so per-symbol accounts are ensured before the synchronous
 * `position()` / `tradingUnits()` lookups run.
 */
export class DrizzleAccountResolver implements AccountResolver {
  constructor(private readonly db: TransactionalDatabase) {}

  private async ensure(specs: readonly AccountSpec[]): Promise<Map<string, string>> {
    await this.db
      .insert(ledgerAccounts)
      .values(
        specs.map((spec) => ({
          customerId: spec.customerId,
          path: spec.path,
          kind: spec.kind,
          commodityConstraint: spec.commodityConstraint,
        })),
      )
      .onConflictDoNothing({ target: ledgerAccounts.path });

    const rows = await this.db
      .select({ id: ledgerAccounts.id, path: ledgerAccounts.path })
      .from(ledgerAccounts)
      .where(
        inArray(
          ledgerAccounts.path,
          specs.map((spec) => spec.path),
        ),
      );
    return new Map(rows.map((row) => [row.path, row.id]));
  }

  async forCustomer(
    customerId: string,
    symbols: readonly string[],
  ): Promise<CustomerLedgerAccounts> {
    const prefix = `customer:${customerId}`;
    const specs: AccountSpec[] = [
      { path: `${prefix}:cash:settled`, kind: "cash", commodityConstraint: USD, customerId },
      { path: `${prefix}:cash:pending`, kind: "cash", commodityConstraint: USD, customerId },
      { path: `${prefix}:cash:unsettled-buys`, kind: "cash", commodityConstraint: USD, customerId },
      { path: `${prefix}:cash:unsettled-sells`, kind: "cash", commodityConstraint: USD, customerId },
      { path: `${prefix}:receivable:dividend`, kind: "receivable", commodityConstraint: USD, customerId },
      { path: `${prefix}:receivable:bounce`, kind: "receivable", commodityConstraint: USD, customerId },
      { path: `${prefix}:income:dividend`, kind: "income", commodityConstraint: USD, customerId },
      { path: `${prefix}:expense:fee`, kind: "expense", commodityConstraint: USD, customerId },
    ];
    for (const symbol of symbols) {
      specs.push({
        path: `${prefix}:position:${symbol}`,
        kind: "position",
        commodityConstraint: symbol,
        customerId,
      });
    }

    const ids = await this.ensure(specs);
    const get = (path: string): string => {
      const id = ids.get(path);
      if (!id) throw new Error(`unresolved ledger account: ${path}`);
      return id;
    };

    return {
      settledCash: get(`${prefix}:cash:settled`),
      pendingDeposit: get(`${prefix}:cash:pending`),
      unsettledBuys: get(`${prefix}:cash:unsettled-buys`),
      unsettledSells: get(`${prefix}:cash:unsettled-sells`),
      dividendReceivable: get(`${prefix}:receivable:dividend`),
      bounceRecovery: get(`${prefix}:receivable:bounce`),
      dividendIncome: get(`${prefix}:income:dividend`),
      feeExpense: get(`${prefix}:expense:fee`),
      position: (symbol) => get(`${prefix}:position:${symbol}`),
    };
  }

  async clearing(symbols: readonly string[]): Promise<ClearingAccounts> {
    const specs: AccountSpec[] = [
      { path: "firm:clearing:plaid-sweep", kind: "clearing", commodityConstraint: USD, customerId: null },
      { path: "firm:clearing:trading-usd", kind: "clearing", commodityConstraint: USD, customerId: null },
      { path: "firm:clearing:rounding", kind: "clearing", commodityConstraint: USD, customerId: null },
    ];
    for (const symbol of symbols) {
      specs.push(
        {
          path: `firm:clearing:trading-units:${symbol}`,
          kind: "clearing",
          commodityConstraint: symbol,
          customerId: null,
        },
        {
          path: `firm:custody:street:${symbol}`,
          kind: "custody",
          commodityConstraint: symbol,
          customerId: null,
        },
      );
    }

    const ids = await this.ensure(specs);
    const get = (path: string): string => {
      const id = ids.get(path);
      if (!id) throw new Error(`unresolved ledger account: ${path}`);
      return id;
    };

    return {
      plaidSweep: get("firm:clearing:plaid-sweep"),
      tradingUsd: get("firm:clearing:trading-usd"),
      rounding: get("firm:clearing:rounding"),
      tradingUnits: (symbol) => get(`firm:clearing:trading-units:${symbol}`),
      custodianStreet: (symbol) => get(`firm:custody:street:${symbol}`),
    };
  }
}
