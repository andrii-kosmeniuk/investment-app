# 0002 — Provider integrations and the event-driven ledger

- **When:** integration decisions ≈2026-09-10 12:15 CEST (T+3:15) → ≈2026-09-10 13:10 CEST (T+4:10); deployment decisions ≈2026-09-10 16:15 CEST (T+7:15) → ≈2026-09-10 16:35 CEST (T+7:35) while bringing Render/Vercel up; ADR completed 16:42; committed 72b68e9 2026-09-10 16:46 CEST (T+7:46)

_Timestamps backfilled 2026-09-11 09:15 CEST from the session transcript and commit times (PLAN.md cadence rule 7: "logged late" with the true time). Wall clock is when the decision was made; T+ is relative to the trial start, 2026-09-10 09:00 CEST (the kickoff commit landed at 11:09, T+2:09). ≈ marks minute-level estimates bracketed by transcript timestamps._

Records the decisions made building the T8–T14 live-integration slice:
onboarding (Persona KYC), funding (Plaid transfers), and investing (Alpaca
notional orders and fills). It covers how provider events become ledger effects,
where each flow runs, how the customer-facing controls are enforced, and how the
three deployables (Vercel web, Render API, Render worker) connect to Neon — all
without letting provider payload shapes leak into the domain.

## Provider integrations sit behind ports with pure mappers at the edge

- **When:** ≈2026-09-10 12:15 CEST (T+3:15)
- **Decision:** Each provider is a thin adapter implementing an application port (`BrokerPort`, `FundingPort`, `IdentityPort`), and every raw provider payload is turned into a normalized domain event by a **pure** mapper (`parseAlpacaFillEvent`, `parsePlaidTransferEvent`, `parsePersonaInquiryEvent`) in the integrations package. Use-cases only ever see normalized inputs (`InquiryEvent`, `TransferEvent`, `FillEvent`, `PlaceOrderCommand`).
- **Why:** Provider payloads are messy, versioned, and untyped; the domain and use-cases must not depend on them. Isolating the shape-knowledge in pure functions makes the risky parsing fully unit-testable without network or SDKs, and lets a provider be swapped by rewriting one adapter + mapper.
- **Consequences:** There is one translation seam per provider. Mappers return `null` for events that carry no ledger meaning (e.g. `transfer.created`, Alpaca `new`), so the caller can drop them cleanly. Persona webhooks must use kebab-case key inflection so `reference-id` parses correctly. The application layer stays free of Alpaca/Plaid/Persona field names.

## A normalized inbox vocabulary with effectful, idempotent handlers

- **When:** ≈2026-09-10 12:25 CEST (T+3:25)
- **Decision:** Events are normalized to a small canonical type vocabulary at ingestion (`trade.fill`, `trade.partial_fill`, `transfer.pending`, `transfer.settled`, `transfer.returned`, `kyc.updated`), stored in the inbox, and dispatched by an effectful handler `(event) => Promise<void>` wired in the worker composition root. Handlers delegate to use-cases (`applyInquiryStatus`, `recordTransferEvent`, `applyFill`); the processor itself stays provider-agnostic.
- **Why:** The T2–T8 processor returned ledger commands only, but funding, KYC, and fills each need more than a posting (customer-state updates, lot creation, order bookkeeping). Normalizing types at the SSE consumer, Plaid sync loop, and Persona webhook route keeps the dispatch map small and makes out-of-order delivery irrelevant.
- **Consequences:** Idempotency lives in the use-cases (ledger `idempotencyKey`, repository upserts, cumulative-fill accounting). Immaterial provider events are dropped at ingestion. Unknown or signature-invalid events are recorded as failed. Persona webhooks are stored as `kyc.updated` regardless of the raw `inquiry.*` subtype.

## Plaid transfer amounts come from our transfer record, not the sync event

- **When:** ≈2026-09-10 12:40 CEST (T+3:40)
- **Decision:** Plaid `/transfer/event/sync` payloads carry only `transfer_id` and `event_type`; the handler looks up `customerId` and `amountCents` from our own `transfers` row (keyed by `providerTransferId`) before calling `recordTransferEvent`.
- **Why:** Plaid never ships the dollar amount on transfer events, so booking from the webhook or sync body would be wrong or impossible. The amount was fixed at transfer creation time and belongs in our database of record.
- **Consequences:** A sync event for an unknown `transfer_id` fails the inbox attempt (surfaced in `inbound_event_attempts`) rather than posting a wrong amount. Deposit creation must persist the transfer row before events are expected.

## Ledger accounts are ensured on demand by canonical path

- **When:** ≈2026-09-10 12:50 CEST (T+3:50)
- **Decision:** `AccountResolver` (`DrizzleAccountResolver`) creates any missing `ledger_accounts` row idempotently (`ON CONFLICT DO NOTHING` on unique `path`) and returns stable ids for customer cash/position accounts and firm clearing accounts before a use-case builds postings.
- **Why:** Posting patterns need synchronous `accountId` lookups per symbol, but accounts cannot be hand-seeded for every customer and symbol up front. Canonical paths (`customer:{id}:cash:settled`, `firm:clearing:trading-units:{symbol}`, …) make the chart of accounts deterministic and reviewable.
- **Consequences:** The first event for a customer+symbol pays a small ensure cost inside the write transaction's surrounding calls. Path naming is part of the contract; changing it requires a migration, not a code tweak.

## Fills use cumulative accounting and open lots linked to their entry

- **When:** ≈2026-09-10 13:00 CEST (T+4:00)
- **Decision:** A buy fill books only the **incremental** units since the last known cumulative fill, computes cost with half-even valuation, posts the `buy_fill` entry, and opens a FIFO tax lot referencing that entry's id. The lot and order update run only when the ledger append actually inserted.
- **Why:** Brokers redeliver and reorder fill events and report cumulative quantities; naive per-event booking would double-count. Cumulative accounting plus gating side effects on the ledger insert means a replayed execution never double-books a lot, and the lot always points at the exact entry that created it.
- **Consequences:** The entry id is generated up front and passed into the append so the lot's foreign key is satisfiable. Sell fills are explicitly rejected for now — they arrive with the rebalancing flow (a later block) — rather than being half-implemented. Out-of-order partials that regress the cumulative are no-ops.

## Customer controls enforced at the use-case boundary

- **When:** ≈2026-09-10 13:10 CEST (T+4:10)
- **Decision:** `placeOrder` enforces the retail controls in one place: KYC must be `approved` and trading unblocked, a broker account must exist, buys must fit available-to-trade, and any order at/above the confirmation threshold is diverted to the human maker-checker queue instead of being submitted. `applyInquiryStatus` is the only writer of the KYC gate, unblocking trading solely on an approved inquiry.
- **Why:** These are the money-movement guardrails a reviewer will ask about; they belong in a testable use-case, not scattered across routes or the UI. Making KYC the single gate keyed off Persona outcomes gives one auditable state machine for "may this customer move money?".
- **Consequences:** The controls are unit-tested against fakes (rejects pre-KYC, rejects overspend, routes large orders to approval, submits small ones). Available-to-trade is injected as a function so `placeOrder` needs no ledger dependency. The threshold is configuration, not a constant buried in logic.

## Three deployables: web on Vercel, API and worker on Render

- **When:** ≈2026-09-10 16:15 CEST (T+7:15) · forced by the first Render boot failure (16:11)
- **Decision:** The frontend deploys on Vercel (`apps/web` via Turborepo filter). The HTTP API deploys on Render as a Docker web service (`node apps/api/dist/server.js`, health at `/health/live`). The Alpaca SSE consumer, Plaid sync poller, and inbox processor run in a separate Render **background worker**. Secrets are set per service in the host dashboard (`sync: false` in `render.yaml`); local `.env` is never uploaded.
- **Why:** Vercel cannot host long-lived SSE or cron. Splitting API and worker keeps the public surface minimal (webhooks + MCP) while the always-on consumer stays off the request path. Docker's default stage must be the API image — the Dockerfile ends with `FROM api` because an earlier worker stage would otherwise become the default CMD.
- **Consequences:** `WEB_ORIGIN` on the API must be the stable Vercel production domain (no trailing slash) for CORS. `MCP_API_KEY` is a self-generated shared secret (≥24 chars), not issued by a provider. Alpaca keys belong on the worker only. Render assigns the public hostname (copy from the dashboard; do not guess). Free-tier API instances spin down when idle and cold-start on the first external hit.

## Neon pooled reads, direct writes; API boot tolerates missing provider keys

- **When:** ≈2026-09-10 16:35 CEST (T+7:35)
- **Decision:** `DATABASE_URL` uses Neon's **pooled** host (`-pooler`) for the API's HTTP read path. Migrations and the worker's ledger writes use `DATABASE_URL_UNPOOLED` (direct host) because interactive transactions and advisory locks need a real session PgBouncer cannot hold. Plaid and Persona secrets are optional at API boot: webhook routes return `503` when unconfigured rather than crashing the process.
- **Why:** ADR-0001 split read/write drivers for correctness under Neon serverless; the worker inherits the write-path rule. Requiring every sandbox key before the API can listen blocked deployment when Persona or Plaid signup lagged behind Neon and Alpaca.
- **Consequences:** Render's API service needs at minimum `DATABASE_URL`, `MCP_API_KEY`, and `WEB_ORIGIN` to boot; Plaid/Persona vars enable their webhook routes. The worker needs `DATABASE_URL_UNPOOLED` (or falls back to `DATABASE_URL`), plus Alpaca keys. Persona's webhook URL must target the API host at `/v1/webhooks/persona`. Plaid webhooks are verified and acked only — authoritative transfer state still comes from the worker's `/transfer/event/sync` loop.
