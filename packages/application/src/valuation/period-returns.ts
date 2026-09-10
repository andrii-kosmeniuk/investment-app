import {
  type ValuationPoint,
  endOfBusinessDay,
  firstOfMonth,
  firstOfYear,
  periodReturn,
  returnToBpsE4,
} from "@corgi/domain";
import type {
  AccountResolver,
  Clock,
  IdGenerator,
  LedgerRepository,
  PeriodReturnRecord,
  PeriodReturnRepository,
  ReturnPeriod,
  ValuationRepository,
} from "../ports.js";
import { externalFlows } from "./flows.js";

export interface ComputePeriodReturnsDeps {
  readonly ledger: LedgerRepository;
  readonly resolver: AccountResolver;
  readonly valuations: ValuationRepository;
  readonly returns: PeriodReturnRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ComputePeriodReturnsCommand {
  readonly customerId: string;
  /** Period end — must have a valuation. */
  readonly asOfDate: string;
  readonly reason: string;
}

export interface PeriodReturnOutcome {
  readonly period: ReturnPeriod;
  readonly status: "recorded" | "unchanged";
  readonly record: PeriodReturnRecord;
}

export const RETURN_PERIODS: readonly ReturnPeriod[] = ["mtd", "ytd", "inception"];

function periodStartFor(period: ReturnPeriod, asOfDate: string): string | null {
  switch (period) {
    case "mtd":
      return firstOfMonth(asOfDate);
    case "ytd":
      return firstOfYear(asOfDate);
    case "inception":
      return null;
  }
}

/**
 * Computes month-to-date, year-to-date and since-inception returns ending on
 * `asOfDate` from the current valuation series and the customer's external
 * flows, and stores each as a new version only when the figure moved.
 *
 * Sub-periods run between consecutive stored valuations, so weekends, holidays
 * and missed nightly runs neither break the chain nor invent zero-return days.
 */
export async function computePeriodReturns(
  deps: ComputePeriodReturnsDeps,
  command: ComputePeriodReturnsCommand,
): Promise<readonly PeriodReturnOutcome[]> {
  const now = deps.clock.now();
  const series = await deps.valuations.series(command.customerId, { to: command.asOfDate });
  const points: ValuationPoint[] = series.map((valuation) => ({ date: valuation.asOfDate, valueCents: valuation.valueCents }));
  if (points.at(-1)?.date !== command.asOfDate) return [];

  const accounts = await deps.resolver.forCustomer(command.customerId, []);
  const entries = await deps.ledger.listForCustomer(command.customerId, {
    effectiveAt: endOfBusinessDay(command.asOfDate),
    publishedAt: now,
  });
  const flows = externalFlows(entries, accounts);

  const outcomes: PeriodReturnOutcome[] = [];
  for (const period of RETURN_PERIODS) {
    const start = periodStartFor(period, command.asOfDate);
    const inPeriod = start ? points.filter((point) => point.date >= start) : points;
    if (inPeriod.length === 0) continue;
    const opening = start ? (points.filter((point) => point.date < start).at(-1) ?? null) : null;

    const result = periodReturn(opening, inPeriod, flows);
    const twrBpsE4 = returnToBpsE4(result.twr);
    const mwrBpsE4 = result.mwr === null ? null : returnToBpsE4(result.mwr);
    const periodStart = start ?? inPeriod[0]!.date;

    const latest = await deps.returns.latest(command.customerId, period, command.asOfDate);
    if (
      latest &&
      latest.periodStart === periodStart &&
      latest.twrBpsE4 === twrBpsE4 &&
      latest.mwrBpsE4 === mwrBpsE4 &&
      latest.flowsCents === result.flowsCents
    ) {
      outcomes.push({ period, status: "unchanged", record: latest });
      continue;
    }

    const record = await deps.returns.insert({
      id: deps.ids.next(),
      customerId: command.customerId,
      period,
      periodStart,
      periodEnd: command.asOfDate,
      twrBpsE4,
      mwrBpsE4,
      flowsCents: result.flowsCents,
      version: (latest?.version ?? 0) + 1,
      supersedesId: latest?.id ?? null,
      reason: command.reason,
    });
    outcomes.push({ period, status: "recorded", record });
  }
  return outcomes;
}
