# Quicksort Design System + Light/Dark Theming

**Date:** 2026-09-05
**Status:** Implemented

## Goal

Three deliverables, one system:

1. A token layer derived from the Quicksort brand identity (the Claude Design bundle in `quicksort-design-system/`).
2. Adoption of that layer across every route, replacing ~380 hardcoded color sites.
3. Light and dark themes, dark being the default so the live site is visually unchanged on launch.
4. A living style guide at `/design-system` that renders the real components, so it cannot drift.

## Decisions

| Question | Decision |
|---|---|
| Default theme | **Dark.** Toggle to light, remembered in `localStorage`. `prefers-color-scheme` is not consulted for the default. |
| Adoption depth | **Full refactor, all routes.** Every hardcoded hex becomes a semantic token. |
| `/design-system` content | **Living style guide** — foundations plus a gallery rendering the site's real components. |
| Off-brand hues | **Kept, but brought into the system** as documented `category-*` tokens with light-mode variants. Flagged on the design-system page as an exception to the brand doc's single-accent rule. |
| `/design-system` visibility | **Unlisted + `noindex`.** Reachable by URL, not linked from the main nav, excluded from search engines. |

## Token architecture

Three layers. Components may only ever touch layer 3.

### Layer 1 — brand primitives

From `quicksort-design-system/project/colors_and_type.css`, plus the values the site already ships:

Rich Black `#000710`, Ink `#141414`, Dim Gray `#8E8E8E`, Timberwolf `#D6D6D6`,
Seasalt `#FAFAFA`, Signal Lime `#CCFF00`, and the site's own `#000000`, `#101010`,
`#1f242f`, `#f5f5f6`, `#94969c`, `#cecfd2`, `#727272`, `#b8e600`.

Primitives are never referenced by a component.

### Layer 2 — semantic tokens

Defined on `:root` (dark) and overridden under `[data-theme="light"]`. The dark
column reproduces today's site exactly; the counts are the current usage that
justifies each token's existence.

| Token | Dark (unchanged from today) | Light | Current usage |
|---|---|---|---|
| `--qs-surface` | `#000000` | `#FAFAFA` | 36× |
| `--qs-surface-raised` | `#101010` | `#FFFFFF` | 7× |
| `--qs-surface-sunken` | `#1f242f` | `#F0F1F3` | 7× |
| `--qs-surface-inverse` | `#FAFAFA` | `#141414` | inverted CTA blocks |
| `--qs-text-primary` | `#f5f5f6` | `#000710` | 57× |
| `--qs-text-secondary` | `#cecfd2` | `#3A3A3A` | 11× |
| `--qs-text-muted` | `#94969c` | `#616161` | 73× |
| `--qs-text-faint` | `#7D7D7D` | `#6B6B6B` | 4× |
| `--qs-text-inverse` | `#000710` | `#FAFAFA` | text on inverse surfaces |
| `--qs-line` | `#1f242f` | `#D6D6D6` | 12× |
| `--qs-line-strong` | `rgba(250,250,250,.24)` | `rgba(0,7,14,.16)` | hairline emphasis |
| `--qs-accent` | `#CCFF00` | `#CCFF00` | 32× |
| `--qs-accent-hover` | `#b8e600` | `#b8e600` | 3× |
| `--qs-accent-fg` | `#141414` | `#141414` | text sitting on lime |
| `--qs-accent-text` | `#CCFF00` | `#5C7300` | lime used *as* text |

**The `accent` / `accent-text` split is the one substantive design decision.**
Signal Lime on Seasalt measures ~1.1:1 contrast — illegible. So lime-as-a-fill
stays lime in both themes (with Ink text on it, exactly as the brand bundle
specifies), while lime-as-text darkens to `#5C7300` in light mode only. This
preserves the brand's single-accent rule while staying readable.

Category tokens (`--qs-category-violet|pink|blue|red|green`) follow the same
pattern: unchanged in dark, desaturated and darkened in light so they hold
contrast on Seasalt.

Non-color tokens — type scale, spacing (4px base), radii, elevation, motion
easings and durations, brand grid — are lifted from the bundle unchanged and are
theme-independent.

### Layer 3 — Tailwind color names

`tailwind.config.js` maps the semantic tokens to utility names, so components read:

```
bg-surface  bg-surface-raised  text-primary  text-muted  border-line
bg-accent text-accent-fg  text-accent-text
```

## Theme mechanics

- `<html data-theme="dark">` is the switch. A ~5-line blocking script in
  `index.html` reads `localStorage['qs-theme']` before first paint, so there is
  no flash of the wrong theme.
- `src/lib/theme.tsx` provides `ThemeProvider` and `useTheme()`.
- `ThemeToggle` appears in the main nav (desktop and mobile) and on `/design-system`.
- `color-scheme` is set per theme so scrollbars and native form controls follow.

## Surfaces that are not CSS classes

Four components paint color from JavaScript and must consume the theme directly:

- `GameOfLifeCanvas` — the dead-cell ramp `rgb(51,51,51) → rgb(20,20,20)` must
  invert on light.
- `AnimatedNoise` — 5% white noise; needs to become dark noise on light.
- `SectionSeparator` — the `bg-[#000000]` gap-filler behind the cross icons.
- `VoiceAiVisual` — the violet bar, which becomes a category token.

Also ~52 `text-white` / `border-black/10`-style opacity utilities need mapping.

## `/design-system` page

Route `/design-system`, unlisted, `noindex`. Uses the site nav and footer, with a
prominent theme toggle so the page doubles as the QA surface for both themes.

- **Foundations** — palette swatches that read their own computed token value at
  runtime (so they cannot drift), type scale in Inter + Hanken Grotesk, spacing
  scale, radii, elevation, motion, the 96px brand grid and the lime halo.
- **Components** — live `Button`, `Card`, `Badge`, `Tabs`, nav items, form
  fields, list rows. Rendered from the real components, never re-implemented.
- **Usage rules** — the single-accent rule, the category-color exception, the
  contrast note on lime-as-text.

## Verification

The project has no test framework, so verification is empirical:

1. `npm run build` passes with no TypeScript errors.
2. All 11 routes walked in both themes, checking for unreadable text,
   invisible borders, and surfaces that failed to flip.
3. Contrast spot-checks on every text token against its surface.
4. `git grep` for surviving hardcoded hexes outside the token definitions —
   the refactor is done when that returns only the token layer itself.


---

## What shipped, and where it departed from this plan

The design above is what was built. Five things were decided during
implementation and are worth recording:

**Tokens are RGB triplets.** Storing `--qs-surface: #000` would have broken
every Tailwind opacity modifier (`text-ink/40`, `border-signal/20`), because
Tailwind cannot decompose a `var()` colour. Solid colours are therefore stored
as space-separated triplets (`--qs-surface-rgb: 0 0 0`) and consumed as
`rgb(var(--qs-surface-rgb) / <alpha-value>)`. A derived plain colour var
(`--qs-surface`) sits alongside each one for hand-written CSS, SVG gradient
stops and inline styles. Genuinely translucent tokens (`line-strong`,
`signal-soft`, `photo-scrim`) stay as `rgba()` and are not meant to be stacked
with a further opacity modifier.

**Two light-mode values were darkened for contrast.** Dim Gray `#8E8E8E`, the
brand's muted neutral, measures ~3.0:1 on Seasalt — below AA, and it carries
most of the body copy (73 usages). It ships at `#616161` in light mode.
`--qs-text-faint` was lifted from `#727272` to `#7D7D7D` because it landed at
3.96:1 on `surface-raised` in dark mode.

**`destructive` got its own token.** The shadcn destructive variant was mapped
to `cat-red` (`#FF303E`), which leaves its label at 3.4:1. It now uses
`--qs-danger` (`#BE121E` dark / `#B91C1C` light) with white text. `cat-red`
stays decorative, for the Data for AI tile.

**White artwork inverts rather than duplicating files.** The client logos and
several monochrome SVGs are flat white with no light-mode counterpart. A
`.qs-invert-on-light` utility flips them under `[data-theme="light"]` instead
of shipping a second set of assets.

**A few near-identical greys were consolidated.** `#1a1a1a`, `#1c1c1c` and
`#101010` all became `surface-raised`; `#2a2a2a` and `#1f242f` became
`surface-sunken`; `text-white` and `bg-neutral-50` became `ink` (`#f5f5f6`).
These are sub-perceptual shifts in dark mode, and collapsing them onto named
steps is the point of the exercise — but dark mode is *near*-identical to
before, not byte-identical.

## Verification performed

- `npm run build` passes. The project has no TypeScript installed, so the build
  is esbuild-only and does not typecheck.
- All 11 routes walked in both themes with a headless browser; no console
  errors beyond two pre-existing React Router v7 future-flag warnings.
- Theme toggle exercised in both directions: `data-theme`, React state and
  `localStorage` stay in sync, and the choice survives a reload.
- A scripted WCAG contrast audit ran over every text node on all 11 routes in
  both themes. Everything clears AA except two decorative `·` separators inside
  the email-signature markup, which is intentionally hard-coded because email
  clients have no themes. The team-card names are reported as failures by the
  audit but are white on a translucent dark scrim over a photo; the script
  cannot see through the scrim to the photo, and they were confirmed readable
  by eye.


---

## Follow-up: the button, and typography

Two gaps surfaced after the first pass and were closed.

### One button, not six

The design-system gallery was hand-writing its button markup while the site
used six near-identical copy-pasted class strings — so the page claimed to
show live components but showed a shape the site did not ship. They had also
drifted apart: some CTAs hovered to `signal-hover`, others to `signal/90`.

The brand variants now live on the shared `Button` (`src/components/ui/button.tsx`):

- **Variants** — `signal` (the lime CTA), `inverse`, `outline`, `quiet`.
- **Sizes** — `qs-sm` (header), `qs` (default), `qs-hero` (steps down on small
  screens), `qs-lg` (a page's single terminal action). Each size carries
  padding *and* type, because on this site the two always travel together.

All six call sites now read `<Button variant="signal" size="…">`, and the
gallery renders the same component.

**Shape is a deliberate departure.** The brand bundle specifies pill buttons
(999px); the running site ships `rounded-lg` (8px) and that is what the system
documents — the live site wins over the exported prototype. The pill radius
remains a token and is still used for chips and the theme toggle. This is
called out on the design-system page rather than resolved silently.

### Typography

The site's type came from Anima-generated variables, all set in Inter, plus one
Roboto leftover. **~78 references pointed at five variables that were never
defined** (`--display-lg-semibold`, `--display-xs-semibold`, `--text-sm-semibold`,
`--text-sm-medium`, `--text-md-medium`), so those styles silently inherited.

Rather than rewrite ~500 call sites, the variables themselves were re-pointed
at the design system, and the five missing steps defined:

- **Display steps → Hanken Grotesk** (`--qs-font-display`) — every heading.
- **Text steps → Inter** (`--qs-font-sans`) — body and all UI.
- **Roboto dropped**, folded into the Inter scale and removed from the font request.
- Sizes were left exactly as they were, so the change is one of face and
  weight, not layout.

Each step is also a Tailwind class (`font-display-md-semibold`,
`font-text-md-regular`, …) carrying family, weight, tracking and leading
together, and the design-system Type section renders the scale using those
same classes.

### README

Rewritten from Anima boilerplate to point at `/design-system` as the single
source of truth, with the two rules that follow from it: never write a raw
colour, size or radius in a component, and check both themes before shipping.

### Re-verification

Build passes. All 11 routes walked again in both themes: no console errors, and
the contrast audit returns the same result as before the change — clean except
the two decorative `·` in the static email-signature markup and the team-card
false positives described above. The lime CTAs were confirmed pixel-equivalent
after the refactor (8px radius, `10px 16px` / `16px 22px` padding, 16/18px type).
