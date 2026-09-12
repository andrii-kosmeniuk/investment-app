# 0000 - Separate deployables

**When:** 2026-09-10

## Monorepo layout

- **Decision:** Three apps (`web`, `api`, `worker`) plus shared packages (`domain`, `application`, `database`, `integrations`, …).
- **Why:** Different scaling and failure modes; financial rules stay framework-free.
- **Consequences:** Web never touches the database or provider secrets.

## Append-only ledger

- **Decision:** Double-entry journal, multi-commodity, bitemporal (`effective_at` / `posted_at`), hash chain. Corrections are new entries.
- **Why:** Auditable books; late facts without rewriting history.
- **Consequences:** Balances sum to zero per commodity; Postgres triggers block UPDATE/DELETE on core tables.

## Integer money

- **Decision:** Cents and micro-units as `bigint`; half-even rounding at boundaries; Hamilton allocation for splits.
- **Why:** Floats leak rounding error.
- **Consequences:** API sends money as decimal strings; domain never uses raw floats.

## Maker-checker

- **Decision:** Sensitive ops need two humans; agents may request, never approve.
- **Why:** Segregation of duties.
- **Consequences:** Enforced in domain and in Postgres.
