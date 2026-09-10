import {
  applySplit,
  atMarketClose,
  businessDate,
  divideHalfEven,
  formatDecimal,
  parseDecimal,
  postingPatterns,
} from "@corgi/domain";
import { ValidationError } from "../errors.js";
import { deriveCustomerBalances } from "../ledger/balances.js";
import { postJournalEntry } from "../ledger/post-entry.js";
import type { AppendResult, TaxLotRepository } from "../ports.js";
import { type RestateDeps, type RestateResult, restate } from "./restate.js";

const PRICE_SCALE = 8;
/** basis (cents, 1e2) ÷ units (micro, 1e6) → USD per unit at 12 decimals: × 1e4 × 1e12. */
const BASIS_PER_UNIT_SCALE = 12;
const BASIS_PER_UNIT_FACTOR = 10n ** 16n;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ */
/* Late dividend                                                        */
/* ------------------------------------------------------------------ */

export interface RecordDividendCommand {
  readonly customerId: string;
  readonly symbol: string;
  /** Entitlement date; the receivable and income are booked here. */
  readonly exDate: string;
  /** Cash date; the receivable turns into settled cash here (if not in the future). */
  readonly payDate: string;
  readonly amountCents: bigint;
  /** Provider or operator reference that identifies this dividend event. */
  readonly sourceRef: string;
}

export interface RecordDividendResult {
  readonly entitlement: AppendResult;
  readonly payment: AppendResult | null;
  /** Null when no valuation on/after the ex-date existed to restate. */
  readonly restatement: RestateResult | null;
}

/**
 * Books a dividend on its true economic dates even when we learn about it
 * late: `effectiveAt` is the ex/pay date, `postedAt` is now. Because the
 * dividend is income, not an external flow, valuations from the ex-date move
 * and the returns are restated from there (ADR-0004).
 */
export async function recordDividend(deps: RestateDeps, command: RecordDividendCommand): Promise<RecordDividendResult> {
  if (!ISO_DAY.test(command.exDate) || !ISO_DAY.test(command.payDate)) throw new ValidationError("Dates must be YYYY-MM-DD");
  if (command.payDate < command.exDate) throw new ValidationError("Pay date cannot precede ex-date");
  if (command.amountCents <= 0n) throw new ValidationError("Dividend amount must be positive");

  const accounts = await deps.resolver.forCustomer(command.customerId, [command.symbol]);
  const key = `dividend:${command.symbol}:${command.exDate}:${command.customerId}`;

  const entitlement = await postJournalEntry(deps, {
    idempotencyKey: `${key}:entitlement`,
    kind: "dividend_entitlement",
    effectiveAt: atMarketClose(command.exDate),
    source: "custodian",
    sourceRef: command.sourceRef,
    description: `${command.symbol} dividend declared (ex ${command.exDate})`,
    postings: postingPatterns.dividendEntitlement(accounts, command.amountCents),
  });

  const today = businessDate(deps.clock.now());
  const payment =
    command.payDate <= today
      ? await postJournalEntry(deps, {
          idempotencyKey: `${key}:paid`,
          kind: "dividend_paid",
          effectiveAt: atMarketClose(command.payDate),
          source: "custodian",
          sourceRef: command.sourceRef,
          description: `${command.symbol} dividend paid`,
          postings: postingPatterns.dividendPaid(accounts, command.amountCents),
        })
      : null;

  const restatement = await restate(deps, {
    customerId: command.customerId,
    fromDate: command.exDate,
    reason: `late_dividend:${command.symbol}@${command.exDate}`,
  });
  return { entitlement, payment, restatement: restatement.dates.length > 0 ? restatement : null };
}

/* ------------------------------------------------------------------ */
/* Stock split                                                          */
/* ------------------------------------------------------------------ */

export interface ApplyStockSplitDeps extends RestateDeps {
  readonly taxLots: TaxLotRepository;
}

export interface ApplyStockSplitCommand {
  readonly customerId: string;
  readonly symbol: string;
  /** `numerator`-for-`denominator`: a 2-for-1 split is 2/1. */
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly effectiveDate: string;
  readonly sourceRef: string;
}

export interface ApplyStockSplitResult {
  readonly entry: AppendResult;
  readonly unitsBefore: bigint;
  readonly unitsAfter: bigint;
  readonly lotsAdjusted: number;
  /** Closes on/after the effective date re-recorded at the split-adjusted price. */
  readonly pricesAdjusted: number;
  readonly restatement: RestateResult | null;
  /** Latest stored valuation before and after the split — the "value unchanged" evidence. */
  readonly latestValue: { readonly asOfDate: string; readonly beforeCents: bigint; readonly afterCents: bigint } | null;
}

/**
 * A split changes units, never value: N units at P become N·r units at P/r.
 * We post the extra units against the street account (zero cash), scale each
 * tax lot (total basis unchanged), record split-adjusted closes from the
 * effective date as new price versions, and restate — the restated valuation
 * and TWR must come out identical, which is the invariant the tests assert.
 *
 * Adjusting the closes here is the simulator standing in for the feed: a real
 * feed reports post-split prices from the effective date on its own.
 */
export async function applyStockSplit(deps: ApplyStockSplitDeps, command: ApplyStockSplitCommand): Promise<ApplyStockSplitResult> {
  if (!ISO_DAY.test(command.effectiveDate)) throw new ValidationError("effectiveDate must be YYYY-MM-DD");
  if (command.numerator <= 0n || command.denominator <= 0n) throw new ValidationError("Split ratio must be positive");
  if (command.numerator === command.denominator) throw new ValidationError("Split ratio must change the unit count");

  const now = deps.clock.now();
  const accounts = await deps.resolver.forCustomer(command.customerId, [command.symbol]);
  const clearing = await deps.resolver.clearing([command.symbol]);
  const effectiveAt = atMarketClose(command.effectiveDate);

  const balances = await deriveCustomerBalances(
    { ledger: deps.ledger },
    command.customerId,
    accounts,
    [command.symbol],
    { effectiveAt, publishedAt: now },
  );
  const unitsBefore = balances.positionsMicro.get(command.symbol) ?? 0n;
  if (unitsBefore <= 0n) throw new ValidationError(`Customer holds no ${command.symbol} on ${command.effectiveDate}`);
  const unitsAfter = (unitsBefore * command.numerator) / command.denominator;
  const latestBefore = (await deps.valuations.series(command.customerId, {})).at(-1);

  const entry = await postJournalEntry(deps, {
    idempotencyKey: `split:${command.symbol}:${command.effectiveDate}:${command.customerId}`,
    kind: "split",
    effectiveAt,
    source: "custodian",
    sourceRef: command.sourceRef,
    description: `${command.symbol} ${command.numerator}-for-${command.denominator} split`,
    postings: postingPatterns.split(accounts, clearing, command.symbol, unitsAfter - unitsBefore),
  });

  // Everything below is keyed off the entry's idempotency: a replayed split must
  // neither halve the closes twice nor re-adjust the lots.
  let lotsAdjusted = 0;
  let pricesAdjusted = 0;
  if (entry.status === "inserted") {
    const lots = await deps.taxLots.availableLots(command.customerId, command.symbol);
    for (const lot of lots.filter((candidate) => candidate.lot.openedAt <= effectiveAt)) {
      const adjusted = applySplit(lot, command.numerator, command.denominator);
      await deps.taxLots.adjust({
        id: deps.ids.next(),
        lotId: lot.lot.id,
        entryId: entry.entry.id,
        kind: "split",
        ratioNumerator: command.numerator,
        ratioDenominator: command.denominator,
        unitsAfter: adjusted.remainingUnits,
        basisPerUnitAfter: formatDecimal(
          divideHalfEven(adjusted.remainingBasis * BASIS_PER_UNIT_FACTOR, adjusted.remainingUnits),
          BASIS_PER_UNIT_SCALE,
        ),
        effectiveAt,
      });
      lotsAdjusted += 1;
    }

    const closes = await deps.prices.listForSymbol(command.symbol, command.effectiveDate);
    const adjusted = closes.map((close) => ({
      symbol: close.symbol,
      tradeDate: close.tradeDate,
      price: formatDecimal(
        divideHalfEven(parseDecimal(close.price, PRICE_SCALE) * command.denominator, command.numerator),
        PRICE_SCALE,
      ),
      source: `split-adjusted:${close.source}`,
    }));
    pricesAdjusted = (await deps.prices.record(adjusted, now)).length;
  }

  const restatement = await restate(deps, {
    customerId: command.customerId,
    fromDate: command.effectiveDate,
    reason: `split:${command.symbol}:${command.numerator}-for-${command.denominator}@${command.effectiveDate}`,
  });
  const latestAfter = latestBefore ? (await deps.valuations.series(command.customerId, {})).at(-1) : undefined;
  return {
    entry,
    unitsBefore,
    unitsAfter,
    lotsAdjusted,
    pricesAdjusted,
    restatement: restatement.dates.length > 0 ? restatement : null,
    latestValue:
      latestBefore && latestAfter
        ? { asOfDate: latestAfter.asOfDate, beforeCents: latestBefore.valueCents, afterCents: latestAfter.valueCents }
        : null,
  };
}
