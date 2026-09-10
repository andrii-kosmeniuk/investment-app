import type { InboxEvent, InboxRepository } from "../ports.js";

/**
 * Applies one inbound event's effects (ledger postings, KYC updates, order
 * bookkeeping). Handlers are effectful but MUST be idempotent — they lean on
 * ledger idempotency keys and repository upserts so re-processing an event
 * changes nothing. Handlers are wired to use-cases in the composition root; the
 * processor stays free of provider knowledge.
 */
export type InboxHandler = (event: InboxEvent) => Promise<void>;

export interface InboxProcessorDeps {
  readonly inbox: InboxRepository;
  readonly handlers: ReadonlyMap<string, InboxHandler>;
}

export interface InboxBatchResult {
  readonly leased: number;
  readonly processed: number;
  readonly failed: number;
}

/**
 * Leases a batch of undelivered events and applies each exactly once in effect.
 * Ingress dedupe (on `dedupeKey`) plus per-handler idempotency make replays and
 * out-of-order deliveries safe. Signature-invalid or unhandled events are
 * recorded as failed rather than silently dropped.
 */
export async function processInboxBatch(
  deps: InboxProcessorDeps,
  limit: number,
): Promise<InboxBatchResult> {
  const events = await deps.inbox.leaseBatch(limit);
  let processed = 0;
  let failed = 0;

  for (const event of events) {
    if (!event.signatureValid) {
      await deps.inbox.markFailed(event.dedupeKey, "signature invalid; refusing to process");
      failed += 1;
      continue;
    }
    const handler = deps.handlers.get(event.type);
    if (!handler) {
      await deps.inbox.markFailed(event.dedupeKey, `no handler for event type '${event.type}'`);
      failed += 1;
      continue;
    }

    try {
      await handler(event);
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

  return { leased: events.length, processed, failed };
}
