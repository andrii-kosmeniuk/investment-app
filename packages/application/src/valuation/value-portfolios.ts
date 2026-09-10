import { addDays, isWeekend } from "@corgi/domain";
import type { LedgerAccountDirectory } from "../ports.js";
import { type PeriodReturnOutcome, computePeriodReturns } from "./period-returns.js";
import type { RestateDeps } from "./restate.js";
import { type ValueCustomerResult, valueCustomer } from "./value-customer.js";

export interface ValuePortfoliosDeps extends RestateDeps {
  readonly accounts: LedgerAccountDirectory;
}

export interface ValuePortfoliosCommand {
  /** Inclusive business-date window; weekends are skipped. */
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  /** Restrict to one customer (live-fire console); defaults to everyone with a ledger. */
  readonly customerId?: string;
}

export interface CustomerValuationRun {
  readonly customerId: string;
  readonly asOfDate: string;
  readonly valuation: ValueCustomerResult;
  readonly returns: readonly PeriodReturnOutcome[];
}

/**
 * The nightly job (and its backfill twin): value every customer on each
 * weekday in the window, then compute the period returns ending that day.
 * Weekends are skipped because no close exists for them; holidays fall out
 * naturally as "unchanged" (same last close, same ledger) rather than by table.
 */
export async function valuePortfolios(
  deps: ValuePortfoliosDeps,
  command: ValuePortfoliosCommand,
): Promise<readonly CustomerValuationRun[]> {
  if (command.from > command.to) throw new RangeError("from must not be after to");
  const customers = command.customerId ? [command.customerId] : await deps.accounts.customersWithAccounts();
  const runs: CustomerValuationRun[] = [];
  for (let asOfDate = command.from; asOfDate <= command.to; asOfDate = addDays(asOfDate, 1)) {
    if (isWeekend(asOfDate)) continue;
    for (const customerId of customers) {
      const valuation = await valueCustomer(deps, { customerId, asOfDate, reason: command.reason });
      const returns =
        valuation.status === "recorded" || valuation.status === "unchanged"
          ? await computePeriodReturns(deps, { customerId, asOfDate, reason: command.reason })
          : [];
      runs.push({ customerId, asOfDate, valuation, returns });
    }
  }
  return runs;
}
