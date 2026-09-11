# 0004 — Valuation, returns and restatement

- **When:** ADR opened before code ≈2026-09-10 23:10 CEST (T+14:10); decisions ≈2026-09-10 23:10 CEST (T+14:10) → ≈2026-09-10 23:35 CEST (T+14:35); PLAN §4.6 deviation noted 2026-09-10 23:45 CEST (T+14:45); committed a338502 2026-09-10 23:58 CEST (T+14:58). Alpaca sandbox account fallback added 2026-09-11 00:40 CEST (T+15:40), committed 5049171 00:46 (T+15:46)

_Timestamps backfilled 2026-09-11 09:15 CEST from the session transcript and commit times (PLAN.md cadence rule 7: "logged late" with the true time). Wall clock is when the decision was made; T+ is relative to the trial start, 2026-09-10 09:00 CEST (the kickoff commit landed at 11:09, T+2:09). ≈ marks minute-level estimates bracketed by transcript timestamps._

Records the decisions made building PLAN.md T24–T32: the nightly valuation
series, time- and money-weighted returns, and the restatement machinery that
lets a customer see both today's figure and exactly what was published on any
earlier day. ADR-0000 fixed the bitemporal, append-only ledger and the
`valuations` / `period_returns` version tables; ADR-0003 fixed how the
portfolio value is composed and when it is "provisional". This ADR decides
what a valuation *is*, what a *flow* is, how returns are linked, what counts as
a restatement, and how the three live-fire scenarios are reproduced without any
write that bypasses the use-cases.

## What a daily valuation is

- **When:** ≈2026-09-10 23:10 CEST (T+14:10) · `provisional` naming settled 23:45
- **Decision:** `valueCustomer(customerId, asOfDate)` values the books as they stand at `effectiveAt = endOfBusinessDay(asOfDate)` in `America/New_York` (23:59:59.999 local, DST-aware): value = available-to-trade cash + dividend receivable + Σ units × latest close on or before `asOfDate` (highest price version). Pending deposits and bounce receivables are excluded, as on the portfolio page. Status is `final`, or `provisional` when any close used is more than 3 calendar days older than `asOfDate`. A held symbol with no close at all yields **no row** ("unavailable") rather than a smaller number. A customer with no cash, no positions and no history is "empty" and gets no row either: the series starts with the first dollar. Weekends are skipped by the scheduler; a holiday simply reuses the last close and, if nothing changed, writes nothing.
- **Options:** (a) value at the instant the job runs — the figure would depend on when the cron fired and on late-arriving events; (b) value at a fixed cutoff — chosen; (c) value only positions and report cash separately — makes the return series meaningless when cash dominates.
- **Why:** A valuation must be reproducible from the ledger alone: the same `asOfDate` valued again later must give the same number unless a *fact* about that day changed. The end-of-business-day cutoff on the effective axis makes that true; the posted axis (`computedAt`) is what changes when knowledge changes.
- **Deviation from PLAN §4.6:** the plan names the stale state `stale` with a `stale_days` column. It is named `provisional` here so the valuation row, the portfolio page and the contracts use one word for one idea (ADR-0003), and the per-position `priceDate` / `priceStatus` in the `positions` snapshot carries the same information without a derived column.
- **Consequences:** A new `valuations` version is inserted only when the value, status, cash, position snapshot or price-set hash differs from the current version; re-running the nightly job is a no-op (`unchanged`). Each row carries `price_set_hash` (sha256 over `symbol:tradeDate:vN:price` for every position) so a corrected price is visible as a different input, not just a different output. Migration 0004 adds `valuations.status` and the CHECK constraints; the tables stay append-only under the ADR-0000 triggers.

## What counts as an external flow

- **When:** ≈2026-09-10 23:12 CEST (T+14:12)
- **Decision:** External flows are the settled-cash legs of journal entries of kind `deposit_settled`, `deposit_returned`, `withdrawal` and `fee` (and reversals of those). Dividends, trades and settlement movements are *not* flows — dividends are return, trades are internal. Flows are dated on the business date of `effectiveAt` in New York.
- **Options:** (a) treat fees as negative return (net-of-fee TWR) — arguably fairer to the customer; (b) treat fees as flows — chosen, following PLAN.md ("gross of fees"); (c) date flows on `postedAt` — would make a late-booked deposit move a *later* day's return.
- **Why:** PLAN.md asks for a gross-of-fee, time-weighted figure that isolates the model's performance from the customer's cash decisions; fees are the platform's decision. Dating flows on the effective axis is what makes a restatement land on the day the money actually moved.
- **Consequences:** Logged in `ASSUMPTIONS.md` (fees as flows). If Corgi wants net-of-fee, a superseding ADR moves `fee` out of `EXTERNAL_FLOW_KINDS` and both figures restate — which is exactly the machinery below.

## Time-weighted and money-weighted returns

- **When:** ≈2026-09-10 23:15 CEST (T+14:15)
- **Decision:** TWR is chain-linked over sub-periods between consecutive *stored* valuations, with flows at the beginning of the day they occur: `r = (V_close − F − V_open) / V_open`; a zero or missing opening value starts the chain rather than dividing by zero. MWR is Modified Dietz over the whole period with day-weights `(daysBetween(flowDate, periodEnd) + 1) / periodDays`, i.e. a deposit on day one is fully invested for the period; it is `null` when the denominator is zero. Periods are `mtd`, `ytd`, `inception` (inception start = day before the first valuation). Returns are stored as `twr_bps_e4` / `mwr_bps_e4` = fraction × 1e8 as bigint; a new `period_returns` version is written only when TWR, MWR, flows or period start changed.
- **Options:** (a) daily TWR with flows at end of day — deposits made in the morning would be excluded from that day's return; (b) BOD convention — chosen; (c) IRR instead of Dietz — needs a solver, no extra grading value; (d) store returns as floats — loses idempotence (two runs could differ in the last bit and create a phantom version).
- **Why:** Both figures answer a different question and the brief wants both: TWR is the model, MWR is the customer including their timing. Storing an integer scaled to 1e-8 makes "did anything change?" an exact comparison and keeps the tables append-only and idempotent.
- **Consequences:** `period_returns` gains a `period` column and the unique key becomes `(customer, period, period_end, version)`. The API serialises returns as fractions (`0.0341`); the web formats them. 1e-8 precision (0.000001%) is the display floor — tests compare to 8 places.

## Restatement: same use-cases, new versions, nothing erased

- **When:** ≈2026-09-10 23:20 CEST (T+14:20)
- **Decision:** `restate(customerId, fromDate, reason)` re-runs `valueCustomer` for every date that already has a valuation on or after `fromDate`, then `computePeriodReturns` for each of those dates. Each rewritten row is a new version with `supersedes_id` pointing at the one it replaces and a machine-readable `reason` (`corrected_close:VTI@2026-09-09`, `late_dividend:VTI@2026-09-02`, `split:VTI:2-for-1@2026-09-03`, `scheduled`). "As published on D" reads versions with `computed_at ≤ endOfBusinessDay(D)`. The **Restated** pill shows only when a *visible* earlier version carried a *different* number ("Restated on … · was …"); a re-versioned row with the same figure (e.g. a split that changes the snapshot but not the value) shows no pill.
- **Options:** (a) update rows in place — forbidden by the ADR-0000 triggers and would destroy the as-published view; (b) mark restated rows with a flag only — loses the previous number; (c) full version chain — chosen.
- **Why:** The differentiator is that the customer can always be shown what they were shown, with the reason the number moved. The version chain gives that for free, and the same three functions serve the nightly job, the restatement and the live-fire console, so the demo is the system.
- **Consequences:** The restatement audit (`GET /v1/ops/restatements`, `/ops/restatements`) is a read over `version > 1` in both tables, newest `computed_at` first. The customer's `/performance` page has an "as published on" date field; the MCP `get_performance` honours `asPublishedOn` through the same read model (`1M→mtd`, `YTD→ytd`, `ALL→inception`; `1W` has no stored series — cut list).

## The three live-fire scenarios

- **When:** ≈2026-09-10 23:25 CEST (T+14:25)
- **Decision:**
  - *Corrected close:* `recordCloses` inserts a new price version when a received close differs from the current one for `(symbol, tradeDate)` (identical values are a no-op); each customer holding the symbol is restated from the earliest corrected date. The nightly 20:15 ET collector re-pulls a `VALUATION_LOOKBACK_DAYS` (default 7) window so a provider-side correction is picked up without an operator.
  - *Late dividend:* `recordDividend` books the entitlement (`receivable:dividend` ← `income:dividend`) effective at the ex-date market close (16:00 ET) with `postedAt = now`, then the payment (`cash:settled` ← `receivable:dividend`) on the pay date; a pay date in the future is deferred. Idempotency keys `dividend:{sym}:{exDate}:{customer}:{entitlement|paid}` make replay a no-op. Restates from the ex-date.
  - *Stock split:* `applyStockSplit` posts a units-only entry (`position:{sym}` vs `firm:custody:street:{sym}`), writes `lot_adjustments` so every open lot's basis-per-unit is divided by the ratio (12-decimal string, half-even), and records split-adjusted closes as new price versions from the effective date. Value and TWR must be unchanged; the console response reports `valueUnchanged`.
- **Options:** For the split, (a) wait for the market-data feed to serve adjusted history — we do not control the sandbox feed; (b) let the simulator adjust our stored closes — chosen and logged as an assumption; (c) leave prices and accept a phantom −50% day — wrong by construction.
- **Why:** Each scenario must go through the ledger and the same valuation functions, so that the customer-facing consequences (pill, as-published view, audit row) are emergent rather than staged.
- **Consequences:** Sell-side lot consumption after a split (units in consumptions vs adjusted lots) is scaled in `availableLots` but not yet exercised end-to-end — cut list. Prices from the simulator are labelled by their `reason`, so a reviewer can tell an adjusted close from a feed close.

## Operator boundary for live fire

- **When:** ≈2026-09-10 23:30 CEST (T+14:30)
- **Decision:** `/v1/ops/*` is guarded by a separate `LIVE_FIRE_TOKEN` (≥24 chars) compared in constant time; unset → `503 live_fire_not_configured`, wrong → `401`. The web never holds this token as configuration: an operator pastes it once on `/ops/live-fire`, the web verifies it against the API and stores it only in an httpOnly `SameSite=Strict` cookie scoped to `/ops` for eight hours.
- **Options:** (a) reuse `MCP_API_KEY` — mixes an agent credential with a destructive operator one; (b) put `LIVE_FIRE_TOKEN` in the web server's env — every visitor to the web app could fire scenarios; (c) per-operator cookie after verification — chosen.
- **Why:** Live fire writes real ledger entries and rewrites published figures; it must be impossible to trigger without an operator credential, and rotating that credential on Render must revoke everyone.
- **Consequences:** `render.yaml` adds `LIVE_FIRE_TOKEN` (`generateValue`) and `ALPACA_MARKET_DATA_BASE_URL` to `corgi-api`, and `ALPACA_MARKET_DATA_BASE_URL` + `VALUATION_LOOKBACK_DAYS` to `corgi-worker`. Nothing on Vercel changes. No maker-checker on live-fire actions in v1: they are sandbox scenarios, not customer money movements.

## Scheduling

- **When:** ≈2026-09-10 23:35 CEST (T+14:35)
- **Decision:** Two weekday cron jobs in `America/New_York`: 20:15 collect closes for the held ∪ model universe over the lookback window (corrections → restatement), 20:30 value every customer with ledger accounts for every weekday in the window and compute period returns. Both are idempotent and can be re-run from the console (`run-valuation`, `collect-closes`).
- **Why:** Alpaca's daily bars are final well before 20:00 ET; running both jobs from the same window means a missed night self-heals the next one.
- **Consequences:** No NYSE holiday calendar in v1 — a holiday reuses the previous close and records nothing new (cut list).
