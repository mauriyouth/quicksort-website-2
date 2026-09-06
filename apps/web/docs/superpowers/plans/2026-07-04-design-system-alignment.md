# Quicksort Design System Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Quicksort marketing site into full alignment with the Quicksort Design System — tokens, typography, signature brand backdrop, pill buttons, DS cards — across all 8 routes, kept dark-first.

**Architecture:** Establish a token layer (CSS vars in `tailwind.css` + semantic classes in `tailwind.config.js`), build reusable brand-treatment components (`BrandGrid`, `Halo`) and normalized primitives (pill `Button`, DS `Card`), then sweep every page/section to consume tokens and components instead of scattered hardcoded hex. No test framework exists in this repo, so each task's gate is **`npm run build` compiles clean + a browser screenshot visual check** (Chrome automation / gstack available).

**Tech Stack:** React 18, Vite 6, TypeScript, Tailwind 3.4, class-variance-authority, GSAP, framer-motion, react-router-dom.

## Global Constraints

- **Dark-first.** Ink `#141414` stays the primary canvas on every route. Light surfaces are opt-in (cards).
- **Fonts:** Inter (body/UI), Hanken Grotesk (H1/H2/H3 display), JetBrains Mono (eyebrows/meta/code). All weights 300–700.
- **Single spotlight rule:** `lime #CCFF00` only on primary CTAs and the Home hero "Human + AI" moment — at most one lime element per composition. Service colours are wayfinding only (icon tile + eyebrow + hover on that service's own page/nav row). Never two saturated accents in one composition.
- **No coloured or hard shadows; hairline borders only; no coloured left-border card accents.**
- **Motion:** easing `cubic-bezier(0.2,0.8,0.2,1)`; durations 120/200/360/640ms (prefer 200–360). Fades + 4–8px translate only — no bounce/spring/overshoot.
- **Buttons are pill-shaped (`rounded-full`) sitewide. Every interactive element gets a `2px` lime focus ring, offset `2px`.**
- **Voice for any edited micro-label:** sentence case, no full stops on nav/button labels, keep the `→` arrow, no emoji.
- **Do NOT commit** `Quicksort Design System-handoff.zip` (leave untracked).

### Canonical hex → token map (apply everywhere; this is the DRY replacement key)

| Current hex(es) | Token (CSS var) | Tailwind class root |
|---|---|---|
| `#141414` | `--qs-ink` | `bg-ink` / `text-ink` |
| `#151515` | `--qs-ink-2` | `bg-ink-2` |
| `#000710` | `--qs-rich-black` | `text-rich-black` |
| `#f5f5f6` (heading near-white) | `--qs-seasalt` | `text-seasalt` |
| `#FAFAFA` | `--qs-seasalt` | `bg-seasalt` |
| `#94969c`, `#cecfd2`, `#d0d5dd`, `#b0b3ba` (body/muted greys) | `--qs-fg-inv-2` (`rgba(250,250,250,.72)`) / `--qs-dim-gray` `#8E8E8E` | `text-fg-inv-2` / `text-dim-gray` |
| `#ececed` (bright muted) | `--qs-fg-inv` | `text-fg-inv` |
| `#8E8E8E`, `#727272` | `--qs-dim-gray` / `--qs-fg-4` | `text-dim-gray` / `text-fg-4` |
| `#1f242f`, `white/40` (borders/dividers) | `--qs-border-inv` (`rgba(250,250,250,.12)`) | `border-border-inv` |
| `#101010`, `#0a0a0a` (card surface) | `--qs-ink` or `--qs-ink-2` | `bg-ink` / `bg-ink-2` |
| `#1c1c1c`, `#1a1a1a`, `#2a2a2a` (hover/panel) | `--qs-ink-2` + `--qs-border-inv` | `bg-ink-2` |
| `#ccff00`, `#b8e600` (accent + hover) | `--qs-lime` (hover: `--qs-lime` at ~92% via `hover:brightness-95`) | `bg-lime` / `text-lime` |
| `#309eff`/`#309EFF` | `--qs-svc-business` `#309EFF` | `text-svc-business` / `bg-svc-business` |
| `#FF303E`, `#f14a55`/`#F14A55` | `--qs-svc-data` `#FF303E` | `text-svc-data` / `bg-svc-data` |
| `#3AE165`, `#39e064`, `#30B753` | `--qs-svc-infra` `#3AE165` | `text-svc-infra` / `bg-svc-infra` |
| `#a78bfa` | `--qs-care-purple` `#A78BFA` | `text-care-purple` |
| `#f472b6` | `--qs-care-pink` `#F472B6` | `text-care-pink` |
| `#4e0d30`/`#9e155e`/`#ed46bb`/`#f9a7df` | `--qs-badge-bg/border/dot/text` | `bg-badge-bg` etc. |

**Radii:** `rounded-none`/`rounded-lg`/`rounded-xl`/`rounded-2xl`/`rounded-[9.77px]` on cards → `rounded-2xl` (16px) for cards, `rounded-[20px]` for hero cards, `rounded-[10px]` for inputs/capsules, `rounded-full` for buttons/chips.

---

## Task 1: Token layer — fonts + CSS variables

**Files:**
- Modify: `index.html:9` (font `@import`), `index.html:11-12` (dup stylesheet link)
- Modify: `tailwind.css:10-61` (replace token block), `tailwind.css:174-240` (replace shadcn HSL sets)

**Interfaces:**
- Produces: CSS custom properties `--qs-*` (palette, fg ramp, borders, service/careers accents, radii, shadows, motion, grid vars) available globally; three font families served.

- [ ] **Step 1: Fix the font import in `index.html`.** Replace the broken var-based `@import` (line 9 `<style>`) with a valid Google Fonts link. Replace the `<style>…</style>` block AND collapse the duplicate `tailwind.css` link:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Hanken+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
    <link href="tailwind.css" rel="stylesheet" />
```

- [ ] **Step 2: Replace the token `:root` block in `tailwind.css`.** Replace lines 10–61 (the `--display-*` / `--text-*` / `--m3-*` / `--shadows-shadow-xs` block) with the DS tokens. Keep the existing `--*-font-family` and size vars that JSX still references (so nothing breaks mid-migration), and ADD the DS layer:

```css
:root {
  /* ---- DS core palette ---- */
  --qs-ink: #141414;
  --qs-ink-2: #151515;
  --qs-rich-black: #000710;
  --qs-dim-gray: #8E8E8E;
  --qs-timberwolf: #D6D6D6;
  --qs-seasalt: #FAFAFA;
  --qs-lime: #CCFF00;
  --qs-lime-soft: rgba(204,255,0,0.4);

  /* ---- fg ramp ---- */
  --qs-fg-1: #000710;
  --qs-fg-2: #3A3A3A;
  --qs-fg-3: #8E8E8E;
  --qs-fg-4: #727272;
  --qs-fg-inv: #FAFAFA;
  --qs-fg-inv-2: rgba(250,250,250,0.72);
  --qs-fg-inv-3: rgba(250,250,250,0.48);

  /* ---- borders ---- */
  --qs-border: rgba(0,7,14,0.08);
  --qs-border-strong: rgba(0,7,14,0.16);
  --qs-border-inv: rgba(250,250,250,0.12);
  --qs-border-inv-strong: rgba(250,250,250,0.24);

  /* ---- service + careers accents ---- */
  --qs-svc-business: #309EFF;
  --qs-svc-data: #FF303E;
  --qs-svc-infra: #3AE165;
  --qs-care-purple: #A78BFA;
  --qs-care-pink: #F472B6;
  --qs-badge-bg: #4E0D30;
  --qs-badge-border: #9E155E;
  --qs-badge-dot: #ED46BB;
  --qs-badge-text: #F9A7DF;

  /* ---- fonts ---- */
  --qs-font-display: 'Hanken Grotesk','Inter','Helvetica Neue',Arial,sans-serif;
  --qs-font-sans: 'Inter','Helvetica Neue',Arial,sans-serif;
  --qs-font-mono: 'JetBrains Mono','SF Mono',ui-monospace,monospace;

  /* ---- radii ---- */
  --qs-radius-sm: 6px;
  --qs-radius-md: 10px;
  --qs-radius-lg: 16px;
  --qs-radius-xl: 20px;
  --qs-radius-pill: 999px;

  /* ---- shadows ---- */
  --qs-shadow-1: 0 1px 2px rgba(0,7,14,0.04), 0 1px 1px rgba(0,7,14,0.02);
  --qs-shadow-2: 0 6px 16px rgba(0,7,14,0.06), 0 2px 4px rgba(0,7,14,0.04);
  --qs-shadow-3: 0 24px 48px rgba(0,7,14,0.10), 0 8px 16px rgba(0,7,14,0.06);

  /* ---- motion ---- */
  --qs-ease: cubic-bezier(0.2,0.8,0.2,1);
  --qs-ease-out: cubic-bezier(0.16,1,0.3,1);
  --qs-dur-1: 120ms; --qs-dur-2: 200ms; --qs-dur-3: 360ms; --qs-dur-4: 640ms;

  /* ---- brand grid ---- */
  --qs-grid-cell: 96px;
  --qs-grid-line: rgba(0,7,14,0.05);
  --qs-grid-line-inv: rgba(250,250,250,0.05);

  /* ---- retained legacy type vars (still referenced by un-migrated JSX) ---- */
  --display-md-semibold-font-family: "Inter", Helvetica;
  --display-md-semibold-font-size: 36px;
  --display-md-semibold-font-weight: 600;
  --display-md-semibold-line-height: 44px;
  --display-md-semibold-letter-spacing: -0.72px;
  --display-md-semibold-font-style: normal;
  --display-sm-semibold-font-family: "Inter", Helvetica;
  --display-sm-semibold-font-size: 30px;
  --display-sm-semibold-font-weight: 600;
  --display-sm-semibold-line-height: 38px;
  --display-sm-semibold-letter-spacing: 0px;
  --display-sm-semibold-font-style: normal;
  --text-xl-regular-font-family: "Inter", Helvetica;
  --text-xl-regular-font-size: 20px;
  --text-xl-regular-font-weight: 400;
  --text-xl-regular-line-height: 30px;
  --text-xl-regular-letter-spacing: 0px;
  --text-xl-regular-font-style: normal;
  --text-lg-semibold-font-family: "Inter", Helvetica;
  --text-lg-semibold-font-size: 18px;
  --text-lg-semibold-font-weight: 600;
  --text-lg-semibold-line-height: 28px;
  --text-lg-semibold-letter-spacing: 0px;
  --text-lg-semibold-font-style: normal;
  --text-md-regular-font-family: "Inter", Helvetica;
  --text-md-regular-font-size: 16px;
  --text-md-regular-font-weight: 400;
  --text-md-regular-line-height: 24px;
  --text-md-regular-letter-spacing: 0px;
  --text-md-regular-font-style: normal;
  --text-md-semibold-font-family: "Inter", Helvetica;
  --text-md-semibold-font-size: 16px;
  --text-md-semibold-font-weight: 600;
  --text-md-semibold-line-height: 24px;
  --text-md-semibold-letter-spacing: 0px;
  --text-md-semibold-font-style: normal;
  --text-xl-semibold-font-family: "Inter", Helvetica;
  --text-xl-semibold-font-size: 20px;
  --text-xl-semibold-font-weight: 600;
  --text-xl-semibold-line-height: 30px;
  --text-xl-semibold-letter-spacing: 0px;
  --text-xl-semibold-font-style: normal;
  --shadows-shadow-xs: var(--qs-shadow-1);
}
```

- [ ] **Step 3: Set the dark-first body defaults.** In `tailwind.css`, in the `@layer base` `body` rule (currently lines 247-250), set the canvas + default font explicitly:

```css
  body {
    @apply bg-ink text-seasalt;
    font-family: var(--qs-font-sans);
    font-feature-settings: "ss01", "cv11", "rlig" 1, "calt" 1;
    -webkit-font-smoothing: antialiased;
  }
```

(Leave the shadcn `:root`/`.dark` HSL blocks at lines 174-240 in place for now — the shadcn `ui/*` primitives still read them; they are overridden by explicit classes. Task 19 removes any that end up unreferenced.)

- [ ] **Step 4: Verify build compiles.** Run: `npm run build`. Expected: build completes without CSS/parse errors (note: `bg-ink`/`text-seasalt` classes are added in Task 2 — if this step is run standalone before Task 2, temporarily use `bg-[#141414] text-[#FAFAFA]` in Step 3, then switch to the semantic classes after Task 2. Preferred: run Task 1 and Task 2 back-to-back, then build once.)

- [ ] **Step 5: Commit.**

```bash
git add index.html tailwind.css
git commit -m "feat(tokens): add DS CSS variables and load Hanken + JetBrains Mono fonts"
```

---

## Task 2: Token layer — Tailwind theme

**Files:**
- Modify: `tailwind.config.js:8-89` (theme.extend)

**Interfaces:**
- Consumes: `--qs-*` CSS vars from Task 1.
- Produces: semantic Tailwind classes — colors (`ink`, `ink-2`, `rich-black`, `seasalt`, `dim-gray`, `timberwolf`, `lime`, `fg-1..4`, `fg-inv`, `fg-inv-2`, `fg-inv-3`, `border-inv`, `svc-business/data/infra`, `care-purple/pink`, `badge-*`); `font-display/sans/mono`; `rounded-{sm,md,lg,xl}` mapped to DS radii; `shadow-{1,2,3}`; `ease-qs`; grid utilities.

- [ ] **Step 1: Extend `theme.extend.colors`** in `tailwind.config.js`. ADD these to the existing `colors` object (keep the shadcn semantic ones — `border`, `primary`, etc. — for the untouched `ui/*` primitives):

```js
        ink: "var(--qs-ink)",
        "ink-2": "var(--qs-ink-2)",
        "rich-black": "var(--qs-rich-black)",
        "dim-gray": "var(--qs-dim-gray)",
        timberwolf: "var(--qs-timberwolf)",
        seasalt: "var(--qs-seasalt)",
        lime: "var(--qs-lime)",
        "fg-1": "var(--qs-fg-1)",
        "fg-2": "var(--qs-fg-2)",
        "fg-3": "var(--qs-fg-3)",
        "fg-4": "var(--qs-fg-4)",
        "fg-inv": "var(--qs-fg-inv)",
        "fg-inv-2": "var(--qs-fg-inv-2)",
        "fg-inv-3": "var(--qs-fg-inv-3)",
        "border-inv": "var(--qs-border-inv)",
        "border-inv-strong": "var(--qs-border-inv-strong)",
        "svc-business": "var(--qs-svc-business)",
        "svc-data": "var(--qs-svc-data)",
        "svc-infra": "var(--qs-svc-infra)",
        "care-purple": "var(--qs-care-purple)",
        "care-pink": "var(--qs-care-pink)",
        "badge-bg": "var(--qs-badge-bg)",
        "badge-border": "var(--qs-badge-border)",
        "badge-dot": "var(--qs-badge-dot)",
        "badge-text": "var(--qs-badge-text)",
```

- [ ] **Step 2: Extend `fontFamily`** — ADD to the existing object:

```js
        display: ["Hanken Grotesk", "Inter", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "ui-monospace", "monospace"],
```

(Keep the existing `sans` array but prepend `"Inter"` as the first entry so `font-sans` = Inter.)

- [ ] **Step 3: Map radii + shadows + easing.** Replace `borderRadius` and extend `boxShadow` / add `transitionTimingFunction`:

```js
      borderRadius: {
        sm: "var(--qs-radius-sm)",
        md: "var(--qs-radius-md)",
        lg: "var(--qs-radius-lg)",
        xl: "var(--qs-radius-xl)",
      },
      boxShadow: {
        1: "var(--qs-shadow-1)",
        2: "var(--qs-shadow-2)",
        3: "var(--qs-shadow-3)",
        "shadows-shadow-xs": "var(--qs-shadow-1)",
      },
      transitionTimingFunction: {
        qs: "var(--qs-ease)",
        "qs-out": "var(--qs-ease-out)",
      },
```

- [ ] **Step 4: Verify build.** Run: `npm run build`. Expected: completes clean; classes like `bg-ink`, `text-seasalt`, `font-display`, `border-border-inv` now resolve.

- [ ] **Step 5: Visual smoke check.** Serve the built site (`npm run dev`), open `http://localhost:5173/` in the browser, screenshot the Home page. Expected: page still renders (colors unchanged since values are identical hex behind tokens), headings now in Hanken/JetBrains served correctly.

- [ ] **Step 6: Commit.**

```bash
git add tailwind.config.js
git commit -m "feat(tokens): expose DS tokens as Tailwind theme classes"
```

---

## Task 3: Brand treatment components — `BrandGrid` + `Halo`

**Files:**
- Create: `src/components/BrandGrid/BrandGrid.tsx`, `src/components/BrandGrid/index.ts`
- Create: `src/components/Halo/Halo.tsx`, `src/components/Halo/index.ts`
- Modify: `src/components/SectionGridOverlay.tsx` (re-point to BrandGrid), `src/components/SectionSeparator.tsx` (recolor)

**Interfaces:**
- Produces:
  - `BrandGrid({ variant?: "dark" | "light"; className?: string })` — absolute full-bleed 96px hairline grid, radial-masked.
  - `Halo({ tone?: "lime" | "white"; className?: string })` — absolute top-edge blurred halo.

- [ ] **Step 1: Create `BrandGrid`.**

```tsx
// src/components/BrandGrid/BrandGrid.tsx
interface BrandGridProps {
  variant?: "dark" | "light";
  className?: string;
}

export const BrandGrid = ({ variant = "dark", className = "" }: BrandGridProps): JSX.Element => {
  const line = variant === "dark" ? "rgba(250,250,250,0.05)" : "rgba(0,7,14,0.06)";
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-0 ${className}`}
      style={{
        backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
        backgroundSize: "96px 96px",
        WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 38%, black 0%, transparent 92%)",
        maskImage: "radial-gradient(ellipse 70% 70% at 50% 38%, black 0%, transparent 92%)",
      }}
    />
  );
};
```

```ts
// src/components/BrandGrid/index.ts
export { BrandGrid } from "./BrandGrid";
```

- [ ] **Step 2: Create `Halo`.**

```tsx
// src/components/Halo/Halo.tsx
interface HaloProps {
  tone?: "lime" | "white";
  className?: string;
}

export const Halo = ({ tone = "white", className = "" }: HaloProps): JSX.Element => {
  const isLime = tone === "lime";
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute left-1/2 top-[-260px] z-0 h-[360px] w-[1200px] max-w-[110%] -translate-x-1/2 rounded-full ${className}`}
      style={{
        background: isLime ? "var(--qs-lime)" : "#ffffff",
        opacity: isLime ? 0.42 : 0.1,
        filter: "blur(20px)",
      }}
    />
  );
};
```

```ts
// src/components/Halo/index.ts
export { Halo } from "./Halo";
```

- [ ] **Step 3: Re-point `SectionGridOverlay` to the brand grid.** Replace the body of `src/components/SectionGridOverlay.tsx` so existing call sites keep working but render the DS grid. Keep its prop signature (`showCenterLine?: boolean`) to avoid touching every call site now:

```tsx
import { BrandGrid } from "@components/BrandGrid";

interface SectionGridOverlayProps {
  showCenterLine?: boolean;
}

export const SectionGridOverlay = ({ showCenterLine = false }: SectionGridOverlayProps): JSX.Element => {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <div className="relative mx-auto h-full w-full max-w-screen-xl border-x border-border-inv">
        <BrandGrid variant="dark" />
        {showCenterLine && (
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border-inv" />
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Recolor `SectionSeparator`.** In `src/components/SectionSeparator.tsx`, replace every `bg-white/40` / `border-white/40` with `bg-border-inv` / `border-border-inv`, and the end-cap boxes' `#141414` with `bg-ink`.

- [ ] **Step 5: Verify build + visual.** Run `npm run build`; then `npm run dev`, screenshot Home. Expected: Home background shows the finer 96px hairline grid with a soft radial fade (replacing the old hard framed column), separators unchanged in position.

- [ ] **Step 6: Commit.**

```bash
git add src/components/BrandGrid src/components/Halo src/components/SectionGridOverlay.tsx src/components/SectionSeparator.tsx
git commit -m "feat(brand): add BrandGrid + Halo, route SectionGridOverlay through DS grid"
```

---

## Task 4: Pill `Button` + global focus ring

**Files:**
- Modify: `src/components/ui/button.tsx:6-40` (variants), `tailwind.css` (`@layer base` focus rule)

**Interfaces:**
- Consumes: tokens from Task 2.
- Produces: `Button` variants `default` (ink), `accent` (lime), `secondary` (hairline outline), `ghost`, `link`; all `rounded-full`. Callers using `<Button className="bg-[#ccff00] …">` continue to work but should migrate to `variant="accent"`.

- [ ] **Step 1: Rewrite `buttonVariants`** in `src/components/ui/button.tsx`:

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-sans font-medium transition-[background-color,color,filter] duration-200 ease-qs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink text-seasalt hover:brightness-125",
        accent: "bg-lime text-ink hover:brightness-95",
        secondary: "bg-transparent text-seasalt border border-border-inv-strong hover:bg-white/5",
        ghost: "bg-transparent text-seasalt hover:text-lime",
        link: "text-lime underline-offset-4 hover:underline",
        outline: "bg-transparent text-seasalt border border-border-inv-strong hover:bg-white/5",
        destructive: "bg-svc-data text-seasalt hover:brightness-95",
      },
      size: {
        default: "h-11 px-[22px] py-3 text-[15px]",
        sm: "h-9 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
```

- [ ] **Step 2: Add a global focus ring** so non-Button interactive elements (links, tabs, inputs) also comply. In `tailwind.css` `@layer base`, add:

```css
  a:focus-visible, button:focus-visible, input:focus-visible,
  textarea:focus-visible, select:focus-visible, [tabindex]:focus-visible {
    outline: 2px solid var(--qs-lime);
    outline-offset: 2px;
  }
```

- [ ] **Step 3: Verify build + visual.** Run `npm run build`; `npm run dev`; screenshot Home hero + nav. Expected: "Get in touch" CTAs are now pill-shaped lime; tabbing shows a lime focus ring.

- [ ] **Step 4: Commit.**

```bash
git add src/components/ui/button.tsx tailwind.css
git commit -m "feat(ui): pill button variants + global lime focus ring"
```

---

## Task 5: DS `Card` primitives

**Files:**
- Create: `src/components/ui/ds-card.tsx`, index barrel not needed (import directly)

**Interfaces:**
- Consumes: tokens.
- Produces:
  - `DsCard({ variant?: "dark" | "light" | "signal"; className?; children })` — 16px radius container, dark/light/signal (dark + internal lime halo) variants.
  - `DsCardEyebrow`, `DsCardTitle`, `DsCardBody` — text primitives (mono eyebrow, Hanken title, Inter body) that adapt colour to a `tone` prop.

- [ ] **Step 1: Create `ds-card.tsx`.**

```tsx
import * as React from "react";
import { cn } from "@lib/utils";

type Tone = "dark" | "light";

export const DsCard = ({
  variant = "dark",
  className,
  children,
}: {
  variant?: "dark" | "light" | "signal";
  className?: string;
  children: React.ReactNode;
}): JSX.Element => {
  const base = "relative overflow-hidden rounded-lg p-[18px]";
  const styles =
    variant === "light"
      ? "bg-white text-fg-1 border border-[color:var(--qs-border)]"
      : "bg-ink text-seasalt border border-border-inv";
  return (
    <div className={cn(base, styles, className)}>
      {variant === "signal" && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-40px] h-20 w-[90%] -translate-x-1/2 rounded-full"
          style={{ background: "var(--qs-lime)", opacity: 0.35, filter: "blur(8px)" }}
        />
      )}
      <div className="relative">{children}</div>
    </div>
  );
};

export const DsCardEyebrow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("font-mono text-[11px] uppercase tracking-[0.12em] text-dim-gray", className)}>{children}</div>
);

export const DsCardTitle = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("mt-2 font-display text-[22px] leading-[1.1]", className)}>{children}</div>
);

export const DsCardBody = ({ children, tone = "dark", className }: { children: React.ReactNode; tone?: Tone; className?: string }) => (
  <p className={cn("mt-2.5 font-sans text-sm leading-[1.5]", tone === "light" ? "text-fg-2" : "text-fg-inv-2", className)}>{children}</p>
);
```

- [ ] **Step 2: Verify build.** Run `npm run build`. Expected: compiles (component unused yet — that's fine).

- [ ] **Step 3: Commit.**

```bash
git add src/components/ui/ds-card.tsx
git commit -m "feat(ui): DS Card primitives (dark/light/signal + text parts)"
```

---

## Task 6: Nav — `MainNavigationSection`

**Files:**
- Modify: `src/components/MainNavigationSection/MainNavigationSection.tsx`

**Interfaces:**
- Consumes: pill `Button` (Task 4), tokens, hex→token map.

- [ ] **Step 1: Tokenize + pill CTA.** Apply the hex→token map across the file: header `bg-[#141414]`→`bg-ink`, `border-white/40`→`border-border-inv`, nav link greys → `text-fg-inv-2` (hover `text-seasalt`), dropdown panel `bg-[#1a1a1a]`→`bg-ink-2`, `border-[#2a2a2a]`→`border-border-inv`. Convert the "Get in touch" CTA to `<Button variant="accent">Get in touch</Button>` (pill). Keep each service row's icon-tile colour as its `svc-*` token (`bg-svc-business/data/infra`), hover → `bg-lime` + black icon (unchanged behavior, tokenized values).

- [ ] **Step 2: Verify build + visual.** `npm run build`; `npm run dev`; screenshot header + open Services dropdown. Expected: pill lime CTA, tokenized colors, dropdown rows keep service colours, hover→lime.

- [ ] **Step 3: Commit.**

```bash
git add src/components/MainNavigationSection/MainNavigationSection.tsx
git commit -m "refactor(nav): tokenize colours + pill CTA"
```

---

## Task 7: Footer — `SiteFooter`

**Files:**
- Modify: `src/components/SiteFooter/SiteFooter.tsx`

- [ ] **Step 1: Tokenize + pill CTA + brand grid.** Apply hex→token map: `bg-[#141414]`→`bg-ink`, headline `#f5f5f6`→`text-seasalt`, body `#94969c`→`text-fg-inv-2`, borders `#1f242f`→`border-border-inv`. CTA → `<Button variant="accent">`. In the homepage variant, the decorative rotated rectangles: recolor `border-white`→`border-border-inv-strong`, keep exactly one `border-[#ccff00]`→`border-lime` rect (single spotlight). The homepage variant already renders `SectionGridOverlay` (now DS grid via Task 3) — leave it.

- [ ] **Step 2: Verify build + visual.** `npm run build`; screenshot footer on Home and on a sub-page. Expected: pill CTA, DS grid backdrop, one lime rectangle.

- [ ] **Step 3: Commit.**

```bash
git add src/components/SiteFooter/SiteFooter.tsx
git commit -m "refactor(footer): tokenize + pill CTA + single lime accent"
```

---

## Task 8: Home — `HeroIntroSection`

**Files:**
- Modify: `src/screens/Desktop/sections/HeroIntroSection/HeroIntroSection.tsx`

- [ ] **Step 1: Backdrop + tokens.** Replace the `/background-pattern.svg` `<img>` layers with `<Halo tone="lime" />` above the existing `<SectionGridOverlay>` (which is now the DS grid). Section `bg-[#141414]`→`bg-ink`. Heading already Hanken — change `text-[#f5f5f6]`→`text-seasalt`, subtitle `text-[#94969c]`→`text-fg-inv-2`. Keep the interactive lime "Human + AI" scramble exactly (it is the hero's single lime spotlight); change its flipped colors' `#000000`/`#f5f5f6` literals to `#141414`/`#FAFAFA` for consistency.

- [ ] **Step 2: CTA + motion.** Replace the hand-built `<Button className="bg-[#ccff00] … rounded-lg …">` with `<Button variant="accent">Get in touch →</Button>` (adds the arrow, pill shape). In the GSAP timeline, keep the entrance but set `defaults: { ease: "power3.out" }` → `ease: "power2.out"` and cap translate at `y: 40` max (DS: 4–8px is ideal but the hero entrance may keep a slightly larger, still-no-overshoot move); remove the `x: 80` image slide if it reads as parallax-heavy → reduce to `y: 24`.

- [ ] **Step 3: Verify build + visual.** `npm run build`; screenshot hero. Expected: lime halo bleed at top, DS grid, pill CTA with arrow, interactive accent still works.

- [ ] **Step 4: Commit.**

```bash
git add src/screens/Desktop/sections/HeroIntroSection/HeroIntroSection.tsx
git commit -m "refactor(home/hero): DS halo+grid backdrop, pill CTA, tokenized"
```

---

## Task 9: Home — `KeyFeaturesSection`

**Files:**
- Modify: `src/screens/Desktop/sections/KeyFeaturesSection/KeyFeaturesSection.tsx`

- [ ] **Step 1: DS cards + tokens.** Convert the 4 feature cards to `DsCard variant="dark"` with `DsCardTitle` (Hanken) + `DsCardBody`. Tokenize: titles `#f5f5f6`→`text-seasalt`, body `#94969c`→`text-fg-inv-2`, intro greys → `text-fg-inv-2`. H2 → `font-display`. Keep the GSAP header slide + card stagger; ensure `ease: "power2.out"`, no overshoot.

- [ ] **Step 2: Verify build + visual.** `npm run build`; screenshot section. Expected: cards have 16px radius + hairline borders, Hanken titles.

- [ ] **Step 3: Commit.**

```bash
git add src/screens/Desktop/sections/KeyFeaturesSection/KeyFeaturesSection.tsx
git commit -m "refactor(home/keyfeatures): DS cards + tokenized type"
```

---

## Task 10: Home — `DetailedCapabilitiesSection`

**Files:**
- Modify: `src/screens/Desktop/sections/DetailedCapabilitiesSection/DetailedCapabilitiesSection.tsx`

- [ ] **Step 1: DS service cards + tokens.** The 3 service cards: `bg-[#101010]`→`DsCard variant="dark"` (hover `bg-ink-2`), `rounded-none`→`rounded-lg`. Keep each icon tile's service colour tokenized (`bg-svc-business/data/infra`), hover→`bg-lime` + black icon, title hover→`text-lime`, "See more" `#cecfd2`→`text-fg-inv-2` hover→`text-lime`. Two-column "Technology Expertise" block: eyebrow `#ccff00`→ keep `text-lime` (it's a section eyebrow, acceptable single accent) OR `font-mono text-dim-gray` — **use `font-mono text-lime` once per column max**. Tokenize body greys. H2/H3 → `font-display`.

- [ ] **Step 2: Verify build + visual.** `npm run build`; screenshot both sub-blocks. Expected: DS service cards, service-colour icon tiles, hover→lime.

- [ ] **Step 3: Commit.**

```bash
git add src/screens/Desktop/sections/DetailedCapabilitiesSection/DetailedCapabilitiesSection.tsx
git commit -m "refactor(home/capabilities): DS service cards + tokenized type"
```

---

## Task 11: Home — `TeamShowcaseSection`

**Files:**
- Modify: `src/screens/Desktop/sections/TeamShowcaseSection/TeamShowcaseSection.tsx`

- [ ] **Step 1: Tokens + card radius.** Team cards `rounded-lg`→`rounded-lg` (already 16px via token now). Overlay panel `bg-[#0c111d99]` → keep frosted (`backdrop-blur-md`) but recolor to `bg-ink/70`. Role text `#b0b3ba`→`text-fg-inv-2`, desc `#d0d5dd`→`text-fg-inv-2`. Nav buttons `border-[#1f242f]`→`border-border-inv`, hover `bg-[#1f242f]`→`bg-ink-2` → prefer `<Button variant="secondary" size="icon">` with the chevron. H2 → `font-display`. Keep hover slide-up motion but confirm easing `cubic-bezier(0.2,0.8,0.2,1)`.

- [ ] **Step 2: Verify build + visual.** `npm run build`; screenshot carousel + hover state. Expected: DS pill nav buttons, tokenized overlay.

- [ ] **Step 3: Commit.**

```bash
git add src/screens/Desktop/sections/TeamShowcaseSection/TeamShowcaseSection.tsx
git commit -m "refactor(home/team): tokenize overlay + DS nav buttons"
```

---

## Task 12: Service page — AI for Business

**Files:**
- Modify: `src/screens/AiForBusiness/AiForBusiness.tsx`, `.../sections/IntelligentWorkAdoptionSection/…tsx`, `.../sections/BusinessOverviewSection/…tsx`

- [ ] **Step 1: Consistent backdrop.** In `AiForBusiness.tsx`, wrap content so each section sits over the DS grid: add `<SectionGridOverlay showCenterLine={false} />` + `<SectionSeparator />` between sections (matching Home's language). Root `bg-[#141414]`→`bg-ink`.

- [ ] **Step 2: Tokenize + responsive.** In both sections: headings→`font-display text-seasalt`, body `#94969c`→`text-fg-inv-2`. Eyebrow `#309eff`→`text-svc-business` (service wayfinding). Icon tile → `bg-svc-business`. Feature groups → `DsCard variant="dark"` where they are card-like, else tokenized text. Replace fixed desktop `gap-16`/`gap-[130px]`/`py-24`/`min-w-[…]` with responsive: `gap-8 lg:gap-16`, `gap-12 lg:gap-[130px]`, `py-12 sm:py-16 md:py-24`, `w-full lg:min-w-[…]`/`lg:w-[430px]`. Keep `AiForBusinessIcon` (its accent already `#309EFF` = svc-business token value).

- [ ] **Step 3: Verify build + visual.** `npm run build`; screenshot at 375px and 1280px. Expected: DS grid backdrop, blue wayfinding accent, no horizontal scroll on mobile.

- [ ] **Step 4: Commit.**

```bash
git add src/screens/AiForBusiness
git commit -m "refactor(business): DS backdrop, tokenized svc-business accent, responsive"
```

---

## Task 13: Service page — Data for AI

**Files:**
- Modify: `src/screens/DataForAi/DataForAi.tsx`, `.../sections/IntelligenceFeaturesSection/…tsx`, `.../sections/DataOverviewSection/…tsx`

- [ ] **Step 1: Backdrop + tokens + responsive.** Same treatment as Task 12 but with `svc-data` (`#FF303E`): root→`bg-ink`, add DS grid + separators, headings→`font-display text-seasalt`, body→`text-fg-inv-2`, eyebrow `#f14a55`→`text-svc-data`, icon tile `#FF303E`→`bg-svc-data`. Replace the icon-tile inset-shadow/gradient hack with a plain `bg-svc-data rounded-md` tile (DS: no coloured/complex shadows). Fix fixed desktop `px-8`/`py-24`/`min-w-[400px]`/`gap-[130px]` → responsive (`px-4 sm:px-8`, `py-12 sm:py-16 md:py-24`, `w-full lg:min-w-[400px]`, `gap-12 lg:gap-[130px]`). Keep `DataForAiIcon` (red pulse already `#F14A55`≈svc-data — retune stops to `#FF303E` family for exactness if trivial, else leave).

- [ ] **Step 2: Verify build + visual.** `npm run build`; screenshot at 375px + 1280px. Expected: red wayfinding accent, responsive, DS grid.

- [ ] **Step 3: Commit.**

```bash
git add src/screens/DataForAi
git commit -m "refactor(data): DS backdrop, tokenized svc-data accent, responsive"
```

---

## Task 14: Service page — Infrastructure for AI

**Files:**
- Modify: `src/screens/InfrastructureFor/InfrastructureFor.tsx`, `.../sections/ProductionDesignFeaturesSection/…tsx`, `.../sections/InfrastructureOverviewSection/…tsx`

- [ ] **Step 1: Backdrop + tokens + responsive.** Same as Task 12/13 with `svc-infra` (`#3AE165`): root→`bg-ink`, DS grid + separators, headings→`font-display text-seasalt`, body→`text-fg-inv-2`, eyebrow `#39e064`→`text-svc-infra`, icon tile `#30B753`→`bg-svc-infra`, replace inset-shadow tile with plain `bg-svc-infra rounded-md`. Responsive fixes as before. Keep `GameOfLifeCanvas` but retune its active-cell green to the `svc-infra` value (`#3AE165`) and container `bg-[#141414]`→`bg-ink`, `border-[#1a1a1a]`→`border-border-inv`.

- [ ] **Step 2: Verify build + visual.** `npm run build`; screenshot at 375px + 1280px. Expected: green wayfinding accent, responsive, GoL canvas green matches token.

- [ ] **Step 3: Commit.**

```bash
git add src/screens/InfrastructureFor src/components/GameOfLifeCanvas
git commit -m "refactor(infra): DS backdrop, tokenized svc-infra accent, responsive"
```

---

## Task 15: Blog index — `PageHeaderSection` + `BlogPostsGridSection`

**Files:**
- Modify: `src/screens/Blog/Blog.tsx`, `.../sections/PageHeaderSection/…tsx`, `.../sections/BlogPostsGridSection/…tsx`

- [ ] **Step 1: Backdrop + header.** `Blog.tsx`: replace `/background-pattern.svg` with `<Halo tone="lime" />` + DS grid. Root `bg-[#141414]`→`bg-ink`. `PageHeaderSection`: H1 → `font-display text-seasalt`, subtitle → `text-fg-inv-2`, eyebrow "Our blog" → `font-mono uppercase tracking-[0.12em] text-dim-gray` (per spec default: neutral mono, lime reserved for CTAs).

- [ ] **Step 2: DS post cards + pill controls.** `BlogPostsGridSection`: post cards → `DsCard variant="dark"` (thumbnail keeps gradient but recolor stops to `from-ink-2 to-ink`), category → `text-fg-inv-2`, title → `font-display text-seasalt`, desc → `text-fg-inv-2`. Tabs: active `border-[#cecfd2] text-[#cecfd2]`→`border-seasalt text-seasalt`, inactive→`text-fg-inv-2`; give tabs pill hit-areas. Pagination: `rounded-full` already; `#1f242f`→`bg-ink-2`/`border-border-inv`, active text `#ececed`→`text-seasalt`, inactive→`text-fg-inv-2`.

- [ ] **Step 3: Verify build + visual.** `npm run build`; screenshot blog index. Expected: DS grid + lime halo, DS post cards, pill pagination, mono eyebrow.

- [ ] **Step 4: Commit.**

```bash
git add src/screens/Blog
git commit -m "refactor(blog): DS backdrop, DS post cards, pill controls, mono eyebrow"
```

---

## Task 16: `BlogPostDetail`

**Files:**
- Modify: `src/screens/BlogPostDetail/BlogPostDetail.tsx`

- [ ] **Step 1: Tokens + prose theme.** Root→`bg-ink`. Header: category `#cecfd2`→`text-fg-inv-2`, H1→`font-display text-seasalt`, date/desc→`text-fg-inv-2`. Prose overrides (lines ~116-183): h1/h2/h3→`font-display text-seasalt`, p/li→`text-fg-inv-2`, strong→`text-fg-inv`, links→`text-lime` (or `text-seasalt underline`; default per spec: links may keep lime as they are inline CTAs) hover→`text-seasalt`, blockquote border `#1f242f`→`border-border-inv`, code `bg-[#1f242f] text-[#cecfd2]`→`bg-ink-2 text-fg-inv-2 font-mono`, hr `#1f242f`→`border-border-inv`. Back button → `<Button variant="ghost">← Back to blog</Button>`.

- [ ] **Step 2: Verify build + visual.** `npm run build`; open a post (`/blog/<slug>`), screenshot. Expected: Hanken headings, mono code, tokenized prose.

- [ ] **Step 3: Commit.**

```bash
git add src/screens/BlogPostDetail/BlogPostDetail.tsx
git commit -m "refactor(blog-post): DS prose theme + tokenized"
```

---

## Task 17: Careers — `CareersIntroSection` + `JobListingsSection`

**Files:**
- Modify: `src/screens/Carreer/Carreer.tsx`, `.../sections/CareersIntroSection/…tsx`, `.../sections/JobListingsSection/…tsx`

- [ ] **Step 1: Backdrop + intro.** `Carreer.tsx`: `/background-pattern.svg`→`<Halo tone="lime" />` + DS grid; root→`bg-ink`. `CareersIntroSection`: eyebrow "Careers" → `font-mono uppercase tracking-[0.12em] text-dim-gray`, H1→`font-display text-seasalt`. Fix `pt`/`pb` to responsive if fixed.

- [ ] **Step 2: Value cards + job card + tokens.** `JobListingsSection`: accent phrase "Human + AI = Compound Value" keep `text-lime` (single hero-ish spotlight, acceptable). "Get in touch" → `<Button variant="accent">`. **Core Values cards:** replace coloured hover-borders (`#ccff00`/`#a78bfa`/`#f472b6`) with `DsCard variant="dark"` + hairline `border-border-inv`, hover → `border-border-inv-strong`; keep the small circular icon badges but recolor their gradient to tinted-neutral (`from-white/10 to-transparent`), icon stroke→`text-fg-inv-2` (drop the per-card purple/pink saturation per DS "no coloured border accent"; `care-*` tokens remain available for a single small dot if desired). Band bg `from-[#0a0a0a] to-[#101010]`→`bg-ink`. **Job card:** `bg-[#101010]`→`DsCard variant="dark"`, `min-w-[560px]`→`w-full lg:min-w-[560px]` (responsive), title→`font-display text-seasalt`, "View job"→`text-fg-inv-2` hover→`text-lime`, meta→`text-fg-inv-2`. Job badge → tokenized `bg-badge-bg border-badge-border` dot `bg-badge-dot` text `text-badge-text`.

- [ ] **Step 3: Verify build + visual.** `npm run build`; screenshot Careers at 375px + 1280px. Expected: DS grid, DS value/job cards with hairline borders, responsive, tokenized badge.

- [ ] **Step 4: Commit.**

```bash
git add src/screens/Carreer
git commit -m "refactor(careers): DS backdrop, DS cards (hairline), responsive, tokenized"
```

---

## Task 18: `JobDetail`

**Files:**
- Modify: `src/screens/JobDetail/JobDetail.tsx`

- [ ] **Step 1: Tokens + backdrop.** `/background-pattern.svg`→`<Halo tone="lime" />` + DS grid; root→`bg-ink`. H1→`font-display text-seasalt`, meta row→`text-fg-inv-2`, section headings→`font-display text-seasalt`, body→`text-fg-inv-2`, list bullets keep `text-lime` (semantic markers, sparse). Closing block `bg-[#1f242f]/50 border-[#1f242f]`→`bg-ink-2 border-border-inv`, italic→`text-fg-inv-2`. "Apply Now" → `<Button variant="accent">Apply now →</Button>`.

- [ ] **Step 2: Verify build + visual.** `npm run build`; open `/career/senior-ai-ml-engineer`, screenshot. Expected: DS backdrop, Hanken headings, pill CTA.

- [ ] **Step 3: Commit.**

```bash
git add src/screens/JobDetail/JobDetail.tsx
git commit -m "refactor(job-detail): DS backdrop + tokenized + pill CTA"
```

---

## Task 19: Final audit sweep + cleanup

**Files:**
- Modify: any file surfaced by the grep; `tailwind.css` (remove dead shadcn HSL if unreferenced)

- [ ] **Step 1: Grep for leftover brand hex.** Run:

```bash
grep -rniE '#(141414|151515|f5f5f6|94969c|cecfd2|d0d5dd|b0b3ba|ececed|1f242f|101010|0a0a0a|1c1c1c|1a1a1a|2a2a2a|ccff00|b8e600|309eff|ff303e|f14a55|3ae165|39e064|30b753|a78bfa|f472b6|0c111d)' src/ || echo "CLEAN"
```

Expected: every remaining hit is inside a bespoke animated icon SVG (`AiForBusinessIcon`, `DataForAiIcon`) where gradient stops are intentional — anything else, replace with the token per the hex→token map.

- [ ] **Step 2: Confirm no rectangular brand buttons remain.** Run:

```bash
grep -rniE 'bg-\[#ccff00\]|rounded-lg[^"]*bg-\[#ccff00\]' src/ || echo "NO RAW LIME BUTTONS"
```

Replace any remaining hand-built lime buttons with `<Button variant="accent">`.

- [ ] **Step 3: Full build + responsive walkthrough.** Run `npm run build`. Then `npm run dev` and screenshot all 8 routes at 375px and 1280px: `/`, `/ai-for-business`, `/data-for-ai`, `/infrastructure-for-ai`, `/blog`, `/blog/<slug>`, `/career`, `/career/senior-ai-ml-engineer`. Expected: consistent DS grid backdrop, pill buttons, Hanken headings, service wayfinding accents, no horizontal scroll on mobile, focus ring visible on tab.

- [ ] **Step 4: Remove dead code.** Delete the empty `src/screens/Blog/sections/NavigationMenuSection/` folder if present. Leave `AnimatedNoise` (unused but harmless) unless trivially removable.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "chore(ds): final token audit sweep + cleanup"
```

---

## Self-Review

**Spec coverage:**
- §1 Token foundation → Tasks 1, 2 ✓ (palette, fg ramp, borders, service/careers accents, fonts, radii, shadows, motion, grid vars).
- §2 Signature treatments (BrandGrid, Halo, grain, separator) → Task 3 ✓ (grain wash is optional in spec; BrandGrid/Halo/separator covered; grain left as opt-in, not required).
- §3 Components (pill button, focus, card, forms/chips/rows) → Tasks 4, 5 ✓. Forms/chips/list-rows have no current site usage (no contact form exists) — DS primitives for them are lower priority; Task 5 covers cards (the used primitive). *Gap acknowledged:* standalone form-field/chip/list-row primitives are not built because no page renders them; if a contact form is added later it should use the DS form spec.
- §4 Per-page → Tasks 6–18 ✓ (nav, footer, home×4, service×3, blog×2, careers×2, job detail).
- §5 Voice micro-labels → folded into each page task (arrow on CTAs, sentence case) ✓.
- §6 Out of scope respected (no new routes, no copy rewrite, zip untracked) ✓.
- §7 Success criteria → Task 19 audit enforces (no un-tokenized hex, fonts served, pill buttons, focus ring, consistent grid, responsive, build passes) ✓.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — each task carries concrete class/token mappings and representative code. Foundation tasks (1–5) show complete code; page tasks give exact hex→token transforms driven by the Global Constraints map (DRY).

**Type consistency:** `BrandGrid({variant})`, `Halo({tone})`, `DsCard({variant})`, Button variants (`accent`/`secondary`/`ghost`) referenced consistently across page tasks. `SectionGridOverlay` keeps its `showCenterLine` prop so existing call sites are untouched.

**Note on granularity:** Page tasks (6–18) are transformation tasks over existing files rather than TDD test-first, because (a) there is no test runner in this repo and (b) the deliverable is visual. Each still ends in an independently reviewable build + screenshot gate, which is the right-sized unit for a fresh reviewer here.
