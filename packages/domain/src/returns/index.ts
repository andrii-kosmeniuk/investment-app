import { addDays, daysBetween } from "../calendar/index.js";

export interface DailyPerformance {
  readonly openingValue: bigint;
  readonly closingValue: bigint;
  /** External cash flows are weighted as beginning-of-day flows. */
  readonly externalFlow: bigint;
}

/**
 * Chain-links sub-period returns: r = (V_close − F − V_open) / V_open with the
 * flow F treated as arriving at the start of the sub-period. A sub-period that
 * opens at zero (first funding) starts the chain rather than dividing by zero.
 */
export function timeWeightedReturn(days: readonly DailyPerformance[]): number {
  let linked = 1;
  for (const day of days) {
    if (day.openingValue === 0n) continue;
    linked *=
      1 +
      Number(day.closingValue - day.externalFlow - day.openingValue) /
        Number(day.openingValue);
  }
  return linked - 1;
}

export interface WeightedFlow {
  readonly amount: bigint;
  /** Fraction of period remaining when the flow occurred, between 0 and 1. */
  readonly weight: number;
}

export function modifiedDietzReturn(
  openingValue: bigint,
  closingValue: bigint,
  flows: readonly WeightedFlow[],
): number | null {
  const netFlows = flows.reduce((sum, flow) => sum + flow.amount, 0n);
  const weightedFlows = flows.reduce(
    (sum, flow) => sum + Number(flow.amount) * flow.weight,
    0,
  );
  const denominator = Number(openingValue) + weightedFlows;
  if (denominator === 0) return null;
  return (Number(closingValue - openingValue - netFlows)) / denominator;
}

/* ------------------------------------------------------------------ */
/* Storage scale                                                        */
/* ------------------------------------------------------------------ */

/** Returns are stored as basis points × 10⁴ — i.e. the fraction × 10⁸ — as an integer. */
export const RETURN_SCALE = 100_000_000;

export function returnToBpsE4(fraction: number): bigint {
  if (!Number.isFinite(fraction)) throw new RangeError("Return must be finite");
  return BigInt(Math.round(fraction * RETURN_SCALE));
}

export function bpsE4ToReturn(value: bigint): number {
  return Number(value) / RETURN_SCALE;
}

/* ------------------------------------------------------------------ */
/* Period returns from a valuation series                              */
/* ------------------------------------------------------------------ */

export interface ValuationPoint {
  /** Business date, YYYY-MM-DD. */
  readonly date: string;
  readonly valueCents: bigint;
}

export interface DatedFlow {
  /** Business date the flow took effect, YYYY-MM-DD. */
  readonly date: string;
  /** Positive into the portfolio (deposit), negative out (withdrawal, fee, returned deposit). */
  readonly amountCents: bigint;
}

export interface PeriodReturnResult {
  readonly twr: number;
  readonly mwr: number | null;
  readonly flowsCents: bigint;
  readonly openingValueCents: bigint;
  readonly closingValueCents: bigint;
  readonly subPeriods: number;
}

const byDate = <T extends { date: string }>(a: T, b: T): number => a.date.localeCompare(b.date);

/**
 * Builds the sub-periods between consecutive valuation points. Flows dated in
 * (previous, current] belong to the sub-period that ends at `current`. Using
 * consecutive *available* valuations (not calendar days) makes the chain
 * indifferent to weekends, holidays and missed runs.
 */
export function subPeriods(
  points: readonly ValuationPoint[],
  flows: readonly DatedFlow[],
): readonly DailyPerformance[] {
  const ordered = [...points].sort(byDate);
  const result: DailyPerformance[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const flow = flows
      .filter((f) => f.date > previous.date && f.date <= current.date)
      .reduce((sum, f) => sum + f.amountCents, 0n);
    result.push({ openingValue: previous.valueCents, closingValue: current.valueCents, externalFlow: flow });
  }
  return result;
}

/**
 * Period return over `points` (all valuations inside the period, ascending),
 * with `opening` being the last valuation strictly before the period — or null
 * when the period starts at inception, in which case the chain opens at zero
 * and the first flow carries full weight in Modified Dietz.
 */
export function periodReturn(
  opening: ValuationPoint | null,
  points: readonly ValuationPoint[],
  flows: readonly DatedFlow[],
): PeriodReturnResult {
  const ordered = [...points].sort(byDate);
  const last = ordered.at(-1);
  if (!last) throw new RangeError("A period needs at least one valuation");

  const startDate = opening?.date ?? addDays(ordered[0]!.date, -1);
  const openingValue = opening?.valueCents ?? 0n;
  const series: ValuationPoint[] = [{ date: startDate, valueCents: openingValue }, ...ordered];
  const inPeriod = flows.filter((flow) => flow.date > startDate && flow.date <= last.date);

  const twr = timeWeightedReturn(subPeriods(series, inPeriod));

  const periodDays = daysBetween(startDate, last.date);
  const weighted: WeightedFlow[] = inPeriod.map((flow) => ({
    amount: flow.amountCents,
    // Beginning-of-day convention: a flow on day d is invested from d through the end.
    weight: periodDays === 0 ? 0 : (daysBetween(flow.date, last.date) + 1) / periodDays,
  }));
  const mwr = periodDays === 0 ? null : modifiedDietzReturn(openingValue, last.valueCents, weighted);

  return {
    twr,
    mwr,
    flowsCents: inPeriod.reduce((sum, flow) => sum + flow.amountCents, 0n),
    openingValueCents: openingValue,
    closingValueCents: last.valueCents,
    subPeriods: ordered.length,
  };
}
