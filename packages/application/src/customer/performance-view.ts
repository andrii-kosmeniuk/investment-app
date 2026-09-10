import { bpsE4ToReturn } from "@corgi/domain";
import type { PeriodReturnRecord, ReturnPeriod, ValuationRecord, ValuationStatus } from "../ports.js";

export interface Restated<T> {
  readonly at: Date;
  readonly previous: T;
  readonly reason: string | null;
}

export interface PeriodReturnView {
  readonly period: ReturnPeriod;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly twr: number;
  readonly mwr: number | null;
  readonly flowsCents: bigint;
  readonly version: number;
  /** Present when the figure the customer may have seen has since moved. */
  readonly restated: Restated<number> | null;
}

export interface PerformanceView {
  readonly asOfDate: string;
  readonly valueCents: bigint;
  readonly status: ValuationStatus;
  readonly version: number;
  readonly computedAt: Date;
  readonly restated: Restated<bigint> | null;
  readonly returns: readonly PeriodReturnView[];
}

export interface PerformanceViewInput {
  /** Latest visible valuation and every visible version of it, ascending. */
  readonly valuation: ValuationRecord | null;
  readonly valuationVersions: readonly ValuationRecord[];
  /** Per period: every visible version, ascending; the last is current. */
  readonly returnVersions: ReadonlyMap<ReturnPeriod, readonly PeriodReturnRecord[]>;
}

/**
 * Pure assembly of the customer's headline performance. A figure is "restated"
 * when a visible earlier version showed a *different* number: a re-versioned
 * valuation whose value is identical (a split re-snapshots units and price)
 * is audit material, not a customer-facing correction. Passing an as-published
 * cut-off yields the figures as they stood that day, pills included.
 */
export function buildPerformanceView(input: PerformanceViewInput): PerformanceView | null {
  const { valuation } = input;
  if (!valuation) return null;

  const priorValue = input.valuationVersions
    .filter((v) => v.version < valuation.version && v.valueCents !== valuation.valueCents)
    .at(-1);
  const returns: PeriodReturnView[] = [];
  for (const [period, versions] of input.returnVersions) {
    const current = versions.at(-1);
    if (!current || current.periodEnd !== valuation.asOfDate) continue;
    const previous = versions.filter((v) => v.version < current.version && v.twrBpsE4 !== current.twrBpsE4).at(-1);
    returns.push({
      period,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      twr: bpsE4ToReturn(current.twrBpsE4),
      mwr: current.mwrBpsE4 === null ? null : bpsE4ToReturn(current.mwrBpsE4),
      flowsCents: current.flowsCents,
      version: current.version,
      restated: previous
        ? { at: current.computedAt, previous: bpsE4ToReturn(previous.twrBpsE4), reason: current.reason }
        : null,
    });
  }

  return {
    asOfDate: valuation.asOfDate,
    valueCents: valuation.valueCents,
    status: valuation.status,
    version: valuation.version,
    computedAt: valuation.computedAt,
    restated: priorValue ? { at: valuation.computedAt, previous: priorValue.valueCents, reason: valuation.reason } : null,
    returns,
  };
}
