import { createHash } from "node:crypto";
import { endOfBusinessDay, microUnits, parseDecimal, valuePosition } from "@corgi/domain";
import { deriveCustomerBalances } from "../ledger/balances.js";
import type {
  AccountResolver,
  Clock,
  IdGenerator,
  LatestClose,
  LedgerAccountDirectory,
  LedgerRepository,
  PriceRepository,
  ValuationPositionSnapshot,
  ValuationRecord,
  ValuationRepository,
} from "../ports.js";

export interface ValueCustomerDeps {
  readonly ledger: LedgerRepository;
  readonly resolver: AccountResolver;
  readonly accounts: LedgerAccountDirectory;
  readonly prices: PriceRepository;
  readonly valuations: ValuationRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ValueCustomerCommand {
  readonly customerId: string;
  /** Business date to value, YYYY-MM-DD. */
  readonly asOfDate: string;
  /** Why this version exists: `scheduled`, `backfill`, `corrected_close:VTI@2026-09-08`, … */
  readonly reason: string;
}

export type ValueCustomerResult =
  | { readonly status: "recorded"; readonly valuation: ValuationRecord }
  | { readonly status: "unchanged"; readonly valuation: ValuationRecord }
  /** A held position has no close at all; no row is written. */
  | { readonly status: "unavailable"; readonly missingSymbols: readonly string[] }
  /** Nothing to value yet: no cash, no positions, no history — the series starts with the first dollar. */
  | { readonly status: "empty" };

const PRICE_SCALE = 8;

/** Deterministic fingerprint of the exact price rows a valuation used. */
export function priceSetHash(closes: readonly LatestClose[]): string {
  const canonical = [...closes]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((close) => `${close.symbol}:${close.tradeDate}:v${close.version}:${close.price}`)
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

function sameSnapshot(a: readonly ValuationPositionSnapshot[], b: readonly ValuationPositionSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((position, index) => {
    const other = b[index]!;
    return (
      position.symbol === other.symbol &&
      position.unitsMicro === other.unitsMicro &&
      position.valueCents === other.valueCents &&
      position.priceStatus === other.priceStatus
    );
  });
}

/**
 * Values one customer on one business date from the ledger as it is known
 * *now* and the current version of each close on or before that date.
 *
 * Value = available-to-trade cash + dividend receivable + Σ position values.
 * Pending deposits are excluded (not yet the customer's), and the bounce
 * recovery account is the firm's claim, not the customer's asset.
 *
 * Writes a new version only when something changed, so the nightly run is
 * idempotent and a version 2+ always means "a number the customer may have seen
 * has moved". A position without any close yields no row at all: an absent
 * number is honest, an invented one is not.
 */
export async function valueCustomer(deps: ValueCustomerDeps, command: ValueCustomerCommand): Promise<ValueCustomerResult> {
  const now = deps.clock.now();
  const cutoff = { effectiveAt: endOfBusinessDay(command.asOfDate), publishedAt: now };

  const symbols = await deps.accounts.positionSymbols(command.customerId);
  const accounts = await deps.resolver.forCustomer(command.customerId, symbols);
  const balances = await deriveCustomerBalances({ ledger: deps.ledger }, command.customerId, accounts, symbols, cutoff);

  const held = [...balances.positionsMicro.keys()].sort();
  const nothingHeld =
    held.length === 0 &&
    balances.availableToTradeCents === 0n &&
    balances.dividendReceivableCents === 0n &&
    balances.pendingDepositCents === 0n;
  if (nothingHeld && (await deps.valuations.series(command.customerId, { to: command.asOfDate })).length === 0) {
    return { status: "empty" };
  }

  const closes = await deps.prices.latestCloses(held, command.asOfDate);
  const missingSymbols = held.filter((symbol) => !closes.has(symbol));
  if (missingSymbols.length > 0) return { status: "unavailable", missingSymbols };

  const positions: ValuationPositionSnapshot[] = held.map((symbol) => {
    const close = closes.get(symbol)!;
    const units = balances.positionsMicro.get(symbol) ?? 0n;
    return {
      symbol,
      unitsMicro: units,
      price: close.price,
      priceDate: close.tradeDate,
      priceVersion: close.version,
      priceStatus: close.status,
      valueCents: valuePosition(microUnits(units), parseDecimal(close.price, PRICE_SCALE)),
    };
  });

  const cashCents = balances.availableToTradeCents + balances.dividendReceivableCents;
  const valueCents = positions.reduce((sum, position) => sum + position.valueCents, cashCents);
  const status = positions.some((position) => position.priceStatus === "stale") ? "provisional" : "final";
  const hash = priceSetHash([...closes.values()]);

  const [latest] = (await deps.valuations.versions(command.customerId, command.asOfDate)).slice(-1);
  if (
    latest &&
    latest.valueCents === valueCents &&
    latest.cashCents === cashCents &&
    latest.priceSetHash === hash &&
    latest.status === status &&
    sameSnapshot(latest.positions, positions)
  ) {
    return { status: "unchanged", valuation: latest };
  }

  const valuation = await deps.valuations.insert({
    id: deps.ids.next(),
    customerId: command.customerId,
    asOfDate: command.asOfDate,
    valueCents,
    cashCents,
    positions,
    priceSetHash: hash,
    status,
    version: (latest?.version ?? 0) + 1,
    supersedesId: latest?.id ?? null,
    reason: command.reason,
  });
  return { status: "recorded", valuation };
}
