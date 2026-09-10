# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the user: a TypeScript monorepo with a responsive Next.js customer and
operations frontend, separate Fastify API and worker processes, and PostgreSQL.

## Users

- US retail investors onboarding, funding, investing in model portfolios, and
  reviewing performance and tax history.
- Operations staff approving consequential actions, monitoring integrations,
  investigating ledger history, and resolving reconciliation breaks.
- Evaluators exercising real sandbox flows and adversarial correction scenarios.

## Product Purpose

Move sandbox money from a linked US bank into a model portfolio, preserve an
immutable financial history, and make late custodian truth visible through
versioned restatements instead of rewritten records.

## Positioning

The product exposes both economic time and knowledge time: customers see the
corrected result while operators can reconstruct exactly what was published
before a late dividend or corrected close arrived.

## Operating Context

The trial is run over 48 hours and evaluated live. It uses Persona sandbox for
identity, Plaid sandbox for bank linking and ACH transfers, Alpaca Broker sandbox
for accounts and paper orders, Alpaca market data for daily closes, and an
honestly labelled custodian-file simulator.

## Capabilities and Constraints

- USD only, stored as integer cents; security units stored as integer micro-units.
- Double-entry, append-only, multi-commodity, bitemporal ledger.
- T+1 settlement, FIFO tax lots, dividends, splits, TWR and Modified Dietz.
- Signed, idempotent webhook ingestion and cursor-based Alpaca SSE consumption.
- Maker-checker approvals; initiators and autonomous agents cannot approve.
- Morning reconciliation across positions, cash, and transactions with aging.
- Responsive web rather than native mobile.

Open decisions are recorded in `docs/decisions/ASSUMPTIONS.md`.

## Brand Commitments

Working product name: Corgi Invest. The interface must be highly crafted,
trustworthy, restrained, smooth, and consistent—never a generic generated
dashboard. Motion must communicate state or continuity, not decorate.

## Evidence on Hand

The trial brief and technical execution plan are the only current evidence.
There are no approved customer claims, testimonials, benchmarks, logos, or
production integration credentials. Future work must not fabricate them.

## Product Principles

1. Financial truth is derived, never patched.
2. Provider uncertainty is shown honestly.
3. Consequential actions retain human attribution and separation of duties.
4. Every correction preserves what was previously known.
5. Visual quality supports comprehension and trust.

## Accessibility & Inclusion

Target WCAG 2.2 AA, keyboard-complete operation, non-colour status cues,
reduced-motion support, and tabular numerals for financial data.
