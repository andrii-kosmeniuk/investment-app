# 0005 - Ops console

**When:** 2026-09-11

## Operator identity

- **Decision:** Shared `LIVE_FIRE_TOKEN` plus `X-Operator-Id` naming a human actor. Maker ≠ checker in domain and DB.
- **Why:** Attribution without building SSO in a week.
- **Consequences:** Demo uses Sam Chen / Maya Brooks, rotate token to revoke.

## Approval queue

- **Decision:** One queue, approve runs the executor inline with frozen payload (withdrawal, order, rebalance, recon adjustment).
- **Why:** Approved must mean done; checker sees exact instruction.
- **Consequences:** Withdrawal books ledger bank payout not sent in v1 (cut list).

## Agent proposals

- **Decision:** MCP rebalance/withdrawal file the same approval requests as humans, agent never decides.
- **Why:** Checker cannot tell who proposed from the payload alone.
- **Consequences:** Bad proposals fail before filing.

## Reconciliation

- **Decision:** Simulator CSV from ledger; zero tolerance on positions/cash, breaks age from first sighting; explain or adjust to close.
- **Why:** Tamper demo must show a break the same morning.
- **Consequences:** Optional Alpaca column for context files stored in DB (kilobytes).

## T+1 settlement

- **Decision:** Fills record settlement rows 00:05 ET job moves unsettled -> settled cash.
- **Why:** Portfolio must show unsettled buys before settlement.
- **Consequences:** Weekends skipped no holiday calendar yet.

## Deposit return (R01)

- **Decision:** Return posts recovery receivable if cash goes negative, block trading and queue sell-to-cover for human approval.
- **Why:** No automatic liquidation without an operator.
- **Consequences:** Operator releases block when cash >= 0 again.

## Event replay

- **Decision:** `POST /ops/events/:id/replay` re-enters inbox only returns `duplicate` when already seen.
- **Why:** Proves ingress idempotency without a second handler path.
- **Consequences:** Ledger idempotency proven in use-case tests separately.
