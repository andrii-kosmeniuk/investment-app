# Corgi Ledger

A US retail-investing work trial built around immutable accounting, live sandbox
integrations, bitemporal performance, and operational reconciliation.

A customer signs up, verifies identity (Persona), links a bank (Plaid Link),
deposits (Plaid Transfer), chooses a model portfolio (orders to Alpaca Broker),
and then sees positions, time- and money-weighted performance, an activity
history that is corrected but never rewritten, and a statement. Operators get a
maker-checker console, a reconciliation desk against the morning custodian
file, and a live-fire panel that fires the plan's failure scenarios on demand.

## Architecture

The repository is a pnpm/Turborepo monorepo. Dependency direction is inward:

```text
apps/web ───────────────→ packages/ui
apps/api ──→ application ←── integrations
    │              │
    └──→ database  └──→ domain
apps/worker ───────┘
apps/api ───────────────→ packages/mcp
```

- `apps/web`: Next.js presentation only. It never imports database or provider code and holds no provider secrets.
- `apps/api`: Fastify composition root, customer + ops HTTP, signed webhook receivers, MCP transport.
- `apps/worker`: Alpaca SSE consumer, Plaid event sync, inbox processor, order re-sender, scheduled settlement / valuation / custodian / reconciliation jobs.
- `packages/domain`: pure financial types and invariants; no framework, network, or database imports.
- `packages/application`: use cases and the ports they need from infrastructure.
- `packages/contracts`: versionable Zod DTOs shared by API and web; bigints cross JSON as strings.
- `packages/database`: Drizzle schema, repositories, PostgreSQL financial controls (balanced-entry trigger, maker ≠ checker trigger).
- `packages/integrations`: provider adapters behind application ports (Alpaca, Plaid, Persona, custodian simulator).
- `packages/ui`: visual tokens, motion grammar, financial formatting primitives.
- `packages/mcp`: agent tools; writes can only create human approval requests.

### Runtime topology

```text
 Vercel                      Render (one free web service, one container)         Neon Postgres
┌──────────────┐   HTTPS    ┌───────────────────────────────────────────────┐    ┌──────────────┐
│ apps/web     │──────────▶ │ apps/api  :4000  (pid 1)                       │───▶│ ledger,      │
│ Next.js      │            │   /v1/customer/*  /v1/ops/*  /webhooks/*  /mcp │    │ inbox, orders│
└──────────────┘            │ apps/worker      (restarted by the CMD loop)   │───▶│ valuations…  │
                            │   SSE ◀── Alpaca   sync ◀── Plaid   crons      │    └──────────────┘
                            └───────────────────────────────────────────────┘
                                   ▲ webhooks: Persona (HMAC), Plaid (JWT)
```

Both processes share one image and one database and no in-memory state
(ADR-0007). `render.yaml` still describes the two-service layout for a paid
plan. The free instance sleeps after ~15 idle minutes: loops and crons run only
while it is awake, and the first request after sleep takes a few seconds.

### Event flow

Every provider fact enters through the **inbox** (`inbound_events`, deduplicated
by `dedupe_key`) and is applied by an idempotent handler; nothing writes to the
ledger from a request handler.

| Fact | Arrives via | Handler | Ledger effect |
| --- | --- | --- | --- |
| KYC outcome | Persona webhook, or a status poll when the customer returns to onboarding | `applyInquiryStatus` | none; opens the funding/trading gate |
| Deposit pending / settled / returned | Plaid `/transfer/event/sync` (15 s) and Plaid webhook | `recordTransferEvent`, `handleDepositReturn` | `Cash:Pending` → `Cash:Settled`; a return books a recovery receivable and blocks trading |
| Fill / partial fill | Alpaca SSE `/v2/events/trades` | `applyFill` | positions in micro-units, unsettled cash, FIFO tax lots |
| Trade-date +1 | 00:05 ET cron | `settleTrades` | `Cash:Unsettled` → `Cash:Settled` |
| Closing prices | 20:15 ET cron (7-day lookback re-pull) | `collectClosingPrices` | versioned `prices`; a changed close restates |
| Valuation & returns | 20:30 ET cron | `valuePortfolios` | daily `valuations`, MTD/YTD/inception TWR + Modified Dietz |
| Custodian file | 06:00 ET cron (simulator) | `importCustodianFile` | none |
| Reconciliation | 06:10 ET cron | `reconcileCustodian` | none; breaks age until explained or adjusted with approval |

## Live vs simulated

| Component | Status | Notes |
| --- | --- | --- |
| Persona identity | **live sandbox** | inquiry created per customer; HMAC-verified webhooks; status poll fallback on the onboarding read |
| Plaid Link + Transfer | **live sandbox** | Link token, public-token exchange, `authorization/create` + `transfer/create` (ACH debit), `/transfer/event/sync` cursor, JWT-verified webhooks |
| Plaid settlement timing | **simulated by Plaid, triggered by us** | Sandbox transfers never leave `pending` on their own. The worker asks Plaid's own `/sandbox/transfer/simulate` for `posted` → `settled` one minute after creation (ADR-0008). Amounts `$11.11`, `$33.33` etc. still follow Plaid's automatic paths |
| Alpaca Broker orders | **live sandbox** | notional market/day orders with `client_order_id`; SSE fills. On a broker 5xx or timeout the order is stored as `approved` and re-sent every 30 s (ADR-0007) |
| Alpaca account funding | **cut** | Plaid funds *our* ledger; the JNLC firm→customer journal is on the cut list, so all customers trade on the pre-funded dashboard account named by `ALPACA_SANDBOX_ACCOUNT_ID` |
| Alpaca market data (IEX) | **live sandbox / free feed** | daily closes; corrections re-pulled 7 business days back |
| Custodian morning file | **simulated**, labelled `simulator` | projects our own ledger as of the prior close into the agreed CSV; live-fire can plant tampers |
| Withdrawal payout | **cut** | ledger leg posts under maker-checker; bank credit not sent |

No production keys, real money, or real personal data may be used.

### Known provider state (2026-09-11)

Alpaca's Broker **sandbox** answers `POST /v1/trading/accounts/{id}/orders`
with `500 {"code":50010000}` for this tenant regardless of account, key or body
(reads, account creation and the SSE stream work). Orders therefore queue as
`approved` and complete automatically when Alpaca accepts them; the customer is
told exactly that. Details in `docs/decisions/ASSUMPTIONS.md`.

## Financial representation

- **Currency.** USD only. Money is a signed `BIGINT` of cents end to end
  (database, domain, API as decimal strings). Provider decimals (`"1234.56"`)
  are parsed at the adapter boundary into cents without passing through a
  float; `formatCents` does the reverse. No other currency is accepted; the
  ledger balances per commodity (`USD`, and one commodity per symbol).
- **Quantities.** Security units are signed `BIGINT` micro-units (1e-6 share).
  Fractional fills from Alpaca are parsed the same way.
- **Rounding rule.** One rule, applied once, at the boundary where a decimal
  becomes an integer: **half-even** to the target scale. Inside the system there
  is no rounding because there are no fractions.
- **Allocation.** Splitting a dollar amount across model legs uses Hamilton
  largest-remainder with stable symbol ordering, so the legs always sum to the
  investable amount to the cent and the same inputs always give the same legs.
  Investable = available-to-trade × (1 − cash buffer bps).
- **Journal.** Every entry balances independently per commodity (enforced by a
  deferred database trigger). `effective_at` is economic time; immutable
  `posted_at` is knowledge time. A correction is a new entry or a new price
  version and a restatement row, never an update.
- **Performance.** TWR headline with Modified Dietz alongside; fees are
  external flows (gross-of-fee), dividends are return; flows are
  beginning-of-day. Values are `final` / `provisional` (stale close) /
  `unavailable`.
- **Tax lots.** FIFO; splits adjust lots by ratio and record a `lot_adjustments`
  row.

## Running from zero

Requires Node 22.12+, pnpm, and a Neon Postgres database (the migrator uses the
Neon HTTP driver; any empty Neon branch works).

```bash
cp .env.example .env          # fill DATABASE_URL(+_UNPOOLED), provider sandbox keys, SESSION_SECRET
pnpm install
pnpm db:migrate               # applies packages/database/drizzle/* to an empty database
pnpm seed                     # 4 models, 4 operator actors, olivia@demo.corgi (approved) + noah@demo.corgi
pnpm dev                      # web :3000, api :4000, worker
```

Demo password for both seeded customers: `corgi-demo-2026` (`SEED_DEMO_PASSWORD`).
Verified 2026-09-11 on a fresh Neon branch: migrate + seed on an empty database
yields 4 models / 12 allocations / 4 actors / 2 customers with credentials and an
empty ledger.

### Deploy

- **Render** (Docker, repo root, default stage): runs API + worker. Set every
  variable in `.env.example` except the web-only ones. `ALPACA_SANDBOX_ACCOUNT_ID`
  must be the *funded* dashboard account. Health: `GET /health/live`, `/health/ready`.
- **Vercel** (`apps/web`, `vercel.json` builds from the repo root): only
  `API_BASE_URL=https://<render-host>`, `WEB_ORIGIN=https://<vercel-host>`, `NODE_ENV`.
- Point Persona's webhook at `https://<render-host>/webhooks/persona` and Plaid's
  at `https://<render-host>/webhooks/plaid`. Both are optional: KYC is also
  polled when the customer returns, and deposits are synced every 15 s.

## Verification

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm check:decisions
```

Unit and route tests: domain 32, application 80, API 48, integrations 18, web 24.

### Live-fire rehearsal (PLAN.md §8)

Operator routes take `Authorization: Bearer $LIVE_FIRE_TOKEN` and
`x-operator-id: <human actor id>` (from `GET /v1/ops/operators`). Run twice
against a deployed API on 2026-09-11; the second pass must change nothing it
should not:

| Attack | Endpoint | Observed |
| --- | --- | --- |
| Onboard → link → deposit → invest | customer routes | KYC approved, bank linked, `$55.00` deposit `pending` → `settled` in the ledger 80 s later, model saved; orders queued while Alpaca's sandbox returns 500 |
| Corrected close | `POST /ops/live-fire/corrected-close` | new price version, `customersRestated: 1`; the nightly re-pull later corrects it back and restates again |
| Replay a processed fill/transfer event | `POST /ops/events/:id/replay` | `receive: duplicate`, no second ledger entry |
| Tamper custodian file | `POST /ops/custodian-file` with `tamper` | `source: simulator:tampered`; `POST /ops/reconciliation/run` opens exactly one cash break; explained with a note |
| Settlement job | `POST /ops/live-fire/settle-trades` | idempotent (`alreadySettled` on the second pass) |
| 2-for-1 split | `POST /ops/live-fire/stock-split` | refused with `Customer holds no VTI` until a fill exists; the arithmetic is covered by `valuation.test.ts` |
| Bounce a deposit | Plaid magic amount `$33.33` (R01) | handled by `handleDepositReturn`: reversal, recovery receivable, trading block, sell-to-cover proposal for maker-checker |
| Pull a provider | stop Alpaca / 5xx | orders `queued`, customer told, worker re-sends every 30 s; SSE reconnects with capped backoff and a logged reason |

Decision rationale is indexed in `docs/DECISIONS.md` and `docs/decisions/`
(ADRs 0000–0008, `ASSUMPTIONS.md`, `CUT_LIST.md`). Agent prohibitions are in
`docs/AGENT_BOUNDARIES.md`.
