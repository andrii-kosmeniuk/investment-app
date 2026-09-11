---
name: Corgi Invest
description: A field guide to one financial product — warm paper, near-black ink, one Corgi orange, dithered nature plates.
colors:
  accent: "#ff5c00"
  accent-hover: "oklch(0.6 0.2 40)"
  accent-soft: "#ffdecc"
  accent-text: "oklch(0.55 0.19 40)"
  surface-canvas: "oklch(0.975 0.01 90)"
  surface-raised: "oklch(0.99 0.006 90)"
  surface-subtle: "oklch(0.955 0.012 90)"
  ink-strong: "oklch(0.22 0.012 90)"
  ink-default: "oklch(0.38 0.014 90)"
  ink-muted: "oklch(0.55 0.014 90)"
  ink-inverse: "oklch(0.975 0.01 90)"
  line: "oklch(0.86 0.012 90)"
  line-strong: "oklch(0.62 0.02 90)"
  positive: "oklch(0.47 0.09 155)"
  negative: "oklch(0.5 0.16 28)"
  warning: "oklch(0.55 0.12 75)"
typography:
  display:
    fontFamily: "Instrument Serif, Iowan Old Style, Baskerville, serif"
    fontSize: "clamp(3rem, 6.5vw, 5.5rem)"
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: "-0.015em"
  display-value:
    fontFamily: "Instrument Serif, Iowan Old Style, Baskerville, serif"
    fontSize: "clamp(2.75rem, 5vw, 4.5rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.375rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 520
    lineHeight: 1.3
  lead:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.04em"
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
  pill: "999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "6": "1.5rem"
  "8": "2rem"
  "12": "3rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0.85rem 1.2rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0.85rem 1.2rem"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.pill}"
    padding: "0.85rem 1.2rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.pill}"
    padding: "0.85rem 0.5rem"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.negative}"
    rounded: "{rounded.pill}"
    padding: "0.85rem 1.2rem"
  status-pill:
    backgroundColor: "transparent"
    textColor: "{colors.ink-default}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.375rem 0.6rem"
  status-pill-info:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.375rem 0.6rem"
  field-control:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.md}"
    padding: "0.8rem 0.9rem"
  model-card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-default}"
    rounded: "{rounded.md}"
    padding: "1.25rem"
  compare-block:
    backgroundColor: "transparent"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.lg}"
    padding: "1.25rem 1.5rem"
  environment-badge:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "0.3rem 0.5rem"
  nav-link-active:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.sm}"
    padding: "0.6rem 0.75rem"
  onboarding-notice:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink-strong}"
    padding: "1rem clamp(1.25rem, 3vw, 3rem)"
---

# Design System: Corgi Invest

## Overview

**Creative North Star: "The Botanical Field Guide"**

Corgi Invest is set like a printed field guide to a single natural process. The canvas is warm paper (oklch hue 90, barely tinted), the type is near-black ink, and every division on the page is a hairline rule rather than a box. Content is arranged as numbered plates: a monochrome figure on one side, a short factual caption on the other, the two separated by nothing more than white space and a rule that spans the page. Inside the signed-in shell the same paper, ink and rules carry money tables, a status rail and one tinted band; nothing in the product is glossy, layered or gradient-lit.

One colour is allowed to be loud. Corgi's brand orange (`accent`, #ff5c00) appears as a mark — the emblem, the primary pill, the allocation bar's first segment, the onboarding dot, the current step of the timeline, focus rings — and never as running text. When orange has to be read, it darkens to `accent-text` so it clears 4.5:1 on paper. The only tinted surface in the system is `accent-soft`, reserved for the onboarding band, the info pill, the sandbox badge and text selection. Everything else is paper against ink.

Type follows the same restraint. Instrument Serif is an event: the entrance headline, the serif wordmark on the landing header, the closing statement, and the portfolio's headline value. Inter carries every other word at weights between 400 and 650. Geist Mono is reserved for numbering and identifiers — plate numerals, step counters, figcaptions, risk labels, the environment badge — and is coloured `accent-text` or `ink-muted`, never `ink-strong`. Artwork comes from exactly two families: ordered-dithered monochrome nature photographs (river stones, raked garden, cloud bank, hills in mist) that "breathe" by cross-fading two dither frames, and the character-field fern drawn live on a canvas in monospace glyphs. Motion is small, stepped and short (120/200/320 ms, one enter curve), and the whole world stands still under `prefers-reduced-motion`.

**Key Characteristics:**
- Warm paper canvas, near-black ink, one orange: marks in `accent`, words in `accent-text`, one tinted surface in `accent-soft`.
- Depth by hairline rules and tonal paper steps; a single floating shadow exists for the confirm sheet and the mobile menu only.
- Instrument Serif only on the entrance headline, landing wordmark, closing statement and portfolio value; Inter everywhere else; Geist Mono for numbering.
- Square-ish radii (2/4/6 px); pills only for buttons, status chips, the sign-in pill and the menu button.
- Two artwork families — dithered monochrome nature plates and the character-field fern — and no other imagery, icons or gradients.
- Stepped, brief motion (rule draws in 8 steps, glyph fern at ~10 fps, plates breathe over 10 s); fully static under reduced motion.

## Colors

The palette is paper and ink with a single brand hue: warm off-white surfaces stepped by lightness alone, a near-black ink ramp on the same hue, and Corgi orange split into a mark colour and a text colour.

### Primary
- **Corgi Orange** (`accent`, #ff5c00): non-text use only — the emblem, the primary pill fill, the allocation bar's first segment, the onboarding attention dot, the current timeline step, the inline alert's leading dot, the focus outline (2px, offset 3px), the field focus border.
- **Corgi Orange · Pressed** (`accent-hover`): the primary pill's hover fill.
- **Ink Orange** (`accent-text`): the only orange permitted as text — plate numerals and figcaptions, step counters, ghost buttons, sign-in/sign-up links, the mobile menu's "Create an account", model risk labels, the info pill's label.
- **Orange Paper** (`accent-soft`): the only tinted surface — the onboarding band, the info status pill, the sandbox badge, text selection, and the field's 3px focus halo.

### Neutral
- **Paper** (`surface-canvas`): the page background and the plate frame background; also the opaque fill a status pill takes when it sits on the orange band.
- **Raised Paper** (`surface-raised`): field controls, model cards, the confirm sheet panel, the mobile bottom nav — one step lighter than the canvas.
- **Pressed Paper** (`surface-subtle`): the current nav item's fill and skeletons — one step darker than the canvas.
- **Ink** (`ink-strong`): headings, values, strong labels, major rules (`border-top` under the hero, above each plate, above the closing statement, under the sticky header when the menu is open), the section heading's underline.
- **Body Ink** (`ink-default`): running text, nav links at rest, the body colour.
- **Faded Ink** (`ink-muted`): labels, table headers, hints, notes, breadcrumbs, side nav at rest.
- **Inverse Ink** (`ink-inverse`): text on ink or orange fills (ops approval buttons).
- **Hairline** (`line`): every minor divider — table rows, list rows, card borders, the header's bottom rule, the footer's top rule.
- **Strong Hairline** (`line-strong`): field borders, secondary button borders, the sign-in pill and menu button borders, the cash breakdown's total rule, the allocation bar's fifth segment.
- **Gain** (`positive`), **Loss** (`negative`), **Caution** (`warning`): signed numbers, status pill tones, timeline failures, alert dots and the negative onboarding band tint (`negative` mixed 10% into paper). Never used decoratively.

### Named Rules
**The One Orange Rule.** `accent` is a mark, never a word: fills, bars, dots, rules and focus only. Text that must be orange uses `accent-text`. `accent-soft` is the one tinted surface; no other colour may tint a background except the negative onboarding band.

**The Same-Hue Rule.** Every neutral — three papers, three inks, two hairlines — sits on oklch hue 90 with chroma ≤ 0.02. Depth is lightness, never a different hue.

## Typography

**Display Font:** Instrument Serif (with Iowan Old Style, Baskerville, serif)
**Body Font:** Inter (with ui-sans-serif, system-ui, sans-serif)
**Label/Mono Font:** Geist Mono (with ui-monospace, monospace)

**Character:** A single-weight old-style serif used as punctuation against a quiet grotesque. The serif is large, tight and rare; Inter does the reading at modest sizes and intermediate weights (450, 520, 560, 600, 650); Geist Mono numbers things in small, tracked, orange or faded settings. All numbers are tabular (`font-variant-numeric: tabular-nums` on `body`).

### Hierarchy
- **Display** (Instrument Serif 400, clamp(3rem, 6.5vw, 5.5rem), 0.98, −0.015em): the entrance headline on `/`, `/sign-in` and `/sign-up` (the form variant tightens to clamp(2.5rem, 5vw, 4rem)) and the closing statement on the landing page (clamp(2.5rem, 5vw, 4rem), line-height 1). Max measure 14ch.
- **Display value** (Instrument Serif 400, clamp(2.75rem, 5vw, 4.5rem), 1, −0.02em): the portfolio's headline money value on Overview and Portfolio. Serif wordmark on the landing header: 1.375rem, 400.
- **Headline** (Inter 600, clamp(1.75rem, 3vw, 2.375rem), 1.1, −0.02em, `text-wrap: balance`): plate titles on the landing page. Shell page titles use the same clamp at 500 weight (clamp(1.75rem, 3vw, 2.25rem)).
- **Title** (Inter 520, 1.125rem): card and sheet headings (`h3`), empty/error state headings (500). Section headings inside the shell are smaller still: Inter 520 at 1rem over an ink underline.
- **Lead** (Inter 400, 1.0625rem, 1.55): the hero lead and plate caption paragraphs, max 44ch.
- **Body** (Inter 400, 0.9375rem, 1.5): step details, provider descriptions, list rows, facts; UI chrome and buttons at 0.875rem (buttons at 560).
- **Label** (Inter 400–450, 0.75rem, 1.5): summary and table-header labels, hints, notes, status pills, the compare block's labels; always `ink-muted` unless carrying a tone.
- **Mono** (Geist Mono 400, 0.75rem, 0.04em): plate numerals and figcaptions ("Plate II · raked garden"), step counters (`01`, `02`), the hero facts' numbers, model risk labels, timeline markers (0.6875rem, 0.04em). The environment badge is mono at 0.6875rem, uppercase, 0.06em, on `accent-soft`.

### Named Rules
**The Serif Is An Event Rule.** Instrument Serif appears in exactly four places: the entrance headline, the landing wordmark, the closing statement, and the portfolio's headline value. Plate titles, page titles and every heading inside the shell are Inter.

**The Numbering Earns Its Place Rule.** Geist Mono numerals appear only where sequence carries meaning — plates I–IV, onboarding steps 01–05, the four hero facts, timeline markers. Decorative numbering and letter-spaced mono labels above headings are not part of the system.

**The Tabular Rule.** Every money value, unit, percentage and date column is set tabular and right-aligned in tables; signed percentages carry their sign as a glyph (`+`, `−`) and their colour from `positive`/`negative`.

## Layout

The page is one column of paper with full-bleed rules. Horizontal padding is `clamp(1.25rem, 3vw, 3rem)` on every shell — the landing header, the entry grid, the shell top bar, the notice band and the footer share it so rules and text align down the page. Rules run edge to edge (`border-top` on the section); only the text measure is narrow (hero lead 44ch, plate caption 40rem, closing statement 46rem, notice body 62ch, page-heading lede 52ch).

**Landing page.** A sticky header (min-height 4.5rem, three-column grid: wordmark · centred section links · account actions) draws the only rule at the top of the first viewport; the hero grid below it has no second rule. The hero is two columns, `minmax(0, 1.2fr) minmax(0, 0.8fr)`, min-height `min(36rem, 100svh − 13rem)`, copy vertically centred, the fern filling the right column. Four facts follow under an ink rule in a four-column grid. Each plate is a section with an absolute 1px ink rule at its top, `margin-top: clamp(4rem, 8vw, 7rem)`, `padding-top: 2.5rem`, and a two-column grid `minmax(0, 0.85fr) minmax(0, 1.15fr)` — the figure always takes the narrower column and alternates sides via `data-flip`; the figure is sticky at `top: 6rem` beside long captions. Frames are 3:4 on wide screens. The closing statement and footer repeat the rule-then-content rhythm.

**Authenticated shell.** A two-column grid `15rem minmax(0, 1fr)`: a sticky full-height side rail (right hairline, padding 1.5rem 1.25rem, account block pushed to the bottom) and a main column with a 3.5rem top bar (bottom hairline), an optional onboarding band, and content centred at max-width 68rem with padding `clamp(1.5rem, 3vw, 3rem) clamp(1.25rem, 3vw, 3rem) 6rem`. Sections are separated by 3.5rem and headed by a 1rem title over an ink underline. Money layouts are `Summary` grids (4 → 2 columns), `two-column` grids (3rem gap), and borderless tables with hairline rows (0.85rem vertical padding).

**Breakpoints.** One breakpoint for the app, `max-width: 56rem`: hero, plates, two-column grids and the model grid collapse to one column; the figure returns to the top of its plate, un-sticks, and becomes 4:3 capped at 38vh; the compare arrow rotates 90°; header links and account actions fold behind a 2.75rem pill button whose dropdown sits under the header; the side rail disappears and a fixed bottom nav (raised paper, top hairline, safe-area padding) takes over; the notice button goes full width. The shared UI package uses `max-width: 48rem` for its own primitives (summary → 2 columns, page heading stacks).

**Spacing rhythm.** The token scale is 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 rem. Component internals sit at 0.75–1.25rem, card padding at 1.25rem (1.25rem 1.5rem for the compare block and ops cards), section gaps at 2.5–3.5rem, and plate spacing at `clamp(4rem, 8vw, 7rem)`. Between-element gaps inside a caption are 1.25rem; inside a form 1.25rem; inside a field 0.45rem.

## Elevation & Depth

The system is flat. Depth is conveyed by hairline rules and by three steps of paper lightness — raised paper for things you can touch (fields, cards, the confirm panel, the bottom nav), canvas for the page, pressed paper for the selected nav item. Major divisions are ink rules (`ink-strong`, 1px); minor ones are hairlines (`line`). Dithered plates are composited with `mix-blend-mode: multiply` so their white becomes paper and they sit *in* the page rather than on it. The confirm sheet dims the page with ink at 45% opacity rather than a blur.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 12px 36px oklch(0.2 0.02 90 / 0.14)`, `--shadow-floating`): the confirm sheet panel and the mobile dropdown menu — the two elements that genuinely leave the page. Nothing at rest carries a shadow.
- **Focus halo** (`box-shadow: 0 0 0 3px var(--accent-soft)`): field controls on `:focus-within`, paired with an `accent` border.

### Named Rules
**The Hairline Rule.** Structure is drawn with 1px rules, not boxes. A card border is the exception, not the default; lists, tables, steps and providers are separated by hairlines with no background.

**The Two Floaters Rule.** Only elements that float over the page — the confirm sheet and the mobile menu — cast `--shadow-floating`. No hover lift, no ambient card shadows, no glass or backdrop blur.

## Shapes

Corners are square-ish: 2px (`sm`) for nav items, skeletons, the environment badge, the allocation bar and the ops button; 4px (`md`) for fields, cards, alerts, transfers and the confirm panel; 6px (`lg`) for the single landing card, the restatement compare block. The pill (`999px`) is reserved for buttons of every variant, status pills, the header's sign-in pill and the 2.75rem menu button. Borders are 1px throughout — `line` for containers, `line-strong` for controls and secondary buttons, `ink-strong` for a selected model card. Dots are 0.5rem circles (`accent` or a tone) used as the inline alert's marker and the nav's attention dot. Plate frames are hard-edged rectangles with no radius; the fern canvas has no frame at all. Glyph icons are absent: the only vector is the three-line menu button, which morphs into a close mark.

## Components

### Buttons
Quiet, small and pill-shaped; the primary is the only solid orange on a screen.
- **Shape:** pill (`999px`), 1px border (transparent unless a variant sets it), Inter 560 at 0.875rem, line-height 1, `padding: 0.85rem 1.2rem`, gap 0.6rem.
- **Primary:** `accent` fill, white label; hover fills `accent-hover`. One primary per decision area — the hero has it, the header does not.
- **Secondary:** transparent, `line-strong` border, `ink-strong` label; hover darkens the border to ink.
- **Ghost:** transparent, `accent-text` label, `padding-inline: 0.5rem`; hover underlines at 0.3em offset.
- **Danger:** transparent, border of `negative` mixed 50% into `line`, `negative` label.
- **States:** 120ms transitions on background/colour/border with `--ease-enter`; disabled at 55% opacity with `not-allowed`; pending shows a 0.85rem currentColor ring spinner and dims the label to 70%. Focus is the global 2px `accent` outline offset 3px.
- **Text link:** a bare underlined link in `ink-muted` at 0.8125rem, offset 0.3em, darkening to ink on hover — used for "Sign in" beside a primary pill.

### Chips (Status pills)
- **Style:** pill, 1px `line` border, transparent fill, `ink-default` label at 0.75rem, `padding: 0.375rem 0.6rem`, `white-space: nowrap`.
- **Tones:** `positive`/`negative`/`warning` colour the label and mix 40% of the tone into the border; `info` is the one filled tone — `accent-soft` fill, no border, `accent-text` label. On the orange onboarding band a pill takes an opaque paper fill and ink label to keep 4.5:1.

### Cards / Containers
- **Corner Style:** 4px for the model card, transfer card and confirm panel; 6px for the restatement compare block.
- **Background:** model cards and the confirm panel sit on `surface-raised`; the compare block and transfer card are transparent paper.
- **Shadow Strategy:** none at rest; the confirm panel alone carries `--shadow-floating` (see Elevation).
- **Border:** 1px `line`; `line-strong` on the confirm panel; `ink-strong` on the current model card.
- **Internal Padding:** 1.25rem (compare block 1.25rem 1.5rem; confirm panel 1.5rem), internal gap 1rem.
- **Compare block:** three-column grid `1fr auto 1fr` with a 1.25rem `ink-muted` arrow between two figures at 2rem/500/−0.02em over 0.75rem labels; the arrow rotates 90° on one column.

### Inputs / Fields
- **Style:** label above (Inter 520, 0.8125rem, ink) with a 0.45rem gap; control on `surface-raised` with a 1px `line-strong` border and 4px corners; the input itself is borderless, 0.9375rem, `padding: 0.8rem 0.9rem`; an optional prefix in `ink-muted` sits inside the control. Decimal inputs stay in Inter with tabular figures.
- **Focus:** border turns `accent` and a 3px `accent-soft` halo appears (120ms).
- **Error / Hint:** invalid controls take a `negative` border; hint and error text are 0.75rem below the control in `ink-muted` / `negative`.
- **Selects:** same control on `surface-raised`, 0.875rem, `padding: 0.6rem 0.75rem`.

### Navigation
- **Landing header:** sticky, paper fill, bottom hairline, 4.5rem tall. Serif wordmark left (emblem in `accent`, pixelated rendering); centred section links at 0.875rem in `ink-default` with a transparent bottom border that turns ink on hover (120ms); right, "Create an account" as a text link and "Sign in" as a `line-strong` pill (0.5rem 0.9rem). Under 56rem both groups hide behind a 2.75rem pill button whose three strokes (1.5px, square caps) rotate into a close mark over 200ms; the dropdown is paper with an ink bottom rule, `--shadow-floating`, rows of 1rem links separated by hairlines, the account action in `accent-text` 560, entering with a 4px rise over 200ms.
- **Shell side nav:** 0.875rem links in `ink-muted`, `padding: 0.6rem 0.75rem`, 2px corners; hover to ink; the current page fills `surface-subtle` in ink. An item needing attention is ink with a 0.5rem `accent` dot at its right edge and a visually-hidden "(action needed)".
- **Shell bottom nav (≤ 56rem):** fixed, `surface-raised`, top hairline, `space-around`, 0.75rem labels, safe-area bottom padding; the attention dot moves to the label's top-right.
- **Footer:** top hairline, wordmark left, wrapped 0.8125rem links right (hover underline), full-width 0.8125rem disclaimer in `ink-muted`, max 60ch.

### Plate (signature)
A field-guide entry: an absolute 1px ink rule spanning the section, a 3:4 figure of two pre-dithered PNG frames (ordered Bayer 8×8, ink on white at 600×800, doubled nearest-neighbour to 1200×1600 so each dither cell is 2×2 device pixels) stacked with `mix-blend-mode: multiply` on a paper background, a mono figcaption in `accent-text` ("Plate I · river stones"), and a caption column with an Inter 600 title and 1.0625rem paragraphs. Frame B cross-fades over frame A on a 10s ease-in-out cycle so the texture drifts without anything moving. On first intersection (12% inset) the rule draws in with `steps(8, end)` over 320ms and the caption's children rise 8px with `--ease-enter`, staggered 0/60/120ms. Server markup carries no `data-inview`, so the plate is fully visible without JavaScript. Under reduced motion every animation is removed and the plate is static. Provenance for each raster (prompt and processing) is embedded in its PNG `tEXt` chunk.

### Character-field fern (signature)
A `<canvas>` filling the hero's right column, drawing a fern as a field of Geist Mono glyphs from the ramp ` ·.:-=+*%#@` at 11px, in `ink-strong` read from the computed style, alpha 0.55–1.0 by density. With `animate` it sways at ~10fps (100ms steps) so the motion reads as stepped glyphs; it pauses off-screen and is static under reduced motion. `aria-hidden`; the only imagery on the entry surfaces besides the plates.

### Onboarding notice (signature)
A full-width band under the shell top bar on `accent-soft` with a bottom rule of `accent` mixed 35% into `line`: a 1rem/600 ink heading with a status pill beside it (never a label above it), one 0.875rem sentence in `ink-default` with the rail position ("Step 2 of 5"), and a single button — primary for action, secondary when the tone is negative. The negative tone tints the band with `negative` at 10% into paper. Under 56rem the button spans the band.

### Allocation bar
A 0.5rem-tall flex bar with 2px gaps and 2px corners; segments run `accent`, `accent` at 62% into paper, `accent` at 34% into paper, `ink-strong`, `line-strong`. The legend is 0.8125rem with 0.6rem swatches and Inter 520 symbols. It is the one place orange appears as a data fill.

### Inline alert
A 4px-cornered hairline box with a 0.5rem tone dot at the left (`accent` for info, `warning`, `negative`, `positive`), 0.875rem text with a 560 title, and an optional action on the right. No side tab, no tinted fill.

### Environment badge
Geist Mono, 0.6875rem, uppercase, 0.06em, `accent-text` on `accent-soft`, 2px corners, `padding: 0.3rem 0.5rem`. Renders only for the sandbox environment.

## Do's and Don'ts

### Do:
- **Do** draw structure with 1px rules — `ink-strong` for major divisions (hero, plates, closing statement, section headings) and `line` for rows, lists and containers — and let them span the page while the text measure stays narrow.
- **Do** keep `accent` (#ff5c00) to marks: fills, bars, dots, rules, focus. Use `accent-text` for any orange word and `accent-soft` for the one permitted tint.
- **Do** reserve Instrument Serif 400 for the entrance headline, the landing wordmark, the closing statement and the portfolio's headline value; set every other heading in Inter (600 for plate titles, 500–520 elsewhere).
- **Do** number with Geist Mono 0.75rem in `accent-text` only where sequence carries meaning (plates I–IV, steps 01–05, facts, timeline markers).
- **Do** use the token durations — 120ms for state, 200ms for menus, 320ms for entrances — with `cubic-bezier(0.2, 0.8, 0.2, 1)`, and make every animation `none` under `prefers-reduced-motion: reduce`.
- **Do** make artwork from the two families only: ordered-dithered monochrome nature photographs shipped as `-a`/`-b` frame pairs composited with `multiply`, or the character-field fern; embed provenance in every raster's `tEXt` chunk.
- **Do** put one primary pill per decision area and let the alternative be a text link or a `line-strong` pill.
- **Do** set all numbers tabular, right-align money columns, and colour signed values only with `positive`/`negative`.

### Don't:
- **Don't** use gradients, glass, backdrop blur, hover lifts or resting shadows; `--shadow-floating` belongs to the confirm sheet and the mobile menu alone.
- **Don't** set orange text in `accent` or tint any surface other than with `accent-soft` (or `negative` at 10% for the negative onboarding band).
- **Don't** add glyph icons, icon cards, three-up feature grids, hero metrics or testimonial blocks; the landing page is plates and captions.
- **Don't** put a label, kicker or eyebrow above a heading; headings lead, and status sits beside them as a pill.
- **Don't** round corners beyond 6px except on buttons, status pills and the two header pills; don't use thick one-sided "side-tab" borders to mark tone — use the 0.5rem leading dot.
- **Don't** introduce a second hue for neutrals; every paper, ink and hairline stays on oklch hue 90.
- **Don't** render dithered artwork at runtime or at 1× cell size; ship pre-dithered frames doubled with nearest-neighbour.
