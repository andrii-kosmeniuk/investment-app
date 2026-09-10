# 0003 — Customer surface v1: sessions, funding, model investing, and the editorial orange design


Records the decisions made building the T19–T24 slice: the first customer-facing
product (entry, sign-in, onboarding, transfers, overview, portfolio with model
selection, activity) on top of the T0–T14 domain, plus the seed and demo logins
for the T+24 checkpoint. ADR-0000 fixes the layering (web → contracts only; API
owns composition) and ADR-0002 the provider seams; this ADR refines both where
the customer surface forced a choice.

## Design direction: "Editorial · Orange"

- **Decision:** The customer surface adopts direction 6 from the design lab — direction 4 ("Editorial Botanical") copied verbatim, minus the numbered eyebrow line, with the ASCII fern actually animated (slow sway) and Corgi's official orange `#FF5C00` as the single accent. Tokens: warm paper (oklch hue 90), ink, Instrument Serif for display headlines, Inter for UI, Geist Mono for numbering, radii 2/4/6 px plus a pill for primary buttons. `--accent` (`#ff5c00`) is for non-text use; `--accent-text` (oklch 0.55 0.19 40) is the darker orange used for text so it clears 4.5:1 on paper. The `[data-theme="ops"]` dark theme is removed; ops shares the paper palette.
- **Why:** The user picked this direction after six lab variants, asking explicitly for direction 4's hierarchy, minimal noise (no eyebrow), a living rather than static hero, and an accent "on the same wave as Corgi itself". Pure `#FF5C00` fails contrast on paper for body-size text, so the accent splits into a brand hue and a text hue rather than muddying the brand colour.
- **Consequences:** The throwaway `/lab` route with the six variants was deleted once the direction was chosen; only the winning variant exists, as the product itself. `references/ui/design_brief.md` §0/§5/§6 are updated to match. Serif is reserved for the entry headline and the portfolio value; everything inside the shell is Inter. All component styling lives in `@corgi/ui/styles.css`; `apps/web/src/app/styles.css` only arranges pages. The impeccable design hook forbids thick one-sided "side-tab" borders, so `InlineAlert` marks tone with a leading dot instead.

## Stateless API-issued sessions; the web holds only an httpOnly cookie

- **Decision:** `POST /v1/auth/sign-in` verifies credentials and returns an HS256 JWT (`jose`) signed with `SESSION_SECRET` (≥32 chars), TTL `SESSION_TTL_HOURS` (default 12), `iss corgi-invest:api`, `aud corgi-invest:customer`, `sub` = customer id. The Next.js server stores it in an httpOnly, `SameSite=Lax`, secure-in-production cookie `corgi_session` and forwards it as `Authorization: Bearer` on every server-side API call. The browser never sees the token; client components only call server actions.
- **Options:** (a) Next.js-side auth with the web app reading the database directly — violates ADR-0000; (b) server-side session table with opaque ids — an extra hot table and a DB hit per request for a single-instance API; (c) stateless signed token — chosen.
- **Why:** The API is the only process allowed to touch the database; sessions must therefore be minted by the API. A signed token keeps the API horizontally scalable with no session store and lets the MCP/agent surface reuse the same verifier later. A 12-hour TTL matches a working day for a demo without a refresh flow.
- **Consequences:** No server-side revocation in v1 (sign-out clears the cookie; a leaked token is valid until expiry). Rotating `SESSION_SECRET` signs everyone out. `SESSION_SECRET` is now a required API env var (Render + `.env.example`). Tokens are verified by a scoped Fastify `preHandler` and `request.customerId` is the only identity routes read.

## Credentials: scrypt hashes in a separate table

- **Decision:** New `customer_credentials` table (customer_id PK → customers, `password_hash`, timestamps). Hashes are self-describing `scrypt$N$salt$key` (N=16384, r=8, p=1, base64url) via Node's built-in `scrypt`. `signIn` always runs a verification (against a decoy hash when the email is unknown) so response time does not reveal whether an account exists.
- **Why:** A customer row must be able to exist before it can sign in (seeded, imported, or ops-created), and profile reads should never touch the hash. Node's scrypt avoids a native dependency; the self-describing format allows parameter upgrades without a migration.
- **Consequences:** No password reset, MFA, or lockout in v1 (cut list). The seed sets one demo password for both customers via `DrizzleCredentialsRepository.setPasswordHash`.

## Customer API is a set of read models over the ledger, not a mirror of tables

- **Decision:** `/v1/customer/{me,onboarding,models,portfolio,activity,transfers}` are composed in the API from application-layer pure view builders (`buildOnboardingView`, `buildPortfolioView`, `buildActivityRows`, `buildDepositProgress`) fed by repository ports. All money is bigint cents and units bigint micro-units inside the process; the API serialises them as decimal strings per `@corgi/contracts`, and the web validates every response with the same zod schemas before rendering.
- **Why:** The screens need facts the tables don't hold directly (available-to-invest, provisional value, deposit progress). Building them as pure functions makes them unit-testable with fakes and keeps the API routes thin. Validating responses in the web means a shape drift fails loudly (`contract_mismatch`) rather than rendering a wrong number.
- **Consequences:** Portfolio value = available-to-trade cash + Σ position values; pending deposits are shown but excluded. Value status is `final | provisional | unavailable`: a missing price yields `cents: null` and "unavailable" rather than a silently smaller number; a stale price (close more than 3 calendar days older than `asOf`) yields "provisional". Business date is computed in `America/New_York`. Deposit lifecycle is read from `deposit_pending / deposit_settled / deposit_returned` ledger entries keyed by `sourceRef = transferId`, not from a mutable status column — the timeline is therefore always consistent with the books. Activity rows are the customer's balanced journal entries, newest first, with all legs (including firm-side) exposed on demand.

## Large customer orders require explicit customer confirmation, not ops approval

- **Decision:** `PlaceOrderCommand` gains `customerConfirmed`. When any planned leg is at/above `ORDER_CONFIRMATION_THRESHOLD_CENTS` (default $1,000) and the command is not confirmed, `chooseModel` throws `ConfirmationRequiredError` carrying the exact planned legs; the API returns `409 confirmation_required` and the web shows those server-computed amounts in a confirmation sheet, then re-submits with `confirmed: true`. The ops maker-checker queue (ADR-0002) remains for operator-initiated and bulk actions.
- **Options:** (a) route customer orders into the ops approval queue — but `approval_requests.requested_by_actor_id` references `actors`, not `customers`, and a retail customer waiting on an operator to buy an ETF is not the brief's intent (§3 "explicit confirmation above a threshold"); (b) drop the threshold for customers; (c) customer confirmation — chosen.
- **Why:** The brief asks for confirmation, and the reviewer-facing property is "no large order without a deliberate second step". The customer is the right party for their own order; operators approve operator actions.
- **Consequences:** Logged in `ASSUMPTIONS.md`; if Corgi wants operator sign-off on customer orders too, a superseding ADR adds a customer-sourced approval request. The sheet never estimates client-side — it displays the legs the server would place. `chooseModel` also lazily creates the Alpaca account on first investment, assigns the portfolio, allocates `available × (10000 − buffer) / 10000` by largest remainder, and skips legs under `minimumTradeCents`.

## Plaid Transfer: authorization then create; access token stored in sandbox

- **Decision:** Linking a bank is `link-token → Plaid Link (browser, script loaded on demand) → public token → API exchanges for an access token`; the access token is stored in `bank_accounts.provider_access_token` (plaintext, sandbox only). A deposit is `/transfer/authorization/create` followed by `/transfer/create` with an idempotency key we generate; a declined authorization fails the request. The `transfers` row is written before any Plaid event can arrive (ADR-0002 depends on it). Deposits require `kycStatus = approved`, amount > 0 and ≤ `MAXIMUM_DEPOSIT_CENTS` (default $50,000), and a bank account that belongs to the customer and is active.
- **Why:** Plaid Transfer cannot be created without an authorization step and an item access token; the browser must never hold the access token, so exchange happens in the API. The web-side `PlaidLinkButton` mints the link token per click and hands the public token straight to a server action.
- **Consequences:** Before any production use the access token column must be encrypted at rest (or replaced by a Plaid processor token) — recorded as an explicit consequence, not a TODO. `PLAID_*` unset → `503 plaid_not_configured`, surfaced honestly in the UI. Transfer status on the row is `initiated` until the ledger says otherwise.

## The API holds Alpaca and Persona keys too (refines ADR-0002)

- **Decision:** `ALPACA_BROKER_BASE_URL/KEY/SECRET` and `PERSONA_*` are optional API config. When present the API can create the customer's Alpaca account and place notional orders from `chooseModel`, and can create/resume Persona inquiries for the hosted flow (`inquiry.withpersona.com/verify?inquiry-id&session-token&redirect-uri`). When absent, the corresponding routes return `503 {provider}_not_configured`.
- **Why:** ADR-0002 put Alpaca keys on the worker only because nothing customer-initiated placed orders yet. The customer surface does. Keeping order placement in the API (same process as the confirmation check) is simpler than an API→worker command queue for v1.
- **Consequences:** `render.yaml` adds `SESSION_SECRET`, `DATABASE_URL_UNPOOLED`, `ALPACA_*`, `ENVIRONMENT_NAME` to `corgi-api`. The API uses the direct (unpooled) Neon URL for its write path because `chooseModel` and deposits run inside interactive transactions. Fill accounting still arrives via the worker's SSE consumer, so orders show as `openOrders` until fills book.

## Seed v1 seeds reference data and logins only — no fake balances

- **Decision:** `scripts/seed.ts` upserts four models summing exactly 10,000 bps each (Conservative income BND 70/VTI 20/VXUS 10 · risk 1; Balanced VTI 45/VXUS 15/BND 40 · risk 2; Balanced growth VTI 60/VXUS 19/BND 21 · risk 3; Growth VTI 70/VXUS 25/BND 5 · risk 5; 1% cash buffer), the ops/agent actors, and two demo customers — Olivia (`approved`) and Noah (`needs_review`, trading blocked) — with a shared demo password from `SEED_DEMO_PASSWORD` (default `corgi-demo-2026`). It writes no ledger entries, transfers, or prices.
- **Why:** Every balance a reviewer sees should come from the real rails (Plaid sandbox, Alpaca paper, pricing worker). An empty portfolio on first sign-in is the honest state; fabricated fixtures would mask whether the rails work.
- **Consequences:** The T+24 walkthrough must actually move money on sandbox rails (deposit → settle → choose model → fills) before the demo, and the T+24 note says which rail moved what. Re-running the seed is safe (`ON CONFLICT … DO UPDATE`).

## Scope cuts made in this slice

Recorded in `CUT_LIST.md`: Documents/statements nav, performance chart on the overview, withdrawals from the customer surface, password reset/MFA, server-side session revocation, ops dark theme.
