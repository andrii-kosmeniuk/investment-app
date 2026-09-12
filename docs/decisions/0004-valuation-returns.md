# 0004 - Valuation returns

**When:** 2026-09-10

## Daily valuation

- **Decision:** Value at end of business day (America/New_York): cash + positions * latest close. Status `final`, `provisional` (stale close), or skip row if no price.
- **Why:** Same date must revalue to the same number unless a fact changed.
- **Consequences:** We call stale closes `provisional`, not `stale`. Re-run is no-op when unchanged.

## External flows

- **Decision:** Deposits, withdrawals, fees are flows; dividends and trades are return, not flows. Flows dated on effective day, beginning-of-day.
- **Why:** Gross-of-fee TWR isolates model performance from cash timing.
- **Consequences:** Fee policy logged in ASSUMPTIONS.

## TWR and MWR

- **Decision:** Chain-linked TWR; Modified Dietz MWR; periods `mtd` / `ytd` / `inception`; stored as scaled bigint bps.
- **Why:** Two questions need two numbers; integers keep idempotence exact.
- **Consequences:** API sends fractions; 1W rolling window not stored (see cut list).

## Restatement

- **Decision:** New valuation/return versions with `supersedes_id`; “as published on D” filters by `computed_at`.
- **Why:** Customer must see what changed and why.
- **Consequences:** Restated pill only when the visible number moved.

## Live-fire scenarios

- **Decision:** Corrected close, late dividend, and stock split go through ledger + same valuation functions as nightly jobs.
- **Why:** Demo must be the real system, not a script.
- **Consequences:** Split adjusts lots and prices; value should stay flat.

## Ops token

- **Decision:** `/v1/ops/*` guarded by `LIVE_FIRE_TOKEN`; web stores it in httpOnly cookie after verify.
- **Why:** Scenarios rewrite published figures; must not be public.
- **Consequences:** Rotate token on Render to revoke all operators.

## Scheduling

- **Decision:** Weekday crons ~20:15 collect closes, ~20:30 value and compute returns; idempotent replays from console.
- **Why:** Late bars and missed nights self-heal via lookback window.
- **Consequences:** No exchange holiday calendar in v1.
