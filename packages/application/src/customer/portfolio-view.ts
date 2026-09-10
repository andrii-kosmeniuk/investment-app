import { microUnits, parseDecimal, valuePosition } from "@corgi/domain";
import type { CustomerBalances } from "../ledger/balances.js";
import type { LatestClose, ModelDefinition, OpenOrder } from "../ports.js";
import type { PerformanceView } from "./performance-view.js";

export interface PortfolioPositionView {
  readonly symbol: string;
  readonly unitsMicro: bigint;
  readonly price: LatestClose | null;
  readonly valueCents: bigint | null;
  readonly targetWeightBps: number | null;
  readonly actualWeightBps: number | null;
}

export interface PortfolioView {
  readonly customerId: string;
  readonly asOf: string;
  readonly publishedAt: Date;
  readonly value: {
    readonly cents: bigint | null;
    readonly status: "final" | "provisional" | "unavailable";
  };
  readonly cash: {
    readonly settledCents: bigint;
    readonly pendingDepositCents: bigint;
    readonly unsettledBuysCents: bigint;
    readonly unsettledSellsCents: bigint;
    readonly availableToInvestCents: bigint;
    readonly availableToWithdrawCents: bigint;
  };
  /** Latest stored valuation and period returns; null before the first nightly run. */
  readonly performance: PerformanceView | null;
  readonly model: { readonly code: string; readonly name: string } | null;
  readonly positions: readonly PortfolioPositionView[];
  readonly openOrders: readonly OpenOrder[];
}

export interface PortfolioViewInput {
  readonly customerId: string;
  readonly asOf: string;
  readonly publishedAt: Date;
  readonly balances: CustomerBalances;
  readonly prices: ReadonlyMap<string, LatestClose>;
  readonly model: Pick<ModelDefinition, "code" | "name" | "allocations"> | null;
  readonly openOrders: readonly OpenOrder[];
  readonly performance?: PerformanceView | null;
}

const PRICE_SCALE = 8;

/**
 * Assembles the customer's portfolio from ledger balances and the latest usable
 * closes. Nothing here invents a number: a position without a price has a null
 * value and pulls the headline down to "unavailable"; a stale close marks the
 * whole value "provisional". Pending deposits are shown but not counted as value.
 */
export function buildPortfolioView(input: PortfolioViewInput): PortfolioView {
  const { balances } = input;
  const symbols = [...balances.positionsMicro.keys()].sort();

  const valued = symbols.map((symbol) => {
    const units = balances.positionsMicro.get(symbol) ?? 0n;
    const price = input.prices.get(symbol) ?? null;
    const valueCents = price
      ? valuePosition(microUnits(units), parseDecimal(price.price, PRICE_SCALE))
      : null;
    return { symbol, units, price, valueCents };
  });

  const anyMissing = valued.some((position) => position.valueCents === null);
  const anyStale = valued.some((position) => position.price?.status === "stale");
  const positionsTotal = valued.reduce((sum, position) => sum + (position.valueCents ?? 0n), 0n);
  const totalCents = anyMissing ? null : balances.availableToTradeCents + positionsTotal;

  const targets = new Map(
    (input.model?.allocations ?? []).map((allocation) => [allocation.symbol, allocation.targetWeightBps]),
  );

  const positions: PortfolioPositionView[] = valued.map((position) => ({
    symbol: position.symbol,
    unitsMicro: position.units,
    price: position.price,
    valueCents: position.valueCents,
    targetWeightBps: targets.get(position.symbol) ?? null,
    actualWeightBps:
      totalCents && totalCents > 0n && position.valueCents !== null
        ? Number((position.valueCents * 10_000n) / totalCents)
        : null,
  }));

  return {
    customerId: input.customerId,
    asOf: input.asOf,
    publishedAt: input.publishedAt,
    value: {
      cents: totalCents,
      status: anyMissing ? "unavailable" : anyStale ? "provisional" : "final",
    },
    cash: {
      settledCents: balances.settledCents,
      pendingDepositCents: balances.pendingDepositCents,
      unsettledBuysCents: balances.unsettledBuysCents,
      unsettledSellsCents: balances.unsettledSellsCents,
      availableToInvestCents: balances.availableToTradeCents,
      availableToWithdrawCents: balances.withdrawableCents,
    },
    performance: input.performance ?? null,
    model: input.model ? { code: input.model.code, name: input.model.name } : null,
    positions,
    openOrders: input.openOrders,
  };
}
