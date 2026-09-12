# 0007 - Broker outages

**When:** 2026-09-11

## Queued orders

- **Decision:** Broker 5xx or timeout -> store order as `approved` without provider id; worker re-sends every 30s with same `client_order_id`.
- **Why:** Outage becomes delay, not a failed model pick. Alpaca sandbox returns `500 50010000` tenant-wide (support ticket open).
- **Consequences:** UI shows “queued”; fills still wait on SSE when broker accepts.

## Orders in flight

- **Decision:** `chooseModel` blocked while any non-closed order exists.
- **Why:** Available cash only drops on fill; second pick would double-spend.
- **Consequences:** `409 orders_in_flight` until queue clears.

## One container

- **Decision:** Default Docker image runs API + worker together on Render free tier.
- **Why:** No free background worker; processes share no memory state.
- **Consequences:** Instance sleeps when idle; first request slow; crons only run while awake.
