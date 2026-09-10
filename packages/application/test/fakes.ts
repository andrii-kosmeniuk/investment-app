import { type AppendableEntry, type JournalEntry, sealNext } from "@corgi/domain";
import type {
  AppendResult,
  Clock,
  IdGenerator,
  InboxEvent,
  InboxRepository,
  LedgerRepository,
} from "../src/index.js";

/**
 * Single-threaded, in-memory stand-in for the real Drizzle ledger. It applies
 * the same append contract the port requires — seal onto the chain tip and
 * dedupe on idempotency key — so use-case tests exercise the real semantics
 * without a database. Concurrency (the advisory lock) is a persistence concern
 * verified against Postgres, not here.
 */
export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly entries: JournalEntry[] = [];
  private readonly byKey = new Map<string, JournalEntry>();
  private tip: string | null = null;

  append(entry: AppendableEntry): Promise<AppendResult> {
    const existing = this.byKey.get(entry.idempotencyKey);
    if (existing) return Promise.resolve({ status: "duplicate", entry: existing });

    const sealed = sealNext(this.tip, entry);
    this.entries.push(sealed);
    this.byKey.set(sealed.idempotencyKey, sealed);
    this.tip = sealed.hash;
    return Promise.resolve({ status: "inserted", entry: sealed });
  }

  findByIdempotencyKey(key: string): Promise<JournalEntry | null> {
    return Promise.resolve(this.byKey.get(key) ?? null);
  }

  listForCustomer(
    _customerId: string,
    cutoff: { effectiveAt: Date; publishedAt: Date },
  ): Promise<readonly JournalEntry[]> {
    return Promise.resolve(
      this.entries.filter(
        (entry) =>
          entry.effectiveAt <= cutoff.effectiveAt && entry.postedAt <= cutoff.publishedAt,
      ),
    );
  }

  get all(): readonly JournalEntry[] {
    return this.entries;
  }
}

export class InMemoryInboxRepository implements InboxRepository {
  private readonly events = new Map<string, InboxEvent>();
  private readonly processed = new Set<string>();
  readonly failures = new Map<string, string>();

  receive(event: InboxEvent): Promise<"inserted" | "duplicate"> {
    if (this.events.has(event.dedupeKey)) return Promise.resolve("duplicate");
    this.events.set(event.dedupeKey, event);
    return Promise.resolve("inserted");
  }

  leaseBatch(limit: number): Promise<readonly InboxEvent[]> {
    const pending = [...this.events.values()].filter(
      (event) => !this.processed.has(event.dedupeKey),
    );
    return Promise.resolve(pending.slice(0, limit));
  }

  markProcessed(dedupeKey: string): Promise<void> {
    this.processed.add(dedupeKey);
    this.failures.delete(dedupeKey);
    return Promise.resolve();
  }

  markFailed(dedupeKey: string, error: string): Promise<void> {
    this.failures.set(dedupeKey, error);
    return Promise.resolve();
  }
}

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export function sequentialIds(prefix = "entry"): IdGenerator {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}
