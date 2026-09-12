# 0008 — Advance Plaid sandbox deposits to settled from the worker

- **When:** 2026-09-11 20:40 CEST (T+35:40)
- **Status:** accepted
- **Context:**
  A $55.00 demo deposit created 2026-09-10 22:24 UTC was still `pending` 22
  hours later. Plaid documents that in Sandbox "no events are triggered
  automatically. By default, all transfers … remain at the `pending` status
  until you actively change them" (dashboard buttons, `/sandbox/transfer/simulate`,
  or the magic test amounts $11.11 / $22.22 / $33.33 …). Our ledger books
  `Cash:Settled` only from the `posted`/`settled` event, and `chooseModel`
  invests only settled cash, so a customer who deposits any ordinary amount
  can never invest.
- **Options:**
  (a) Tell demo users to deposit exactly $11.11; (b) book the deposit as
  settled ourselves after a delay, bypassing Plaid; (c) have the worker ask
  Plaid's sandbox to post and settle the transfer, and keep booking from the
  real event stream.
- **Decision:** (c). Worker loop `plaid-sandbox-settle` (every `PLAID_SYNC_MS`)
  selects deposits created within the last 3 days and older than
  `PLAID_SANDBOX_SETTLE_MS` (default 60 s), reads Plaid's current status with
  `/transfer/get`, and for `pending`/`posted` calls
  `/sandbox/transfer/simulate` with `posted` then `settled`. The events then
  arrive through `/transfer/event/sync` exactly as in production and
  `recordTransferEvent` books them idempotently (`plaid:transfer.settled:<id>`).
  The loop is only wired when `PLAID_BASE_URL` contains `sandbox`; the adapter
  refuses to simulate against any other host.
- **Why:**
  The ledger stays fed by provider events only, so the production path is the
  one exercised in the demo. A one-minute delay keeps a visible "pending"
  state for the walkthrough. Magic amounts still work (they are already past
  `pending` when the loop looks) and remain the way to rehearse returns
  ($33.33 → R01) without an operator.
- **Consequences:**
  - Every ordinary sandbox deposit settles about a minute after creation
    while the worker is awake (free Render instance sleeps when idle —
    ADR-0007).
  - `transfers.status` is still "status at creation"; the ledger remains the
    source of truth for settlement, as before.
  - A production deployment must point `PLAID_BASE_URL` at
    `production.plaid.com`, which disables the loop by construction.
- **Asked Corgi?** Not needed; provider behaviour, documented in README
  "live vs simulated".
- **Touches:** `packages/integrations/src/plaid/index.ts` (`isSandbox`,
  `getTransferStatus`, `simulateTransferEvent`), `apps/worker/src/{main,config}.ts`.
