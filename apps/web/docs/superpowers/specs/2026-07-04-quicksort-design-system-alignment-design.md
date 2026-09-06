# Quicksort Website — Design System Alignment

**Date:** 2026-07-04
**Status:** Approved design, pending spec review

## Goal

Bring the existing Quicksort marketing site (React + Vite + Tailwind) into alignment
with the **Quicksort Design System** brand bundle in `quicksort-design-system/`. This
is a **deep redesign across the whole site**, kept **dark-first**, that adopts the DS
tokens, typography, signature brand treatments, and component styles — and reworks
section layout/spacing/hierarchy toward the DS's editorial, generous-negative-space
feel.

The DS is a **brand/identity system** (tokens + component specimens + slide deck), not
a set of page mockups. So "match the design" means: make the site draw from the DS
token layer and component language, not pixel-copy a specific screen.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Depth | **Deep redesign** — reskin foundation + rework layouts/spacing/hierarchy |
| Scope | **Whole site** — all 8 routes + shared nav/footer |
| Colour modes | **Dark-first** — Ink canvas stays primary; light sections used selectively |
| Accents | **Keep service colours** as wayfinding (tokenized to one canonical hex each); **lime reserved for primary CTAs / brand spotlight** |

## Source of truth

- `quicksort-design-system/project/colors_and_type.css` — the canonical tokens.
- `quicksort-design-system/project/README.md` — brand rules (voice, discipline).
- `quicksort-design-system/project/preview/*.html` — component specimens (exact values).
- `quicksort-design-system/project/slides/slide.css` — grid + halo + grain treatments.

---

## 1. Token foundation

Replace the leftover shadcn blue-slate HSL variables in `tailwind.css` and wire the
real DS tokens into `tailwind.config.js` so components use semantic classes instead of
scattered hex.

### 1.1 Palette (exact DS hex)

Core neutrals:
- `ink` `#141414` — primary dark canvas
- `ink-2` `#151515` — off-ink surface
- `rich-black` `#000710` — deepest text (light mode)
- `dim-gray` `#8E8E8E` — muted labels
- `timberwolf` `#D6D6D6` — pale divider/surface
- `seasalt` `#FAFAFA` — near-white surface / dark-mode text
- `white` `#FFFFFF`, `black` `#000000`

Foreground ramp (light): `fg-1 #000710`, `fg-2 #3A3A3A`, `fg-3 #8E8E8E`, `fg-4 #727272`.
Foreground ramp (dark/inverse): `fg-inv #FAFAFA`, `fg-inv-2 rgba(250,250,250,.72)`, `fg-inv-3 rgba(250,250,250,.48)`.
Borders: `border rgba(0,7,14,.08)`, `border-strong rgba(0,7,14,.16)`, `border-inv rgba(250,250,250,.12)`, `border-inv-strong rgba(250,250,250,.24)`.

Signal accent (single brand spotlight):
- `lime` `#CCFF00`, `lime-soft rgba(204,255,0,.4)`

Service wayfinding accents (kept, harmonized to one canonical hex each). These map the
current drift (`#309eff`, `#FF303E`/`#f14a55`, `#3AE165`/`#39e064`/`#30B753`) to single
tokens:
- `svc-business` `#309EFF` (blue)
- `svc-data` `#FF303E` (red)
- `svc-infra` `#3AE165` (green)

Careers accents (kept, tokenized): `care-purple #A78BFA`, `care-pink #F472B6`, and a
job-badge magenta set (`bg #4E0D30`, `border #9E155E`, `dot #ED46BB`, `text #F9A7DF`).

**Accent discipline (the rule that keeps it cohesive):** lime is only for primary CTAs
and the brand hero spotlight — at most one lime element per composition. Service
colours are wayfinding only: the icon tile, eyebrow, and hover state *on that service's
own page/nav row*. Never two saturated accents in one composition; if more
differentiation is needed, use tinted neutrals.

### 1.2 Typography

Load three families (currently only Inter is served): **Inter** (UI/body/wordmark),
**Hanken Grotesk** (display headlines), **JetBrains Mono** (eyebrows/meta/code). Weights
300/400/500/600/700 via the existing Google Fonts `@import` (extend it).

Tailwind families:
- `font-display` → `'Hanken Grotesk', 'Inter', sans-serif` (headlines)
- `font-sans` → `'Inter', 'Helvetica Neue', Arial, sans-serif` (body/UI) — default
- `font-mono` → `'JetBrains Mono', ui-monospace, monospace` (eyebrows/meta/code)

Role mapping:
- **H1/H2/H3** → `font-display`, weight 400, tight leading (~1.0–1.15), tracking
  `-0.01em` to `-0.04em`. (Today only Home's H1 uses Hanken; make it consistent.)
- **Body** → Inter, `fg-2`/`fg-inv-2`.
- **Eyebrow** → `font-mono` (or Inter 500) uppercase, letter-spacing `.12em`, `fg-3`.
- **Meta / page numbers** → `font-mono`, `fg-4`, letter-spacing `.02em`.

Fix the half-built token set: `display-lg/xs-semibold` and `text-sm-*` are referenced in
JSX but not defined in `tailwind.css`. Either define them or replace usages with the
DS-driven classes above (prefer the latter where sections are being reworked anyway).

### 1.3 Scales

- **Spacing** — 4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- **Radii** — `sm 6`, `md 10` (capsule/input), `lg 16` (card), `xl 20` (hero card),
  `pill 999`.
- **Shadows** — soft, cool, tightly-clustered (`shadow-1..3` from DS). No coloured/hard
  shadows.
- **Motion** — easing `cubic-bezier(0.2,0.8,0.2,1)`; durations 120/200/360/640ms; prefer
  200–360ms. Fades + 4–8px translate only. No bounce/spring.

---

## 2. Signature brand treatments (new reusable components)

Replace the ad-hoc `SectionGridOverlay` (`white/40` framed column) with the DS brand
backdrop, applied consistently sitewide so every page shares one visual language.

- **`BrandGrid`** — 96px hairline grid (`rgba(250,250,250,.05)` dark / `rgba(0,7,14,.06)`
  light), radial-masked `ellipse 70% 70% at 50% 38%, black 0%, transparent 92%`. Dark +
  light variants. Full-bleed, `pointer-events:none`, behind content.
- **`Halo`** — top-edge blurred halo: lime `opacity .42` on light, white `opacity .10`
  on dark; `~1200×360`, `blur(20px)`, positioned `top:-260px`, centered.
- **Grain wash** (optional) — `grain-texture.png`, `mix-blend-mode: screen` `opacity .18`
  (dark) / `multiply .08` (light). Use sparingly on hero/feature backdrops.
- Keep `SectionSeparator`'s `+`-marked hairline rule but recolor to DS `border-inv`.

`SectionGridOverlay` is refactored into `BrandGrid` (or kept as a thin wrapper) so
existing call sites update in place.

---

## 3. Core components normalized to DS spec

### 3.1 Button (biggest visible change: rectangular → pill)

`ui/button.tsx` variants become **pill-shaped (`radius: 999px`)**, Inter 500 ~15px,
padding `12px 22px`, with the `→` arrow convention on primary actions:
- **Primary** — bg `ink`, text `seasalt`.
- **Accent** — bg `lime`, text `ink` (primary CTAs — "Get in touch", "Apply now").
- **Secondary** — transparent, text `ink`/`seasalt`, `1px` hairline border.
- **Ghost** — transparent, no border.
- Hover: brighten lime / darken ink ~8%, **no scale**. Press: darken ~12%, optional 1px
  translate-Y. Disabled: 40% opacity, `not-allowed`.

### 3.2 Focus state (add sitewide)

`2px` solid `lime` outline, `offset 2px`, visible on every interactive element. Currently
absent.

### 3.3 Card

`ui/card.tsx` + section cards normalized:
- **Light card** — bg `#fff`, `1px` hairline `border`, radius `16px`, padding `18px`;
  eyebrow (mono/Inter uppercase, `dim-gray`), Hanken title (~22px, `fg-1`), Inter body
  (~13–14px, `fg-2`).
- **Dark card** — bg `ink`, text `seasalt`, radius `16px`; hairline `border-inv` (no
  coloured left-border accents — currently used on Careers value cards; replace with
  hairline + optional tinted-neutral hover).
- **Signal card** — dark card with an internal lime halo bleed (top `-40px`, `~90%`
  wide, `blur 8px`, `opacity .35`). Use once, for a hero/feature highlight.

### 3.4 Form fields, chips, list rows

- **Inputs/textarea** — Inter 15px, padding `12px 14px`, `1px` border-strong, radius
  `10px`. (Dark-mode variants with `border-inv`.)
- **Chips** — pill; Featured=ink, New=lime, Beta=seasalt+hairline.
- **List rows** — radius `14px`, padding `14px 16px`; light row `seasalt`+hairline, dark
  row `ink`, empty state `1px dashed`.

---

## 4. Per-page redesign notes

Dark-first throughout. Every page gets the consistent `BrandGrid` backdrop + optional
halo (replacing the current inconsistency where only Home is "framed").

- **Nav** (`MainNavigationSection`) — pill "Get in touch" (accent), DS grid-aware border
  (`border-inv`), tokenized colours. Services dropdown rows keep their service colour on
  the matching row's icon tile (wayfinding), hover → lime consistent with DS.
- **Home / Desktop**
  - **Hero** — keep the interactive lime "Human + AI" scramble moment (very on-brand: it
    *is* the one lime spotlight). Swap backdrop to `BrandGrid` + `Halo`; pill CTA; Hanken
    H1 (already is). Keep GSAP entrance but ensure `power3.out` → DS easing, no overshoot.
  - **KeyFeatures / DetailedCapabilities / TeamShowcase** — DS cards (16px radius, Hanken
    titles, hairline borders), consistent grid backdrop, restrained motion (fades +
    small translate; strip any bounce). Service cards in DetailedCapabilities keep their
    service icon-tile colour (wayfinding), hover → lime.
- **Service pages** (AiForBusiness, DataForAi, InfrastructureFor)
  - Unified, **responsive** layout (fix fixed-desktop `min-w`/`gap-[130px]`/`py-24`),
    DS cards, brand grid. Each page's eyebrow + icon tile use its `svc-*` token; body/
    headings neutral. Keep the bespoke animated icons (`AiForBusinessIcon`,
    `DataForAiIcon`, `GameOfLifeCanvas`) but retune their accent to the canonical `svc-*`
    hex.
- **Blog / BlogPostDetail** — DS post cards, mono eyebrow, pill tabs + pill pagination,
  DS `prose` theme (tokenized code/blockquote/link colours). Lime eyebrow → keep for the
  brand-level "Our blog" eyebrow, or move to mono neutral (decide during build; default:
  mono neutral, lime stays for CTAs).
- **Careers / JobDetail** — responsive; DS cards for value cards (replace coloured
  left/hover-border with hairline + tinted-neutral hover) and job cards; tokenized job
  badge; pill CTAs; mono eyebrow. Keep the decorative rotated-rectangle geometry (on-
  brand). Careers accents (`care-purple`/`care-pink`) tokenized and used sparingly.
- **Footer** (`SiteFooter`) — pill CTA, `BrandGrid`, tokenized colours; keep the
  homepage-variant rotated-rectangle motif (recolored to DS neutrals + one lime rect).

---

## 5. Content / voice (light touch)

Not a copy rewrite, but where micro-labels are edited, follow DS voice: sentence case
(no SHOUTY CAPS), no full stops on nav/button/swatch micro-labels, keep the `→` arrow
connector, no emoji.

---

## 6. Out of scope

- No new pages/routes or CMS changes.
- No copy rewrite beyond micro-label casing.
- Missing asset references (`/image*.png`, `-team-member-7/8.png`) are pre-existing bugs;
  fix or placeholder them opportunistically, not a goal.
- The DS slide deck (`slides/`) is reference only — not shipped to the site.
- Light-mode-first redesign (explicitly kept dark-first).

## 7. Success criteria

- No un-tokenized brand hex left in `src/` (service/careers accents come from `svc-*` /
  `care-*` tokens; neutrals from DS tokens).
- All three fonts served; H1/H2/H3 render in Hanken Grotesk.
- Buttons are pill-shaped sitewide; every interactive element has the lime focus ring.
- One consistent `BrandGrid` backdrop across all pages; no leftover `white/40` framed
  overlay.
- Service pages + Careers are responsive (no horizontal scroll / fixed-desktop widths on
  mobile).
- `npm run build` succeeds; site renders correctly at mobile + desktop widths.
