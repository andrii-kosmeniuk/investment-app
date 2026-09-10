# Corgi Invest

A US retail-investing work trial built around immutable accounting, live sandbox
integrations, bitemporal performance, and operational reconciliation.

## Architecture

The repository is a modular monorepo. Dependency direction is inward:

```text
apps/web ───────────────→ packages/ui
apps/api ──→ application ←── integrations
    │              │
    └──→ database  └──→ domain
apps/worker ───────┘
apps/api ───────────────→ packages/mcp
```

- `apps/web`: presentation only. It never imports database or provider code.
- `apps/api`: HTTP composition root, signed webhook receiver, and MCP transport.
- `apps/worker`: Alpaca SSE consumer and scheduled settlement, valuation, and reconciliation jobs.
- `packages/domain`: pure financial types and invariants; no framework, network, or database imports.
- `packages/application`: use-case ports defining what the domain needs from infrastructure.
- `packages/contracts`: versionable Zod DTOs shared by API and web; bigints cross JSON as strings.
- `packages/database`: Drizzle schema and PostgreSQL financial controls.
- `packages/integrations`: provider adapters behind application ports.
- `packages/ui`: visual tokens, motion grammar, and financial formatting primitives.
- `packages/mcp`: agent tools; writes can only create human approval requests.

## Integration truth

- Alpaca Broker API: **live sandbox**, event delivery via SSE.
- Plaid Link and Transfer: **live sandbox**, signed webhooks and event-sync cursor.
- Persona: **live sandbox**, signed inquiry webhooks.
- Alpaca IEX market data: **live sandbox/free feed**.
- Custodian morning file: **simulated**, explicitly labelled.

No production keys, real money, or real personal data may be used.

## Financial representation

- USD is stored as signed `BIGINT` cents.
- Security quantities are signed `BIGINT` micro-units.
- Provider decimals are parsed at adapter boundaries with half-even rounding.
- Pro-rata residual cents use Hamilton largest remainder with stable symbol ordering.
- Journal entries balance independently for every commodity.
- `effective_at` records economic time; immutable `posted_at` records knowledge time.

## Local development

Requires Node 22.12+ and pnpm.

```bash
cp .env.example .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm seed
pnpm dev
```

Web defaults to `http://localhost:3000`; API defaults to `http://localhost:4000`.
The worker is a separate process and must remain running for Alpaca SSE events.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check:decisions
```

Decision rationale is indexed in `docs/DECISIONS.md`. Agent prohibitions are in
`docs/AGENT_BOUNDARIES.md`.
