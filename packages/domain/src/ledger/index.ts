import { createHash } from "node:crypto";

export type Commodity = "USD" | (string & {});
export type LedgerSource =
  | "alpaca"
  | "plaid"
  | "persona"
  | "custodian"
  | "system"
  | "ops"
  | "agent";

export interface Posting {
  readonly accountId: string;
  readonly commodity: Commodity;
  readonly quantity: bigint;
  readonly lotId?: string;
}

export interface JournalEntry {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly effectiveAt: Date;
  readonly postedAt: Date;
  readonly source: LedgerSource;
  readonly sourceRef: string;
  readonly description: string;
  readonly postings: readonly Posting[];
  readonly reversesEntryId?: string;
  readonly previousHash?: string;
  readonly hash: string;
}

export type UnhashedJournalEntry = Omit<JournalEntry, "hash">;

/**
 * An entry ready to be appended: the domain author supplies everything except
 * the two fields the ledger owns — the position in the hash chain
 * (`previousHash`) and the resulting `hash`. Sealing fills both.
 */
export type AppendableEntry = Omit<JournalEntry, "hash" | "previousHash">;

export class UnbalancedJournalError extends Error {
  override readonly name = "UnbalancedJournalError";
  constructor(readonly balances: ReadonlyMap<Commodity, bigint>) {
    super(
      `Journal does not balance: ${[...balances]
        .map(([commodity, value]) => `${commodity}=${value}`)
        .join(", ")}`,
    );
  }
}

export function commodityBalances(
  postings: readonly Posting[],
): ReadonlyMap<Commodity, bigint> {
  const balances = new Map<Commodity, bigint>();
  for (const posting of postings) {
    balances.set(
      posting.commodity,
      (balances.get(posting.commodity) ?? 0n) + posting.quantity,
    );
  }
  return balances;
}

export function assertBalanced(postings: readonly Posting[]): void {
  if (postings.length < 2) throw new UnbalancedJournalError(commodityBalances(postings));
  const nonZero = new Map(
    [...commodityBalances(postings)].filter(([, balance]) => balance !== 0n),
  );
  if (nonZero.size > 0) throw new UnbalancedJournalError(nonZero);
}

function canonicalize(entry: UnhashedJournalEntry): string {
  return JSON.stringify({
    ...entry,
    effectiveAt: entry.effectiveAt.toISOString(),
    postedAt: entry.postedAt.toISOString(),
    postings: entry.postings.map((posting) => ({
      ...posting,
      quantity: posting.quantity.toString(),
    })),
  });
}

export function sealJournalEntry(entry: UnhashedJournalEntry): JournalEntry {
  assertBalanced(entry.postings);
  const hash = createHash("sha256").update(canonicalize(entry)).digest("hex");
  return { ...entry, hash };
}

/**
 * Seals an appendable entry onto the tip of the chain. The `previousHash` link
 * is part of the hashed payload, so tampering with any earlier entry breaks
 * every hash that follows it.
 */
export function sealNext(previousHash: string | null, entry: AppendableEntry): JournalEntry {
  const unhashed: UnhashedJournalEntry =
    previousHash === null ? { ...entry } : { ...entry, previousHash };
  return sealJournalEntry(unhashed);
}

export interface ChainVerification {
  readonly valid: boolean;
  /** Index of the first entry that fails verification, or null when intact. */
  readonly brokenAt: number | null;
}

/**
 * Recomputes the hash chain from genesis and checks that each entry links to
 * its predecessor and hashes to its stored value. Pure and side-effect free so
 * a "verify chain" action can run anywhere the entries are available.
 */
export function verifyHashChain(entries: readonly JournalEntry[]): ChainVerification {
  let previousHash: string | null = null;
  let index = 0;
  for (const entry of entries) {
    if ((entry.previousHash ?? null) !== previousHash) return { valid: false, brokenAt: index };
    const { hash: _hash, previousHash: _previousHash, ...appendable } = entry;
    const resealed = sealNext(previousHash, appendable);
    if (resealed.hash !== entry.hash) return { valid: false, brokenAt: index };
    previousHash = entry.hash;
    index += 1;
  }
  return { valid: true, brokenAt: null };
}

export interface BalanceCutoff {
  readonly effectiveAt: Date;
  readonly publishedAt: Date;
}

export function deriveBalances(
  entries: readonly JournalEntry[],
  cutoff: BalanceCutoff,
): ReadonlyMap<string, ReadonlyMap<Commodity, bigint>> {
  const accounts = new Map<string, Map<Commodity, bigint>>();
  for (const entry of entries) {
    if (entry.effectiveAt > cutoff.effectiveAt || entry.postedAt > cutoff.publishedAt) continue;
    for (const posting of entry.postings) {
      const balances = accounts.get(posting.accountId) ?? new Map<Commodity, bigint>();
      balances.set(
        posting.commodity,
        (balances.get(posting.commodity) ?? 0n) + posting.quantity,
      );
      accounts.set(posting.accountId, balances);
    }
  }
  return accounts;
}

export * from "./patterns.js";
