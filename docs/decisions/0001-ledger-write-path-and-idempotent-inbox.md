# 0001 — Ledger write path and idempotent inbox

Records the decisions made building the T2–T8 ledger core: how entries are
persisted, how the hash chain stays intact under concurrency, how reads and
writes reach Postgres, and how inbound events become ledger effects exactly
once.

## Ports and adapters around the write path

- **Decision:** The application layer defines the `LedgerRepository` and `InboxRepository` ports and the `postJournalEntry` / `processInboxBatch` use-cases; concrete Drizzle adapters live in the database package and are assembled in each app. The application layer never imports Drizzle or Postgres.
- **Why:** The financial write path is the highest-value, most-tested code. Keeping it behind ports lets it be exercised in-memory (fakes) without a database, and lets the persistence technology change without touching business rules.
- **Consequences:** Use-cases are unit-tested against in-memory fakes that honour the same contract as Postgres. The database package depends on the application ports and the domain; apps are the only composition roots that bind adapters to use-cases.

## Sealed, atomic, append-only entries

- **Decision:** An append seals the entry (compute `previousHash` link + SHA-256 `hash`) and inserts it inside one transaction guarded by a Postgres session advisory lock. The chain tip is the entry whose hash no other entry references. Corrections are new reversing entries, never mutations.
- **Why:** The head-hash read and the insert must not interleave, or two concurrent writers could seal onto the same predecessor and fork the chain. A single serialization point keeps the chain linear and tamper-evident, and a pure `verifyHashChain` can re-derive it from genesis.
- **Consequences:** Appends are serialized (acceptable for this workload; the lock is held only for the insert). Tampering with any earlier entry breaks every subsequent hash. The domain owns the hashing rule; the adapter owns atomicity.

## Reads over HTTP, writes over a pooled connection

- **Decision:** Read paths (server components, MCP reads) use Neon's stateless HTTP driver; the write path uses the WebSocket-backed pooled driver so it can run interactive `BEGIN … COMMIT` transactions.
- **Why:** The hash-chain append and the deferred balance check require a real interactive transaction, which the HTTP driver cannot provide. Reads have no such need and are cheaper and simpler over HTTP.
- **Consequences:** Two connection factories exist (`createDatabase` for reads, `createTransactionalDatabase` for writes). The write connection is reused per process and closed on shutdown.

## Exactly-once effect from an idempotent inbox

- **Decision:** Webhooks and SSE land in one inbox deduped on `dedupeKey` (ON CONFLICT DO NOTHING); every ledger command derived from an event carries an `idempotencyKey`, and delivery status is an append-only trail of processing attempts.
- **Why:** Providers deliver at-least-once and out-of-order, and the same economic fact can arrive on two channels. Two independent guards — ingress dedupe and ledger idempotency — make replays and retries no-ops in effect, and independent handlers make arrival order irrelevant.
- **Consequences:** A replayed or double-delivered event produces at most one posting; an event is re-leased until an attempt records `processed`. Signature-invalid or unhandled events are recorded as failed rather than silently dropped.

## Defence-in-depth invariants

- **Decision:** The per-commodity balance and append-only rules are enforced in the domain **and** independently in Postgres (a deferred balance-check trigger and UPDATE/DELETE rejection plus revoked grants); the hash chain is enforced in the application write path.
- **Why:** A financial ledger should not rely on the application behaving. If a bug or a direct SQL write bypasses the use-case, the database still refuses an unbalanced or mutated entry.
- **Consequences:** The same invariant is expressed twice (code and SQL). This is deliberate redundancy, kept in sync through migrations and tests, not a single source of truth to be "simplified".
