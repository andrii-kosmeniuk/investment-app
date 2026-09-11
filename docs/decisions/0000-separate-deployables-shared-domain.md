# 0000 — Foundational architecture and financial invariants

- **When:** decisions ≈2026-09-10 10:12 CEST (T−0:57) → ≈2026-09-10 10:57 CEST (T−0:12); written 2026-09-10 11:04 CEST (T−0:05); committed 8aeee09 2026-09-10 11:09 CEST (T0)

_Timestamps backfilled 2026-09-11 09:15 CEST from the session transcript and commit times (PLAN.md cadence rule 7: "logged late" with the true time). Wall clock is when the decision was made; T± is relative to the kickoff commit, 2026-09-10 11:09 CEST. ≈ marks minute-level estimates bracketed by transcript timestamps._

This entry records every material decision made while scaffolding the project.

## Separate deployables around a shared domain

- **When:** ≈2026-09-10 10:12 CEST (T−0:57)
- **Decision:** Use a pnpm/Turborepo monorepo with three independently deployable applications: `web` for presentation, `api` for synchronous HTTP, webhooks and MCP, and `worker` for event streams and scheduled jobs. Shared code is separated into domain, application, contracts, database, integrations, MCP and UI packages.
- **Why:** The frontend, request-driven backend and long-running background processes have different responsibilities, failure modes and scaling needs. Keeping financial rules in a framework-independent domain package makes them testable without Next.js, Fastify, PostgreSQL or provider sandboxes.
- **Consequences:** The web application may depend only on API contracts and UI packages; it cannot access the database or providers. The API and worker assemble application ports with infrastructure adapters and can be deployed or scaled independently. This adds workspace and build configuration, but prevents financial logic from becoming coupled to a delivery framework.

## Multi-commodity, append-only, bitemporal ledger

- **When:** ≈2026-09-10 10:18 CEST (T−0:51)
- **Decision:** Model all money movement as multi-commodity double-entry journal entries in an append-only ledger. Each entry records two independent timestamps — `effective_at` (when the event economically happened) and `posted_at` (when we learned it) — and is sealed with a hash chain. Corrections are new reversing/re-booking entries, never mutations.
- **Why:** Retail investing requires provably correct books: per-commodity debits must equal credits, history must be auditable, and late-arriving or corrected facts (restatements) must be representable without rewriting the past. Bitemporality lets us answer both "what was true" and "what did we know, and when".
- **Consequences:** Every posting carries a commodity, and balances are derived per commodity with a sum-to-zero invariant. Append-only is enforced in the domain and in PostgreSQL (triggers plus `REVOKE UPDATE/DELETE` from the application role). Restatements add versioned entries and leave the original visible, which increases storage and query complexity but gives a trustworthy audit trail.

## Exact numeric representation and rounding

- **When:** ≈2026-09-10 10:20 CEST (T−0:49) · reaffirmed 10:57 after the "why integers?" challenge
- **Decision:** Represent money as integer minor units (`bigint` cents) and quantities as integer micro-units (`bigint`, 1e-6). Use banker's (half-even) rounding, and distribute residues with the Hamilton largest-remainder method. Integers crossing JSON boundaries are serialized as strings.
- **Why:** Floating-point cannot represent decimal money exactly and leaks rounding error into balances. Integer minor units are exact, comparable and safe to sum; half-even avoids systematic bias; largest-remainder allocation guarantees split amounts reconcile back to the total to the cent.
- **Consequences:** All arithmetic goes through the domain money value objects; raw `number` money is disallowed. Contracts encode integer fields as strings so precision survives transport. This is slightly more verbose than using floats, but eliminates a whole class of financial bugs.

## Human-only maker-checker approvals

- **When:** ≈2026-09-10 10:30 CEST (T−0:39)
- **Decision:** Every state-changing sensitive action requires a maker-checker approval where the initiator and approver must be distinct human actors. Agents and automated callers may only create approval requests, never approve them.
- **Why:** Financial and identity-affecting actions need a segregation-of-duties control. Restricting approval to humans, and forbidding self-approval, prevents both automated and single-actor abuse.
- **Consequences:** The rule is enforced in the domain and again as a PostgreSQL CHECK/trigger, so it holds even if a caller bypasses the application layer. The MCP write tools can only file approval requests; they cannot enact changes. This adds a second-actor step to sensitive flows by design.
