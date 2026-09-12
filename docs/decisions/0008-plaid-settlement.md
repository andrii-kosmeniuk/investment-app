# 0008 - Plaid settlement

**When:** 2026-09-11

## Sandbox auto-settle

- **Decision:** Worker calls Plaid `/sandbox/transfer/simulate` after `PLAID_SANDBOX_SETTLE_MS` (default 60s) for ordinary deposits; events still arrive via `/transfer/event/sync`.
- **Why:** Sandbox transfers never leave `pending` on their own; ledger must stay event-driven.
- **Consequences:** ~1 minute to settled in demo; magic amounts ($33.33 return) still work. Disabled when `PLAID_BASE_URL` is not sandbox.
