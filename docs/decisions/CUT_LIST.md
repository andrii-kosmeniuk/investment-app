# Cut list

Append-only during the trial. Add a row when something is deliberately left out of v1.

| Cut | Why | Week two |
|---|---|---|
| Native mobile app | One responsive web app proves the loop. | Wrap core flows after a11y and device QA. |
| Separate adviser product | One ops console is enough for the trial. | Adviser tenancy and bulk portfolio tools. |
| Alpaca JNLC funding on deposit | Plaid hits our ledger; the sandbox uses one pre-funded broker account. | `BrokerPort.fundAccount` when each customer gets their own Alpaca balance. |
| Bank payout on withdrawal | Deposits already exercise Plaid; payout is a second rail. | Plaid Transfer credit from the withdrawal executor. |
| Customer withdrawals | Same as above - deposit path is the graded rail. | Reuse transfer shape with an available-to-withdraw gate. |
| Wash-sale rules | FIFO lots and restatements matter more for grading. | Substantially-identical security rules. |
| Specific-ID lot picker | FIFO is deterministic and easy to audit. | Let the customer pick lots before a sell. |
| Performance chart and PDF statements | No valuation series to chart on day one. | Chart after daily valuations; statements after month-end close. |
| Password reset, MFA, session revoke | Seeded demo logins; sessions expire in 12 h. | Session table + email reset flow. |
| Email verification and sign-up rate limits | Persona is the real identity check. | Verification link + limiter on `/v1/auth/*`. |
| Queued-order cancel during broker outage | Alpaca sandbox still rejects order POSTs; nothing to cancel yet. | Operator cancel + auto-expire at close. |
| Dedicated Render worker service | Free tier runs API + worker in one container; it sleeps when idle. | Starter worker service or a keep-alive pinger. |
| WebGL hero | Static art hits the brief without runtime risk. | Shader hero behind the same slot if wanted. |
| Higgsfield-generated landing media | MCP not wired in this repo; local plates ship today. | Higgsfield pass on plates or short motion loops. |

## Week two — polish and production rails

Not cuts from v1; follow-ups if the product continues.

| Area | Now | Week two |
|---|---|---|
| UI / UX | Functional sandbox shell; landing and app are usable, not final. No unlink bank. | Stronger visual design, micro-animations, smoother transitions, unlink bank, tighter spacing. |
| Backend latency | Render cold starts; KYC and deposits wait on provider round-trips. | Warm instances, tighter polling where safe, optimistic UI on onboarding and transfers. |
| Persona KYC | Webhook + poll fallback; sandbox template only. | Production template, webhook-only path, clearer in-app status and error copy. |
| Alpaca brokerage | Sandbox only; order POST returns `500 50010000` tenant-wide (support ticket open). Orders queue and retry (ADR-0007). | Move to Alpaca production credentials, per-customer accounts, JNLC funding, and verify fills end-to-end. Drop the queue-only path once the rail is stable. |
