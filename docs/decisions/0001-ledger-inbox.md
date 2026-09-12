# 0001 - Ledger inbox

**When:** 2026-09-10

## Ports and adapters

- **Decision:** `LedgerRepository` and `InboxRepository` live in application; Drizzle adapters in `database`; apps wire them.
- **Why:** Test the write path without Postgres.
- **Consequences:** Use-case tests use in-memory fakes.

## Hash chain append

- **Decision:** One transaction + advisory lock seals each entry (`previousHash`, SHA-256 `hash`).
- **Why:** Concurrent writers must not fork the chain.
- **Consequences:** Appends serialize; tampering breaks the chain.

## Neon read vs write

- **Decision:** HTTP driver for reads; pooled WebSocket driver for interactive writes.
- **Why:** Hash append needs a real transaction.
- **Consequences:** `DATABASE_URL` (pooler) and `DATABASE_URL_UNPOOLED` (direct).

## Idempotent inbox

- **Decision:** Ingress dedupes on `dedupeKey`; ledger commands carry `idempotencyKey`.
- **Why:** Providers deliver at-least-once.
- **Consequences:** Replays are no-ops in effect; failed events stay visible.

## Database guards

- **Decision:** Balance trigger + append-only triggers mirror domain rules.
- **Why:** Bugs or ad-hoc SQL should not unbalance the book.
- **Consequences:** Same rules in code and SQL.
