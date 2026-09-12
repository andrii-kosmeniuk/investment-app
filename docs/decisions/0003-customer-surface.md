# 0003 - Customer surface

**When:** 2026-09-10

## Design

- **Decision:** Warm paper palette, Corgi orange accent, Instrument Serif on the entrance, Inter in the app, dithered nature plates on the landing page.
- **Why:** Distinct from generic fintech; matches brand direction.
- **Consequences:** Ops uses the same light palette; component styles live in `@corgi/ui`.

## Sessions

- **Decision:** API mints HS256 JWT; Next.js stores it in httpOnly cookie `corgi_session`.
- **Why:** Browser never holds the token; API stays the auth authority.
- **Consequences:** No server-side revoke in v1; rotate `SESSION_SECRET` to sign everyone out.

## Credentials

- **Decision:** `customer_credentials` table; scrypt hashes; constant-time path for unknown emails.
- **Why:** Profile reads should not touch password material.
- **Consequences:** No reset or MFA in v1.

## Read models

- **Decision:** Customer routes compose views (`buildPortfolioView`, `buildActivityRows`, …) from repositories; web validates with shared Zod schemas.
- **Why:** Screens need derived facts, not raw tables.
- **Consequences:** Deposit timeline comes from ledger kinds, not a mutable status column.

## Large order confirmation

- **Decision:** At/above $1,000 notional the customer must confirm exact legs; ops queue stays for operator actions.
- **Why:** Retail customer confirms their own trade.
- **Consequences:** `409 confirmation_required` with server-computed legs.

## Plaid deposits

- **Decision:** Link token -> exchange -> authorization -> transfer create; store access token in sandbox DB; write `transfers` row before events arrive.
- **Why:** Browser must never hold the access token.
- **Consequences:** Encrypt tokens before production; deposits gated on approved KYC.

## API holds broker keys

- **Decision:** API creates Alpaca account and places orders from `chooseModel`; worker still ingests fills via SSE.
- **Why:** Customer-initiated flow stays synchronous with confirmation.
- **Consequences:** Alpaca keys on API and worker.

## Seed

- **Decision:** Seed models, actors, and two demo logins only - no ledger fixtures.
- **Why:** Balances should come from live sandbox rails.
- **Consequences:** Empty portfolio on first sign-in is correct.
