# Open assumptions

| Opened | Question | Working assumption | Asked | Resolution |
|---|---|---|---|---|
| 2026-09-10 | Approval threshold | $1,000 per order or withdrawal; bulk rebalances need approval | No | Open |
| 2026-09-10 | Customer-facing return | TWR headline with Modified Dietz alongside | No | Open |
| 2026-09-10 | Dividend dates | Receivable on ex-date; cash on pay-date | No | Open |
| 2026-09-10 | Tax lots | FIFO in v1 | No | Open |
| 2026-09-10 | Custodian file | CSV with positions, cash, transactions | No | Open |
| 2026-09-10 | Reconciliation tolerance | Zero on cash/units; 50 bps on price | No | Open |
| 2026-09-10 | Alpaca fills | SSE stream counts as event-driven delivery | No | Open |
| 2026-09-10 | Large order confirmation | Customer confirms legs; ops queue is for operators | No | Open - ADR-0003 |
| 2026-09-10 | Plaid access token storage | Plaintext in sandbox DB; encrypt before production | No | Open - ADR-0003 |
| 2026-09-10 | Stale prices | Close >3 days old → provisional; missing → unavailable | No | Open - ADR-0003 |
| 2026-09-10 | Fees in TWR | Fees are external flows (gross-of-fee TWR) | No | Open - ADR-0004 |
| 2026-09-10 | MWR timing | Modified Dietz, beginning-of-day flows | No | Open - ADR-0004 |
| 2026-09-10 | Valuation cash | Available-to-trade + dividend receivable | No | Open - ADR-0004 |
| 2026-09-10 | Split-adjusted prices | Simulator writes adjusted closes as new versions | No | Open - ADR-0004 |
| 2026-09-10 | Late dividend time | Ex-date close for entitlement; pay-date for cash | No | Open - ADR-0004 |
| 2026-09-11 | Alpaca account API | Was read-only key; full-access key fixed account creation | No | Resolved 2026-09-11 |
| 2026-09-11 | Alpaca order 500 | Sandbox order POST fails tenant-wide; orders queue (ADR-0007) | Alpaca support | Open |
| 2026-09-10 | Deposit returned after invest | Block trading; sell-to-cover needs human approval | Corgi email | Open |
| 2026-09-11 | Mid-day model change | Record now; rebalance next window; one switch per day | Corgi email | Open |
| 2026-09-11 | Alpaca KYC identity | Placeholder identity on broker account; real KYC in Persona | No | Open |
| 2026-09-11 | Operator login | Shared token + declared actor; SSO later | No | Open - ADR-0005 |
| 2026-09-11 | Custodian source | Simulator from ledger; label `simulator` | No | Open - ADR-0005 |
| 2026-09-11 | Sell while blocked | Only firm sell-to-cover when trading blocked | Corgi email | Open - ADR-0005 |
