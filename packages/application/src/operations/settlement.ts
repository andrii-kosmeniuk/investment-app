import { postingPatterns, zonedInstant } from "@corgi/domain";
import type { AccountResolver, OrderRepository, SettlementRecord, SettlementRepository } from "../ports.js";
import { type PostJournalEntryDeps, postJournalEntry } from "../ledger/post-entry.js";

export interface SettleDueTradesDeps extends PostJournalEntryDeps {
  readonly resolver: AccountResolver;
  readonly settlements: SettlementRepository;
  readonly orders: OrderRepository;
}

export interface SettleDueTradesResult {
  readonly settled: readonly SettlementRecord[];
  readonly alreadySettled: number;
}

/**
 * The 00:05 ET job: every pending settlement whose contractual date has
 * arrived moves the cash leg from the unsettled account to settled cash.
 * Idempotent on `settle:{fillExternalId}`, so a re-run (or a settlement row
 * that was marked late) never double-settles.
 */
export async function settleDueTrades(deps: SettleDueTradesDeps, today: string): Promise<SettleDueTradesResult> {
  const due = await deps.settlements.listDue(today);
  const settled: SettlementRecord[] = [];
  let alreadySettled = 0;

  for (const settlement of due) {
    const order = await deps.orders.findById(settlement.orderId);
    if (!order) throw new Error(`settlement ${settlement.id} references unknown order ${settlement.orderId}`);
    const customer = await deps.resolver.forCustomer(order.customerId, []);

    const result = await postJournalEntry(deps, {
      idempotencyKey: `settle:${settlement.fillExternalId}`,
      kind: settlement.side === "buy" ? "settle_buy" : "settle_sell",
      // Cash is good from the start of the settlement day in New York.
      effectiveAt: zonedInstant(settlement.contractualSettlementDate, "00:00:00.000"),
      source: "system",
      sourceRef: settlement.fillExternalId,
      description: `${settlement.side === "buy" ? "Purchase" : "Sale"} of ${order.symbol} settled (T+1)`,
      postings:
        settlement.side === "buy"
          ? postingPatterns.settleBuy(customer, settlement.amountCents)
          : postingPatterns.settleSell(customer, settlement.amountCents),
    });

    await deps.settlements.markSettled(settlement.id, result.entry.id);
    if (result.status === "inserted") settled.push({ ...settlement, status: "settled", journalEntryId: result.entry.id });
    else alreadySettled += 1;
  }
  return { settled, alreadySettled };
}
