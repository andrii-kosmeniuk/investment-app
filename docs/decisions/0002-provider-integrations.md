# 0002 - Provider integrations

**When:** 2026-09-10

## Adapter boundary

- **Decision:** Alpaca, Plaid, Persona behind ports; pure mappers normalize payloads before use-cases run.
- **Why:** Provider shapes change; domain stays clean.
- **Consequences:** One mapper per provider; Persona webhooks use kebab-case (`reference-id`).

## Inbox vocabulary

- **Decision:** Canonical types (`transfer.settled`, `kyc.updated`, `trade.fill`, …) with idempotent handlers in the worker.
- **Why:** One dispatch map; order of arrival does not matter.
- **Consequences:** Immaterial events dropped; bad signatures marked failed.

## Plaid amounts from our row

- **Decision:** Sync events carry `transfer_id` only; amount comes from our `transfers` table.
- **Why:** Plaid does not send dollars on transfer events.
- **Consequences:** Unknown transfer id -> failed attempt, not a wrong posting.

## Ledger accounts on demand

- **Decision:** `AccountResolver` creates accounts by canonical path (`customer:{id}:cash:settled`, …).
- **Why:** Cannot pre-seed every customer and symbol.
- **Consequences:** First event for a symbol pays a small ensure cost.

## Cumulative fills

- **Decision:** Book only the incremental fill since last cumulative qty; open FIFO lots on successful insert.
- **Why:** Brokers redeliver and reorder fills.
- **Consequences:** Replays never double-book lots.

## Customer gates

- **Decision:** `placeOrder` checks KYC, trading block, cash; large orders need customer confirmation. `applyInquiryStatus` owns the KYC gate.
- **Why:** Money-movement rules belong in one testable place.
- **Consequences:** Pre-KYC and overspend rejected in tests.

## Deploy split

- **Decision:** Web on Vercel, API + worker on Render (Docker).
- **Why:** Vercel cannot host SSE or long polls.
- **Consequences:** `WEB_ORIGIN` on API for CORS; worker holds Alpaca SSE and Plaid sync.

## Neon and optional keys

- **Decision:** Pooled URL for API reads; direct URL for worker writes. API boots without Plaid/Persona keys (webhooks return 503).
- **Why:** Deploy should not block on every sandbox signup.
- **Consequences:** Plaid transfer state comes from worker `/transfer/event/sync`; Plaid webhooks are verify-and-ack only.
