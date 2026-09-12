# 0007 — Queue orders through broker outages and run API plus worker in one container

- **When:** 2026-09-11 20:13 CEST (T+35:13)
- **Status:** accepted
- **Context:**
  Two production findings on 2026-09-11 afternoon.
  1. Alpaca's Broker **sandbox** answers `POST /v1/trading/accounts/{id}/orders`
     with `500 {"code":50010000,"message":"internal server error occurred"}`
     for our whole tenant: every account (funded and unfunded), every order
     shape (`notional`, `qty`, with and without `client_order_id`), while
     `GET` reads, `POST /v1/accounts` and the `/v2/events/trades` SSE stream
     work with the same key. An unfunded account should have answered
     `403 insufficient buying power`, so this is not our request. Until this
     point `chooseModel` saved the model, then failed on the first leg with a
     `502 provider_unavailable`, leaving "model changed, nothing invested" with
     no path to completion except the customer choosing again.
  2. Render's free tier has no free Background Worker. The single free web
     service ran only the API, so the worker's Plaid sync, inbox processing,
     Alpaca SSE and cron jobs never ran in the deployed environment.
- **Options:**
  - Orders: (a) keep failing the request and let the customer retry;
    (b) treat a broker 5xx / timeout as "not an answer": persist the validated
    order as `approved` with no provider id and have the worker re-send it;
    (c) fall back to REST polling only and drop SSE.
  - Deployment: (a) pay for a Render Background Worker; (b) run the worker as
    a second process in the same container; (c) fold the worker loops into
    the API process.
- **Decision:**
  - Orders → (b). `placeOrder` catches an outage (`isBrokerOutage`: numeric
    `status >= 500`, or `TypeError`/`TimeoutError`/`AbortError` from `fetch`)
    and stores the order in state `approved`, `provider_order_id = null`,
    returning `status: "queued"`. A 4xx still surfaces as before. The worker
    loop `order-retry` (`ORDER_RETRY_MS`, default 30 s) calls
    `submitQueuedOrders`, which re-sends with the original `client_order_id`
    (so a request that actually landed is answered idempotently by Alpaca)
    and moves the row to `submitted` with the provider id. It stops after the
    first outage error in a round rather than hammering a down rail; a 4xx on
    retry is reported as `rejected` for a human.
  - `chooseModel` refuses with `OrdersInFlightError` (HTTP 409
    `orders_in_flight`) while the customer has any order in a non-closed state,
    because available-to-trade only shrinks when a fill books the unsettled
    buy; a second choice would spend the same cash twice. This is the
    "blocked while any order is open" rule already assumed for model changes.
  - Deployment → (b). The Dockerfile's default stage starts
    `node apps/worker/dist/main.js &` then `exec node apps/api/dist/server.js`.
    `render.yaml` still describes the two-service layout for a paid plan.
- **Why:**
  Queuing keeps the ledger honest (nothing is booked until a fill) while
  turning a provider outage from a customer-visible failure into a delay,
  which is what the brief's "pull a provider → orders queued" scenario asks
  for. Idempotency rides on `client_order_id`, so no duplicate-order risk is
  introduced. One container is the only zero-cost way to run both processes
  on Render; the API and worker share no in-memory state, so co-location
  changes nothing about correctness, only about isolation.
- **Consequences:**
  - Customers may see "queued" legs; the UI says so and the portfolio's open
    orders list shows them as `approved`.
  - If Alpaca's sandbox stays broken, orders sit in `approved` indefinitely;
    the ops console's open-orders view is the place to notice it. A cancel
    path for stale queued orders is a week-two item.
  - The free Render instance spins down after ~15 minutes idle: crons and
    loops do not run while it sleeps, and the first request after sleep is
    slow. Acceptable for a demo, documented in the README; a paid instance
    or an external pinger removes it.
  - Worker logs now serialise errors (`err` key) so the reason for a
    disconnect is visible instead of `{}`.
- **Asked Corgi?** Not yet. Filed to Alpaca support: sandbox order `500` on
  tenant, timestamps 2026-09-11 18:03–18:05 UTC.
- **Touches:** `packages/application/src/investing/{place-order,choose-model,submit-queued-orders}.ts`,
  `packages/application/src/errors.ts`, `packages/database/src/repositories/order.ts`,
  `packages/contracts` (`investmentResponse.legs[].status`), `apps/api/src/http.ts`,
  `apps/worker/src/{main,config,jobs}.ts`, `apps/web/src/components/ModelPicker.tsx`, `Dockerfile`.
