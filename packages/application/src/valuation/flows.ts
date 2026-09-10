import {
  type CustomerLedgerAccounts,
  type DatedFlow,
  type JournalEntry,
  MARKET_TIME_ZONE,
  businessDate,
} from "@corgi/domain";

/**
 * Entry kinds whose settled-cash leg is an *external* flow for return
 * purposes: money crossing the boundary between the customer and the outside
 * world. Dividends and trades move value around inside the portfolio and are
 * not flows; a returned deposit is money leaving (ADR-0004).
 */
export const EXTERNAL_FLOW_KINDS: ReadonlySet<string> = new Set([
  "deposit_settled",
  "deposit_returned",
  "withdrawal",
  "fee",
]);

/**
 * External flows by business date, signed from the portfolio's point of view.
 * A reversal of a flow entry is itself a flow (with the opposite sign), so a
 * corrected deposit nets to zero rather than appearing as performance.
 */
export function externalFlows(
  entries: readonly JournalEntry[],
  accounts: Pick<CustomerLedgerAccounts, "settledCash">,
  timeZone = MARKET_TIME_ZONE,
): readonly DatedFlow[] {
  const kindById = new Map(entries.map((entry) => [entry.id, entry.kind]));
  const isFlow = (entry: JournalEntry): boolean =>
    EXTERNAL_FLOW_KINDS.has(entry.kind) ||
    (entry.reversesEntryId !== undefined && EXTERNAL_FLOW_KINDS.has(kindById.get(entry.reversesEntryId) ?? ""));

  const byDate = new Map<string, bigint>();
  for (const entry of entries) {
    if (!isFlow(entry)) continue;
    const amount = entry.postings
      .filter((posting) => posting.accountId === accounts.settledCash && posting.commodity === "USD")
      .reduce((sum, posting) => sum + posting.quantity, 0n);
    if (amount === 0n) continue;
    const date = businessDate(entry.effectiveAt, timeZone);
    byDate.set(date, (byDate.get(date) ?? 0n) + amount);
  }
  return [...byDate]
    .map(([date, amountCents]) => ({ date, amountCents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
