# 0006 - Sign-up landing

**When:** 2026-09-11

## Registration

- **Decision:** `POST /v1/auth/sign-up` creates customer + credentials, returns session like sign-in. No email verification in v1.
- **Why:** Persona is the real identity check, one session model.
- **Consequences:** KYC and funding gates still enforced, duplicate email returns 409.

## Public models

- **Decision:** `GET /v1/models` is public, same catalogue as signed-in.
- **Why:** Landing shows real weights, not marketing copy.
- **Consequences:** API down → honest “unavailable” on the page.

## Landing page

- **Decision:** Signed-out `/` is a scrollable field guide: hero, four plates (steps, models, restatement, sandboxes), pre-dithered PNG art, CSS motion only.
- **Why:** Product story without fake metrics, cheap deterministic assets.
- **Consequences:** Signed-in users redirect to overview, Higgsfield media is a cut.

## Onboarding band

- **Decision:** Shell shows next-step notice on every page until onboarding complete, derived from API rail, not client guesswork.
- **Why:** Gates bite on Transfers/Portfolio - user should know before clicking.
- **Consequences:** Band and nav dot disappear when rail is done.
