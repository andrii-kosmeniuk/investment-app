# Cut list

This file is append-only during the trial. Add a row when a cut is made.

_"When" is the moment the cut was made: offset from the kickoff commit (2026-09-10 11:09 CEST) plus wall clock. Wall-clock times were added 2026-09-11 09:15 from the session transcript; the T0 rows were decided during the scaffold (≈10:30) and logged with the kickoff commit._

| When | Cut | Why now | Week-two path |
|---|---|---|---|
| T0 · 2026-09-10 ≈10:30 | Native mobile application | Responsive web proves the core loop with one delivery surface | Wrap stable customer flows after accessibility and device testing |
| T0 · 2026-09-10 ≈10:30 | Separate adviser product | One operations console covers approvals and reconciliation | Add adviser-scoped tenancy and bulk portfolio workflows |
| T0 · 2026-09-10 ≈10:30 | Wash-sale adjustments | Correct FIFO lots and restatements carry more grading value | Add substantially-identical security rules and basis carryover |
| T0 · 2026-09-10 ≈10:30 | Specific-ID selection UI | FIFO is defensible and deterministic | Expose eligible lots before order confirmation |
| T0 · 2026-09-10 ≈10:30 | Performance fees and USDC | Outside the core investing loop | Add only after all live-fire scenarios are automated |
| T+7:51 · 2026-09-10 19:00 | WebGL "Higgs field" hero (pointer-driven point lattice on sign-in/onboarding) | Preprocessed dithered nature artwork gives the same visual signature at near-zero runtime cost and no 90-minute risk in the polish block; the visual direction moved to "Quiet Nature / Digital Precision" (`references/ui/design_brief.md` §0) | A shader hero can be added behind the same `DitherArtwork` slot once the product is stable |
| T+9:50 · 2026-09-10 20:59 | Documents / statements nav item (brief §9.8) and the overview performance chart (§11) | No published valuation series exists yet for a customer; a chart of nothing is worse than no chart. Statements need month-end close, which is not in T19–T24 | Add the chart once the valuation worker publishes daily series; statements after the first month-end |
| T+9:50 · 2026-09-10 20:59 | Customer-initiated withdrawals | Deposits exercise the full Plaid rail; withdrawals add the available-to-withdraw gate and a second approval path without new grading value in 48 h | Reuse `createDeposit` shape with `direction: withdrawal`, gate on `availableToWithdrawCents`, route ≥ threshold through confirmation |
| T+9:50 · 2026-09-10 20:59 | Password reset, MFA, sign-in lockout, server-side session revocation | Demo logins are seeded; stateless sessions expire in 12 h | Session table keyed by `jti` for revocation; email reset via a transactional mail provider |
| T+9:50 · 2026-09-10 20:59 | Ops dark theme (`[data-theme="ops"]`) | One palette to verify; the brief already required light everywhere | None planned |
| T+12:01 · 2026-09-10 23:10 | NYSE holiday calendar for the valuation scheduler | Weekends are skipped; a holiday reuses the last close and writes nothing because nothing changed, so the series stays correct without a table | Add an exchange calendar so holidays are not valued at all and "provisional" never trips on a long weekend |
| T+12:01 · 2026-09-10 23:10 | `1W` period in the MCP `get_performance` tool | Stored series are `mtd / ytd / inception`; a rolling week needs the same machinery with a moving start | Add `period` = rolling windows to `computePeriodReturns` |
| T+12:01 · 2026-09-10 23:10 | Sell-side lot consumption after a split, end to end | `availableLots` scales consumptions recorded before an adjustment, but no sell has yet been booked against adjusted lots in a test | Scenario test: buy → split → sell, assert FIFO basis and realised gain |
| T+12:01 · 2026-09-10 23:10 | Trade-date settlement cron (`settleTrades`) | Still a boundary stub; fills book unsettled cash correctly and valuation uses available-to-trade, so returns are unaffected | Move `cash:unsettled-*` to `cash:settled` on T+1 |
| T+12:01 · 2026-09-10 23:10 | Maker-checker on live-fire actions | Sandbox scenarios behind a dedicated operator token; not customer money movements | Route through `approval_requests` if live fire is ever pointed at production data |
| T+21:59 · 2026-09-11 09:08 | Alpaca-side funding (`JNLC` firm→customer journal on deposit settlement) | Plaid funds our ledger, but nothing moves cash into the customer's Alpaca account; the demo customer is bound to the pre-funded sandbox dashboard account so orders can fill. Accounts opened through `POST /v1/accounts` have $0 buying power until this exists | Add `BrokerPort.fundAccount` (JNLC from `ALPACA_FIRM_ACCOUNT_ID`) called from the settled transfer event, and book `Cash:Settled` only when the journal executes, as PLAN.md §ledger specifies |
