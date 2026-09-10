import type { AppendResult, LedgerRepository } from "@corgi/application";
import {
  type AppendableEntry,
  type JournalEntry,
  type LedgerSource,
  type Posting,
  sealNext,
} from "@corgi/domain";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { journalEntries, ledgerAccounts, postings } from "../schema.js";

type EntryRow = typeof journalEntries.$inferSelect;
type PostingRow = typeof postings.$inferSelect;

// A single named lock serializes every append so the head-hash read and the
// insert cannot interleave; without it two concurrent writers could fork the
// chain by sealing onto the same predecessor.
const LEDGER_APPEND_LOCK = 0x4c_45_44_47; // "LEDG"

function toPosting(row: PostingRow): Posting {
  return {
    accountId: row.accountId,
    commodity: row.commodity,
    quantity: row.quantity,
    ...(row.lotId ? { lotId: row.lotId } : {}),
  };
}

function toJournalEntry(row: EntryRow, postingRows: readonly PostingRow[]): JournalEntry {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    effectiveAt: row.effectiveAt,
    postedAt: row.postedAt,
    source: row.source as LedgerSource,
    sourceRef: row.sourceRef,
    description: row.description,
    hash: row.hash,
    postings: postingRows.map(toPosting),
    ...(row.previousHash ? { previousHash: row.previousHash } : {}),
    ...(row.reversesEntryId ? { reversesEntryId: row.reversesEntryId } : {}),
  };
}

/**
 * Postgres-backed ledger. Appends run in a transaction guarded by a session
 * advisory lock; the per-commodity balance is re-checked by a deferred DB
 * constraint trigger, and the tables reject UPDATE/DELETE — so correctness does
 * not depend on the application layer behaving.
 */
export class DrizzleLedgerRepository implements LedgerRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  append(entry: AppendableEntry): Promise<AppendResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${LEDGER_APPEND_LOCK})`);

      const [existing] = await tx
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.idempotencyKey, entry.idempotencyKey))
        .limit(1);
      if (existing) {
        const existingPostings = await tx
          .select()
          .from(postings)
          .where(eq(postings.entryId, existing.id));
        return { status: "duplicate", entry: toJournalEntry(existing, existingPostings) };
      }

      const tip = await tx.execute(sql`
        SELECT e.hash AS hash FROM journal_entries e
        WHERE NOT EXISTS (
          SELECT 1 FROM journal_entries c WHERE c.previous_hash = e.hash
        )
        LIMIT 1
      `);
      const head = (tip.rows[0]?.hash as string | undefined) ?? null;
      const sealed = sealNext(head, entry);

      await tx.insert(journalEntries).values({
        id: sealed.id,
        idempotencyKey: sealed.idempotencyKey,
        kind: sealed.kind,
        effectiveAt: sealed.effectiveAt,
        postedAt: sealed.postedAt,
        source: sealed.source,
        sourceRef: sealed.sourceRef,
        description: sealed.description,
        hash: sealed.hash,
        previousHash: sealed.previousHash ?? null,
        reversesEntryId: sealed.reversesEntryId ?? null,
      });
      await tx.insert(postings).values(
        sealed.postings.map((posting) => ({
          entryId: sealed.id,
          accountId: posting.accountId,
          commodity: posting.commodity,
          quantity: posting.quantity,
          lotId: posting.lotId ?? null,
        })),
      );

      return { status: "inserted", entry: sealed };
    });
  }

  async findByIdempotencyKey(key: string): Promise<JournalEntry | null> {
    const [row] = await this.db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.idempotencyKey, key))
      .limit(1);
    if (!row) return null;
    const postingRows = await this.db
      .select()
      .from(postings)
      .where(eq(postings.entryId, row.id));
    return toJournalEntry(row, postingRows);
  }

  async listForCustomer(
    customerId: string,
    cutoff: { effectiveAt: Date; publishedAt: Date },
  ): Promise<readonly JournalEntry[]> {
    const matching = await this.db
      .selectDistinct({ id: journalEntries.id })
      .from(journalEntries)
      .innerJoin(postings, eq(postings.entryId, journalEntries.id))
      .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
      .where(
        and(
          eq(ledgerAccounts.customerId, customerId),
          lte(journalEntries.effectiveAt, cutoff.effectiveAt),
          lte(journalEntries.postedAt, cutoff.publishedAt),
        ),
      );

    const ids = matching.map((row) => row.id);
    if (ids.length === 0) return [];

    const entryRows = await this.db
      .select()
      .from(journalEntries)
      .where(inArray(journalEntries.id, ids))
      .orderBy(journalEntries.postedAt, journalEntries.effectiveAt);
    const postingRows = await this.db
      .select()
      .from(postings)
      .where(inArray(postings.entryId, ids));

    const byEntry = new Map<string, PostingRow[]>();
    for (const row of postingRows) {
      const group = byEntry.get(row.entryId) ?? [];
      group.push(row);
      byEntry.set(row.entryId, group);
    }

    return entryRows.map((row) => toJournalEntry(row, byEntry.get(row.id) ?? []));
  }
}
