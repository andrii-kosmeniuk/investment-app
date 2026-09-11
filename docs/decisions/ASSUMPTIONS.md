# Open assumptions

_"Opened" is when the assumption was made (CEST, with the offset from the kickoff commit 2026-09-10 11:09). Times for the 2026-09-10 rows were backfilled 2026-09-11 09:15 from the session transcript; ≈ marks minute-level estimates._

| Opened | Question | Working assumption | Asked | Resolution |
|---|---|---|---|---|
| ≈2026-09-10 10:30 (T−0:39) | Approval threshold and aggregation window | $1,000 per order or withdrawal; all bulk rebalances require approval | Not yet | Open |
| ≈2026-09-10 10:35 (T−0:34) | Customer-facing return | TWR headline with Modified Dietz alongside | Not yet | Open |
| ≈2026-09-10 10:35 (T−0:34) | Dividend performance date | Accrue receivable on ex-date; move receivable to cash on pay-date | Not yet | Open |
| ≈2026-09-10 10:25 (T−0:44) | Tax-lot method | FIFO for v1; schema leaves room for specific identification | Not yet | Open |
| ≈2026-09-10 10:40 (T−0:29) | Custodian file layout | Deterministic CSV containing positions, cash, and transactions | Not yet | Open |
| ≈2026-09-10 10:40 (T−0:29) | Reconciliation tolerance | Zero cents, zero micro-units, 50 bps price difference | Not yet | Open |
| ≈2026-09-10 10:15 (T−0:54) | Alpaca push wording | SSE satisfies event-driven fill delivery; documentation labels it precisely | Not yet | Open |
| ≈2026-09-10 20:40 (T+9:31) | Who confirms a customer order at/above the $1,000 threshold? | The customer, via an explicit confirmation step showing the exact legs (brief §3). The ops maker-checker queue is for operator-initiated actions | Not yet | Open — see ADR-0003 |
| ≈2026-09-10 20:50 (T+9:41) | Storage of the Plaid item access token | Plaintext column in the sandbox database; must be encrypted at rest or replaced by a processor token before any production use | Not yet | Open — see ADR-0003 |
| ≈2026-09-10 20:35 (T+9:26) | Price staleness for portfolio value | A close more than 3 calendar days older than the business date (America/New_York) marks the value "provisional"; a missing price makes it "unavailable" | Not yet | Open — see ADR-0003 |
| ≈2026-09-10 23:12 (T+12:03) | Are platform fees a cash flow or negative return in the customer's TWR? | Fees are external flows (gross-of-fee TWR, per PLAN.md); dividends are return | Not yet | Open — see ADR-0004 |
| ≈2026-09-10 23:15 (T+12:06) | Money-weighted method and flow timing | Modified Dietz with beginning-of-day flows; weight `(days to period end + 1) / period days`; null when nothing was invested | Not yet | Open — see ADR-0004 |
| ≈2026-09-10 23:10 (T+12:01) | Valuation cash basis | Available-to-trade cash plus dividend receivable; pending deposits and bounce receivables excluded | Not yet | Open — see ADR-0004 |
| ≈2026-09-10 23:25 (T+12:16) | Split-adjusted price history | The live-fire simulator records split-adjusted closes as new price versions from the effective date, standing in for a feed that serves adjusted history | Not yet | Open — see ADR-0004 |
| ≈2026-09-10 23:25 (T+12:16) | Late dividend effective time | Entitlement effective at the ex-date market close (16:00 ET), cash on the pay date; restatement starts at the ex-date | Not yet | Open — see ADR-0004 |
| 2026-09-11 00:40 (T+13:31) | Alpaca sandbox forbids API account creation | Our Broker sandbox tenant answered `403 40310000 request is forbidden` to every write (`POST /v1/accounts`, orders, even watchlists) while reads worked. Root cause found 2026-09-11 08:55: the dashboard key pair was read-only; a full-access key fixed it. The `ALPACA_SANDBOX_ACCOUNT_ID` fallback stays as a documented escape hatch for tenants that gate account creation | Not yet | Resolved on our side 2026-09-11 08:55 (T+21:46, key permissions) |
| 2026-09-11 09:05 (T+21:56) | Broker account application identity | The Alpaca sandbox account is opened with a placeholder identity keyed to the customer id (deterministic format-valid SSN, fixed address); the customer's real KYC lives in Persona and the brief does not ask us to forward it | Not yet | Open — forward Persona-verified identity if Corgi wants Alpaca to hold KYC of record |
