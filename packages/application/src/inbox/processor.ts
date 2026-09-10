import type { InboxEvent, InboxRepository } from "../ports.js";
import {
  type PostJournalEntryCommand,
  type PostJournalEntryDeps,
  postJournalEntry,
} from "../ledger/post-entry.js";

/**
 * Translates one inbound event into zero or more ledger commands. Handlers are
 * pure with respect to the ledger: they decide *what* to post, never *how* to
 * persist it. Provider-specific handlers (Plaid/Alpaca/Persona) are registered
 * on the processor in the composition root; the processor stays generic.
 */
export type InboxHandler = (
  event: InboxEvent,
) => Promise<readonly PostJournalEntryCommand[]> | readonly PostJournalEntryCommand[];

export interface InboxProcessorDeps extends PostJournalEntryDeps {
  readonly inbox: InboxRepository;
  readonly handlers: ReadonlyMap<string, InboxHandler>;
}

export interface InboxBatchResult {
  readonly leased: number;
  readonly processed: number;
  readonly failed: number;
  /** Ledger appends that were no-ops because the effect already existed. */
  readonly duplicateEffects: number;
}

/**
 * Leases a batch of undelivered events and applies them exactly once in effect.
 * Two independent guards make replays and retries safe:
 *   1. the inbox dedupes on `dedupeKey` at ingress (a webhook or SSE event
 *      delivered twice is stored once); and
 *   2. every derived ledger command carries an `idempotencyKey`, so even if an
 *      event is processed more than once the append is a no-op `"duplicate"`.
 * Out-of-order delivery is tolerated because each handler is independent and
 * the ledger is keyed by economic identity, not arrival order.
 */
export async function processInboxBatch(
  deps: InboxProcessorDeps,
  limit: number,
): Promise<InboxBatchResult> {
  const events = await deps.inbox.leaseBatch(limit);
  let processed = 0;
  let failed = 0;
  let duplicateEffects = 0;

  for (const event of events) {
    const handler = deps.handlers.get(event.type);
    if (!handler) {
      await deps.inbox.markFailed(event.dedupeKey, `no handler for event type '${event.type}'`);
      failed += 1;
      continue;
    }
    if (!event.signatureValid) {
      await deps.inbox.markFailed(event.dedupeKey, "signature invalid; refusing to process");
      failed += 1;
      continue;
    }

    try {
      const commands = await handler(event);
      for (const command of commands) {
        const result = await postJournalEntry(deps, command);
        if (result.status === "duplicate") duplicateEffects += 1;
      }
      await deps.inbox.markProcessed(event.dedupeKey);
      processed += 1;
    } catch (error) {
      await deps.inbox.markFailed(
        event.dedupeKey,
        error instanceof Error ? error.message : String(error),
      );
      failed += 1;
    }
  }

  return { leased: events.length, processed, failed, duplicateEffects };
}
