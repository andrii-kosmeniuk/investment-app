import { assertBalanced, type LedgerSource, type Posting } from "@corgi/domain";
import type { AppendResult, Clock, IdGenerator, LedgerRepository } from "../ports.js";

export interface PostJournalEntryCommand {
  /** Optional caller-supplied entry id, e.g. to link a tax lot to its entry. */
  readonly id?: string;
  /** Deduplicates the economic event, e.g. `plaid:transfer.settled:tr_123`. */
  readonly idempotencyKey: string;
  readonly kind: string;
  /** When the event economically happened. */
  readonly effectiveAt: Date;
  /** When we learned it; defaults to the clock (knowledge time). */
  readonly postedAt?: Date;
  readonly source: LedgerSource;
  readonly sourceRef: string;
  readonly description: string;
  readonly postings: readonly Posting[];
  readonly reversesEntryId?: string;
}

export interface PostJournalEntryDeps {
  readonly ledger: LedgerRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Application service for the single write into the ledger. It enforces the
 * balance invariant before touching infrastructure (fail fast, with a domain
 * error), then delegates atomic hash-chaining + idempotent persistence to the
 * repository. The domain owns the rules; the repository owns durability.
 */
export async function postJournalEntry(
  deps: PostJournalEntryDeps,
  command: PostJournalEntryCommand,
): Promise<AppendResult> {
  assertBalanced(command.postings);

  const postedAt = command.postedAt ?? deps.clock.now();
  return deps.ledger.append({
    id: command.id ?? deps.ids.next(),
    idempotencyKey: command.idempotencyKey,
    kind: command.kind,
    effectiveAt: command.effectiveAt,
    postedAt,
    source: command.source,
    sourceRef: command.sourceRef,
    description: command.description,
    postings: command.postings,
    ...(command.reversesEntryId ? { reversesEntryId: command.reversesEntryId } : {}),
  });
}
