import { type Posting, postingPatterns } from "@corgi/domain";
import type { AccountResolver } from "../ports.js";
import { type PostJournalEntryDeps, postJournalEntry } from "../ledger/post-entry.js";

export type TransferKind = "pending" | "settled" | "returned";

export interface TransferEvent {
  readonly customerId: string;
  readonly transferId: string;
  readonly kind: TransferKind;
  readonly amountCents: bigint;
  readonly occurredAt: Date;
  readonly returnCode?: string;
}

export interface RecordTransferEventDeps extends PostJournalEntryDeps {
  readonly resolver: AccountResolver;
}

/**
 * Translates a Plaid transfer state change into the matching ledger entry.
 * Idempotent by construction: the entry key is derived from the transfer id and
 * state, so a replayed or re-synced event is a no-op at the ledger.
 */
export async function recordTransferEvent(
  deps: RecordTransferEventDeps,
  event: TransferEvent,
): Promise<void> {
  const customer = await deps.resolver.forCustomer(event.customerId, []);
  const clearing = await deps.resolver.clearing([]);

  let postings: readonly Posting[];
  let description: string;
  switch (event.kind) {
    case "pending":
      postings = postingPatterns.depositPending(customer, clearing, event.amountCents);
      description = "ACH debit initiated";
      break;
    case "settled":
      postings = postingPatterns.depositSettled(customer, event.amountCents);
      description = "Deposit settled to cash";
      break;
    case "returned":
      postings = postingPatterns.depositReturnedAfterInvestment(customer, event.amountCents);
      description = event.returnCode
        ? `Deposit returned by bank (${event.returnCode})`
        : "Deposit returned by bank";
      break;
  }

  await postJournalEntry(deps, {
    idempotencyKey: `plaid:transfer.${event.kind}:${event.transferId}`,
    kind: `deposit_${event.kind}`,
    effectiveAt: event.occurredAt,
    source: "plaid",
    sourceRef: event.transferId,
    description,
    postings,
  });
}
