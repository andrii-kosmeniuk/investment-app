import type { PeriodReturnOutcome } from "./period-returns.js";
import { type ComputePeriodReturnsDeps, computePeriodReturns } from "./period-returns.js";
import { type ValueCustomerDeps, type ValueCustomerResult, valueCustomer } from "./value-customer.js";

export type RestateDeps = ValueCustomerDeps & ComputePeriodReturnsDeps;

export interface RestateCommand {
  readonly customerId: string;
  /** First business date whose inputs changed. */
  readonly fromDate: string;
  readonly reason: string;
}

export interface RestateResult {
  readonly customerId: string;
  readonly fromDate: string;
  readonly reason: string;
  /** Dates that already had a valuation and were recomputed. */
  readonly dates: readonly string[];
  readonly valuations: readonly ValueCustomerResult[];
  readonly returns: readonly PeriodReturnOutcome[];
}

/**
 * Recomputes every existing valuation from `fromDate` forward, then every
 * period return ending on those dates, writing new versions where the figures
 * moved. Nothing is deleted: the superseded rows remain the "as published"
 * history (ADR-0004). Dates that were never valued are not invented here —
 * that is the scheduled job's or a backfill's decision.
 */
export async function restate(deps: RestateDeps, command: RestateCommand): Promise<RestateResult> {
  const existing = await deps.valuations.series(command.customerId, { from: command.fromDate });
  const dates = existing.map((valuation) => valuation.asOfDate);

  const valuations: ValueCustomerResult[] = [];
  for (const asOfDate of dates) {
    valuations.push(await valueCustomer(deps, { customerId: command.customerId, asOfDate, reason: command.reason }));
  }
  const returns: PeriodReturnOutcome[] = [];
  for (const asOfDate of dates) {
    returns.push(...(await computePeriodReturns(deps, { customerId: command.customerId, asOfDate, reason: command.reason })));
  }
  return { customerId: command.customerId, fromDate: command.fromDate, reason: command.reason, dates, valuations, returns };
}
