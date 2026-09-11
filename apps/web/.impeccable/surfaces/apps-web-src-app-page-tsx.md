---
version: 1
slug: "apps-web-src-app-page-tsx"
primary_target: "apps/web/src/app/page.tsx"
related_targets: ["apps/web/src/app/sign-up/page.tsx"]
---

# Surface: entry landing page (`apps/web/src/app/page.tsx`)

Scope: the signed-out one-page landing for Corgi Invest. Mode: Persuade.
Audience: a US retail investor deciding whether to open an account; a grader checking that the product is honest about sandbox status.
Job: understand what the product does (verify → link a bank → fund → one of four models → restated, never rewritten), then Sign in or Create an account.
Proof/content: literal product facts only (five onboarding steps, four models with their target weights from configuration, T+1 settlement, bitemporal restatements, sandbox/paper-trading labels). No testimonials, prices, benchmarks, or regulatory claims.
Constraints: the world is fixed by ADR-0003 and `references/ui/design_brief.md` (paper, ink, Corgi orange accent, Instrument Serif headline only on the entrance, Inter body, Geist Mono numbering, radii 2/4/6 + pill, animated character-field fern as the entry artwork, dithered monochrome nature scenes as the only other artwork family, motion from the CSS duration/easing tokens, reduced-motion static).

## Direction contract

THESIS: The landing page is a botanical field guide to one financial product: a sequence of numbered plates, each a single-ink dithered natural figure beside a short factual caption. It refuses the fintech scaffold of three same-size icon cards, a hero metric, and a testimonial wall.

OWN-WORLD: warm paper canvas, near-black ink, one Corgi orange used only as mark, rule and primary pill; Instrument Serif for the headline and the closing statement only (per ADR-0003; plate titles stay Inter 600); Inter body; Geist Mono roman plate numbers in `--accent-text`; hairline ink rules dividing plates; ordered-dither monochrome nature figures (river stones, raked garden, cloud bank, hills in mist) and the character-field fern; no cards except the shared restatement compare block, no gradients.

STORY: The visitor reads the product as a patient natural process: identity first, bank, money, a model, and a history that is corrected but never rewritten. They believe it is careful because everything is labelled (sandbox, paper trading, simulated custodian). They Sign in or Create an account.

FIRST VIEWPORT: sticky header (emblem + serif wordmark left; section links + "Sign in" pill right; hamburger under 56rem). Below a full ink rule, a two-column hero: left, the serif headline "A clearer view of your investments." at clamp(3rem, 6.5vw, 5.5rem), one lead paragraph, primary pill "Create an account" and text link "Sign in"; right, the swaying character-field fern filling the column. A hairline rule and the four one-line product facts close the viewport.

FORM: Field guide (index 6 of my ranked structural list; dealt lead). Seed key a623dd29.

Signature interaction: each plate's dithered figure "breathes" (two pre-dithered frames, dither matrix shifted, cross-faded on a 10 s cycle) and the plate rule draws in 8 steps as it enters the viewport while the caption rises; the mobile menu button morphs to a close mark. Figures are sticky beside long captions on wide screens. Everything is static under reduced motion.

Raster provenance: the four plate sources were generated with Cursor's image tool (the Higgsfield trial only permits MCP use and no Higgsfield MCP server is configured in this workspace), then ordered-dithered with ffmpeg at 600×800 and doubled with nearest-neighbour; the exact prompt and processing are embedded in each PNG's tEXt chunk (`impeccable embed-prompt --scan apps/web/public/plates` reports 0 missing).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
