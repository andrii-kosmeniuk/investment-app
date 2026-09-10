# Open assumptions

| Opened | Question | Working assumption | Asked | Resolution |
|---|---|---|---|---|
| 2026-09-10 | Approval threshold and aggregation window | $1,000 per order or withdrawal; all bulk rebalances require approval | Not yet | Open |
| 2026-09-10 | Customer-facing return | TWR headline with Modified Dietz alongside | Not yet | Open |
| 2026-09-10 | Dividend performance date | Accrue receivable on ex-date; move receivable to cash on pay-date | Not yet | Open |
| 2026-09-10 | Tax-lot method | FIFO for v1; schema leaves room for specific identification | Not yet | Open |
| 2026-09-10 | Custodian file layout | Deterministic CSV containing positions, cash, and transactions | Not yet | Open |
| 2026-09-10 | Reconciliation tolerance | Zero cents, zero micro-units, 50 bps price difference | Not yet | Open |
| 2026-09-10 | Alpaca push wording | SSE satisfies event-driven fill delivery; documentation labels it precisely | Not yet | Open |
| 2026-09-10 | Who confirms a customer order at/above the $1,000 threshold? | The customer, via an explicit confirmation step showing the exact legs (brief §3). The ops maker-checker queue is for operator-initiated actions | Not yet | Open — see ADR-0003 |
| 2026-09-10 | Storage of the Plaid item access token | Plaintext column in the sandbox database; must be encrypted at rest or replaced by a processor token before any production use | Not yet | Open — see ADR-0003 |
| 2026-09-10 | Price staleness for portfolio value | A close more than 3 calendar days older than the business date (America/New_York) marks the value "provisional"; a missing price makes it "unavailable" | Not yet | Open — see ADR-0003 |
