# Quicksort Design System

> **Quicksort — We craft Human + AI Collaboration.**

This is the design system for Quicksort, extracted from the brand's Figma identity file. It contains the palette, typography, logo assets, brand grid, and ready-to-use slide and UI kit components you can drop into any Quicksort-branded artifact.

## Source material

This system is derived entirely from the **Quicksort identity Figma file** (`Untitled.fig`) the user provided. That file contains:

- **LOGO** — the Q mark (dark circle + light lozenge counterform + dark accent dot).
- **Identity / Identity 2** — brand-colour swatch slides naming Rich Black (#141414), Dim Gray (#8E8E8E), Timberwolf (#D6D6D6), Seasalt (#FAFAFA), plus the Signal Lime accent (#CCFF00).
- **Slide / CV** — two 1920×1080 slide templates sharing the same component: a 96px grid background with a radial fade and a top-edge halo (lime on light, white on dark).
- **Frame 4** — a 755×787 hero card showing mark + wordmark lockup on Rich Black.

No codebase, screenshots, or PRD were provided — **this is a brand / identity system, not a product UI system**. We include opinionated UI kit recreations (marketing site + chat-style product surface) that extend the identity into product territory, clearly flagged as extrapolations.

---

## Brand at a glance

- **Mission.** Human + AI collaboration. The visual language leans editorial + technical: confident black-and-white foundation, precise grid, one high-voltage accent.
- **Personality.** Professional, forward-thinking, optimistic, calm. Not playful, not cold.
- **Signature moves.** (1) The 96px brand grid with a radial fade. (2) A lime halo bleeding in from the top of dark or light slides. (3) Rounded-rectangle swatch cards with the hex written inside. (4) Generous negative space.

---

## Content fundamentals

Voice pulled from the Figma copy:

- **Register.** Declarative and confident, with a light editorial lift — not jargon-heavy, not cute.
  - e.g. "The Quicksort palette blends professionalism with forward-thinking energy."
  - e.g. "Rich Black → evokes trust and balance, grounding the brand in clarity."
- **Sentence shape.** Short subject → verb → benefit. Every sentence earns its keep.
- **Person.** Third-person brand voice ("Quicksort…", "The palette…") for identity material; switch to **"you"** (not "we") when addressing a user in product surfaces. Use **"we"** sparingly for company POV ("We craft human + AI collaboration").
- **Casing.** Title Case on slide titles ("Brand Colours"). Sentence case everywhere else. Never SHOUTY CAPS. Never Full Stops in micro-labels (swatch names, button text, nav).
- **The arrow.** `→` is a recurring connector: `Rich Black → evokes trust…`. Keep it. It signals cause/effect and pairs with the brand's forward-motion personality.
- **British / American spelling.** Source uses **"Colours"** (British). Default to British-English in identity copy; American is fine for product copy unless instructed otherwise.
- **Emoji.** No. The brand has never used emoji in any provided asset.
- **Hype words to avoid.** "revolutionary", "game-changing", "cutting-edge", "magical", "AI-powered" as a standalone claim. Prefer concrete verbs: *crafts, grounds, captures, blends, injects*.

Specific examples from source (reuse verbatim if relevant):

> "The Quicksort palette blends professionalism with forward-thinking energy."
> "Rich Black → evokes trust and balance, grounding the brand in clarity."
> "Dim Gray → injects bold energy and optimism, symbolizing innovation and momentum."
> "Timberwolf → provides neutrality and sophistication, a steady backdrop for enterprise credibility."
> "Seasalt → adds a distinctive, future-facing accent, capturing adaptability, creativity, and the human side of AI."

---

## Visual foundations

### Colour
- **Light mode** — Seasalt (#FAFAFA) canvas, Rich Black (#000710) text, Timberwolf (#D6D6D6) dividers, Dim Gray (#8E8E8E) muted labels.
- **Dark mode** — Ink (#141414) / Ink-2 (#151515) canvas, Seasalt text, same accent.
- **Accent** — Signal Lime (#CCFF00). Treat as a single-use spotlight: one lime element per composition. Also appears as a soft 40%-opacity halo at the top edge of slides.
- Never introduce a second accent colour. If more colour is required, use tinted neutrals.
- Imagery is **warm-neutral with subtle grain** — the source grain-texture.png is a full-bleed noise layer used on slide backgrounds.

### Type
- **Inter** — all UI, captions, wordmark, supporting copy. Medium (500) for display-weight lockups, Regular (400) for body.
- **Hanken Grotesk** — display headlines + swatch labels on identity slides. Regular weight, tight tracking (−0.06em on swatch labels, 0 on body-headline).
- **Helvetica Neue Medium** — used once in source for slide titles ("Brand Colours") inside a capsule. *Substitute:* we fall back to Inter Medium — see "Font substitutions" below.
- Size discipline: 45px body-headline, 42px title, 36px swatch label, 23px pagination on 1920×1080 slides. Never drop below 22px on slides.

### Space + grid
- **4px base** spacing scale (4, 8, 12, 16, 24, 32, 48, 64, 96, 128).
- **96px brand grid** with 1px hairlines at 5% opacity, masked by a radial gradient that fades to transparent at the edges. This is Quicksort's most recognisable background.
- Slide padding: **~100px** from the frame edge (matches Figma: 109/103px).
- Content width: comfortable, not cramped. Swatch cards at 356px wide in a 4-column layout.

### Shape + surface
- **Corner radii.** Cards `16px`, hero cards `20px`, title capsules `~10px`, pill chips `999px`. The logo counterform itself is a soft-edged lozenge (~70px radius).
- **Cards.** Flat colour fills, no borders on dark swatches, hairline borders (`rgba(0,7,14,0.08)`) on white surfaces. Minimal shadow — only when a card floats over imagery. Never use a coloured left-border accent.
- **Shadows.** Soft, cool, tightly-clustered (see `--qs-shadow-1..3`). Avoid hard or coloured shadows.
- **Borders.** Hairline only. Capsule outlines on dark slides use 0.6px white with low opacity.

### Backgrounds
- **Light slides** — Seasalt canvas + the brand grid with radial fade + optional top-edge **lime halo** (40% opacity, blurred).
- **Dark slides** — Ink canvas + the brand grid (inverse) + optional **white halo** (10% opacity).
- **Grain layer** — the `grain-texture.png` asset can overlay either, `mix-blend-mode: overlay` at low opacity, for a subtle film quality.
- No photo-real illustrations. No gradients other than the halo + the radial grid mask.
- Never: bluish-purple gradients, emoji tiles, clipart, 3D isometrics.

### Motion
- **Easing.** `cubic-bezier(0.2, 0.8, 0.2, 1)` default — confident-out, no overshoot.
- **Durations.** 120/200/360/640ms steps. Prefer 200–360ms for most UI motion.
- **Style.** Fades, slight translate-Y (4–8px), opacity. No bounce, no spring, no parallax. Restrained, editorial.

### States
- **Hover.** Primary CTAs: brighten (lime) or darken (ink) by ~8%, no scale. Links: underline grows from 0 → 100% over 200ms.
- **Press.** Darken by 12%, no physical shrink. Optional 1px translate-Y down.
- **Focus.** 2px outline in Signal Lime, offset 2px. Visible on every interactive element.
- **Disabled.** 40% opacity, `cursor: not-allowed`, no hover.

### Transparency + blur
- Use blur only for the lime halo and occasional frosted overlays (`backdrop-filter: blur(24px)`). Never on primary content.
- Transparency is a tool for layering the grid under content, not for stylistic glassmorphism.

### Layout rules
- Logo + wordmark appear **top-left** of slides and headers, 64–100px from the edge.
- Page numbers appear **bottom-right**, `qs-meta` style.
- Fixed elements: brand grid (full-bleed), halo (absolute top), page number (absolute bottom-right).

---

## Iconography

- **The source file contains no icon set.** Quicksort's identity is logo-forward and typography-forward; icons are not part of the extracted system.
- For product work, we substitute **Lucide** (https://lucide.dev — available via CDN). Lucide's 1.5px stroke, geometric-round, open-ended style matches the calm confidence of the Quicksort logo better than thicker or filled alternatives. **This is a substitution — flag it to the user and replace with an official set when one exists.**
- When using icons: keep stroke weight consistent at 1.5px, size at 20/24/32px, colour matched to text (never coloured-for-its-own-sake).
- **Emoji — never.**
- **Unicode arrows** — yes. `→` is already part of the brand voice. `↗`, `←`, `↑` are fine when they're semantic.

Assets in `assets/`:

- `logo-mark-dark.svg` / `logo-mark-light.svg` — the Q mark, two contexts.
- `logo-mark-accent.svg` — Q mark with lime accent dot (signature state).
- `logo-wordmark-dark.svg` / `logo-wordmark-light.svg` — mark + "Quicksort" lockup.
- `grain-texture.png` — full-bleed noise overlay from the source slides.

---

## Font substitutions (flag to user)

- **Helvetica Neue Medium** — used once in the Figma file on the "Brand Colours" capsule title. We don't have a license-safe web-served copy, so the CSS falls through from `Helvetica Neue` to `Inter 500`. **Please provide the licensed font file** if pixel-perfect Helvetica Neue matters; until then Inter Medium ships as the fallback.
- **Inter** and **Hanken Grotesk** — both loaded from Google Fonts, weights 300/400/500/600/700.

---

## File index

```
├── README.md                 — this file
├── SKILL.md                  — Agent-Skill entrypoint
├── colors_and_type.css       — CSS vars + semantic type + grid utilities
├── assets/
│   ├── logo-mark-*.svg       — Q mark (dark/light/accent)
│   ├── logo-wordmark-*.svg   — mark + Quicksort lockup
│   └── grain-texture.png     — slide background noise
├── preview/                  — Design System tab cards
├── slides/
│   ├── index.html            — navigable deck of brand slides
│   ├── LogoSlide.jsx
│   ├── ColoursSlide.jsx
│   ├── TypeSlide.jsx
│   ├── TitleSlide.jsx
│   ├── QuoteSlide.jsx
│   └── GridSlide.jsx
└── ui_kits/
    ├── marketing/            — quicksort.ai-style landing page recreation
    │   ├── index.html
    │   ├── Header.jsx
    │   ├── Hero.jsx
    │   ├── FeatureGrid.jsx
    │   ├── LogoCloud.jsx
    │   └── Footer.jsx
    └── product/              — "Human + AI" chat product surface
        ├── index.html
        ├── Sidebar.jsx
        ├── Composer.jsx
        ├── ChatStream.jsx
        └── TopBar.jsx
```

See `slides/` and `ui_kits/` READMEs for surface-specific guidance.
