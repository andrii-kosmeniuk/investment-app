import type { JournalEntry } from "@corgi/domain";

export interface ActivityLeg {
  readonly accountPath: string;
  readonly commodity: string;
  readonly quantity: bigint;
}

export interface ActivityRowView {
  readonly entryId: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly effectiveAt: Date;
  readonly postedAt: Date;
  readonly source: string;
  /** The customer-facing figure: units for trades and splits, USD otherwise. */
  readonly amount: ActivityLeg;
  readonly legs: readonly ActivityLeg[];
  readonly reversesEntryId: string | null;
}

const LABELS: Readonly<Record<string, string>> = {
  deposit_pending: "Deposit initiated",
  deposit_settled: "Deposit settled",
  deposit_returned: "Deposit returned",
  buy_fill: "Buy",
  sell_fill: "Sell",
  settle_buy: "Trade settled",
  settle_sell: "Trade settled",
  dividend_entitlement: "Dividend declared",
  dividend_paid: "Dividend paid",
  split: "Stock split",
  fee: "Fee",
  withdrawal: "Withdrawal",
  correction: "Correction",
  reversal: "Reversal",
};

function humanize(kind: string): string {
  const text = kind.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isCustomerPath(path: string): boolean {
  return path.startsWith("customer:");
}

/**
 * Picks the one figure a row leads with. Trades and splits are about units, so
 * the customer's position leg wins; everything else leads with the customer's
 * cash movement. Shares and dollars are never summed (design brief §11).
 */
function leadingAmount(legs: readonly ActivityLeg[]): ActivityLeg {
  const customerLegs = legs.filter((leg) => isCustomerPath(leg.accountPath));
  const candidates = customerLegs.length > 0 ? customerLegs : legs;
  const units = candidates.find((leg) => leg.commodity !== "USD");
  if (units) return units;
  const cash =
    candidates.find((leg) => /:cash:(settled|pending)$/.test(leg.accountPath)) ??
    candidates.find((leg) => leg.commodity === "USD");
  if (cash) return cash;
  const first = candidates[0];
  if (!first) throw new Error("journal entry has no postings");
  return first;
}

/**
 * Projects ledger entries into customer activity rows, newest first. Every leg
 * stays visible (account path, commodity, signed quantity) so the row can be
 * expanded; nothing is netted away or edited.
 */
export function buildActivityRows(
  entries: readonly JournalEntry[],
  pathsById: ReadonlyMap<string, string>,
): readonly ActivityRowView[] {
  const rows = entries.map((entry): ActivityRowView => {
    const legs = entry.postings.map((posting) => ({
      accountPath: pathsById.get(posting.accountId) ?? posting.accountId,
      commodity: posting.commodity,
      quantity: posting.quantity,
    }));
    const amount = leadingAmount(legs);
    const base = LABELS[entry.kind] ?? humanize(entry.kind);
    const label =
      (entry.kind === "buy_fill" || entry.kind === "sell_fill") && amount.commodity !== "USD"
        ? `${base} ${amount.commodity}`
        : base;
    return {
      entryId: entry.id,
      kind: entry.kind,
      label,
      description: entry.description,
      effectiveAt: entry.effectiveAt,
      postedAt: entry.postedAt,
      source: entry.source,
      amount,
      legs,
      reversesEntryId: entry.reversesEntryId ?? null,
    };
  });

  return rows.sort(
    (a, b) =>
      b.effectiveAt.getTime() - a.effectiveAt.getTime() || b.postedAt.getTime() - a.postedAt.getTime(),
  );
}
