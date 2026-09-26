# Handoff: Careers page sections — Values + Open roles

## Overview

Two sections of the Quicksort careers page, designed against the Quicksort Design System:

1. **Values section** — a three-up editorial block introducing company values. Two directions are supplied (see "Directions" below); pick one before implementing.
2. **Open roles list** — a list of job openings, each row carrying title, department, location, contract type, and two actions.

Both sections support **light and dark mode** through a single token layer. Nothing is hardcoded black or white.

## About the design files

The files in `design/` are **design references created in HTML** — prototypes showing intended look and behaviour, not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, Svelte, native, etc.) using its established patterns, component primitives, and styling approach. If no environment exists yet, choose the framework most appropriate to the project and implement there.

`design/colors_and_type.css` is the exception: it is the real design-system token layer and can be adopted directly, or its values transcribed into the codebase's existing token system. Do not re-derive the colours by eyedropping the prototypes.

## Fidelity

**High fidelity.** Colours, typography, spacing, radii, and motion are final and specified exactly below. Recreate the UI faithfully using the codebase's existing libraries. Copy is placeholder in the Values section (see "Content") and final in Open roles.

## Design tokens

All tokens live in `design/colors_and_type.css` as CSS custom properties on `:root`. Consume via `design/styles.css`, which is the single entry point.

### Core palette (fixed — never flips between modes)

| Token | Value | Role |
| --- | --- | --- |
| `--qs-rich-black` | `#000710` | deepest ink |
| `--qs-ink` | `#141414` | primary dark surface, logo mark fill |
| `--qs-ink-2` | `#151515` | dark page ground |
| `--qs-dim-gray` | `#8E8E8E` | mid neutral, muted labels |
| `--qs-timberwolf` | `#D6D6D6` | quiet divider, pale surface |
| `--qs-seasalt` | `#FAFAFA` | near-white surface |
| `--qs-white` | `#FFFFFF` | |
| `--qs-lime` | `#CCFF00` | **the single brand accent — use sparingly** |

### Mode-dependent semantic tokens

Defined twice. Light is the default; `:root` and `[data-theme="light"]` are identical, so a page needs no attribute to be light.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--qs-bg-0` | `#FFFFFF` | `#151515` | page ground |
| `--qs-bg-1` | `#FAFAFA` | `#1E1E1E` | raised / card |
| `--qs-bg-2` | `#D6D6D6` | `#0C0C0C` | sunken / inset |
| `--qs-fg-1` | `#000710` | `#FAFAFA` | primary text |
| `--qs-fg-2` | `#3A3A3A` | `rgba(250,250,250,.78)` | secondary text |
| `--qs-fg-3` | `#8E8E8E` | `#8E8E8E` | tertiary / muted |
| `--qs-fg-4` | `#727272` | `rgba(250,250,250,.52)` | meta |
| `--qs-border` | `rgba(0,7,14,.08)` | `rgba(250,250,250,.12)` | hairline |
| `--qs-border-strong` | `rgba(0,7,14,.16)` | `rgba(250,250,250,.24)` | interactive outline |
| `--qs-accent` | `#CCFF00` | `#CCFF00` | accent (mode-independent) |
| `--qs-accent-fg` | `#000710` | `#000710` | text on accent |

**Rules that matter:**

- `--qs-accent-fg` is always Rich Black. **Never put Seasalt or white on lime.**
- One accent element per section, maximum. Lime is a signal, not a decoration repeated down the page.
- Shadows are near-invisible on dark ground. Separate surfaces with `--qs-bg-1` and borders, not elevation.
- `--qs-*-inv` tokens (`--qs-fg-inv`, `--qs-bg-dark`, `--qs-border-inv`) are **absolute** — they don't flip. Use them only for a deliberately dark panel inside a light page. Neither of these two sections uses them.

### Type

| Token | Value |
| --- | --- |
| `--qs-font-display` | `'Hanken Grotesk', 'Inter', Arial, sans-serif` |
| `--qs-font-sans` | `'Inter', Arial, sans-serif` |
| `--qs-font-mono` | `'JetBrains Mono', 'SF Mono', ui-monospace, monospace` |

Loaded from Google Fonts (weights 300–700 for the two sans families, 400–600 for mono). Hanken Grotesk carries headlines; Inter carries UI and body; JetBrains Mono carries metadata and numerals.

Note the type scale in `colors_and_type.css` (`--qs-fs-*`) is **slide-native, sized for a 1920×1080 canvas**, so it is not directly applicable to web sections. The web sizes used in these two designs are given per component below.

### Spacing, radii, motion

4px base scale: `--qs-space-1` 4px through `--qs-space-10` 128px (4, 8, 12, 16, 24, 32, 48, 64, 96, 128).

Radii: `--qs-radius-sm` 6px, `--qs-radius-md` 10px, `--qs-radius-lg` 16px, `--qs-radius-xl` 20px, `--qs-radius-pill` 999px.

Motion: `--qs-dur-1` 120ms, `--qs-dur-2` 200ms, `--qs-dur-3` 360ms, `--qs-dur-4` 640ms. Easing `--qs-ease` `cubic-bezier(.2,.8,.2,1)`, `--qs-ease-out` `cubic-bezier(.16,1,.3,1)`.

---

## Screens / views

### 1. Values section

**Purpose:** Introduce company values on the careers or about page. Read-only, no interaction beyond the page's own mode.

**Layout:**

- Outer section: `padding: 30px 26px 26px`, `border-radius: 18px`, `background: var(--qs-bg-0)`, `color: var(--qs-fg-1)`.
- Header block: `max-width: 34ch`, `margin-bottom: 26px`. Left-aligned (**not** centred).
- Cards: CSS grid, `grid-template-columns: repeat(3, minmax(0,1fr))`, `gap: 12px`. The `minmax(0,1fr)` matters — it stops long words forcing overflow.

**Header components:**

| Element | Spec |
| --- | --- |
| Eyebrow | `--qs-font-sans` 500, 11px/1, `letter-spacing: .14em`, uppercase, `color: var(--qs-fg-3)`, `margin-bottom: 12px`. Rendered as `inline-flex` with `gap: 8px` and a **5px lime dot** via `::before` (`border-radius: 999px`, `background: var(--qs-accent)`, `flex-shrink: 0`) |
| Headline | `--qs-font-display` 400, 34px/1.08, `letter-spacing: -.02em`, `color: var(--qs-fg-1)`, `text-wrap: pretty` |

> **Why the dot:** the eyebrow was originally lime *text*, which fails 4.5:1 contrast on a white ground. Neutral text plus a lime dot keeps the accent while staying legible in both modes. Do not revert it to lime text.

**Value card:**

| Element | Spec |
| --- | --- |
| Card | `display: flex; flex-direction: column; gap: 10px`, `padding: 18px`, `border-radius: 14px`, `background: var(--qs-bg-1)`, `border: 1px solid var(--qs-border)` |
| Numeral (direction A) | `--qs-font-mono` 400, 13px/1, `color: var(--qs-fg-4)`, `padding-bottom: 14px`, `border-bottom: 1px solid var(--qs-border)` |
| Icon slot (direction B) | 34×34px, `border-radius: 9px`, `border: 1px dashed var(--qs-border-strong)`, centred label |
| Title | `--qs-font-display` 400, 17px/1.2, `letter-spacing: -.01em`, `color: var(--qs-fg-1)`, `text-wrap: pretty` |
| Body | `--qs-font-sans` 400, 13px/1.5, `color: var(--qs-fg-2)`, `text-wrap: pretty` |

**Accent card variant** (`.v.sig` — direction A, applied to exactly one card):

- `background: var(--qs-accent)`, `border-color: transparent`
- Numeral `rgba(0,7,16,.5)`, its bottom border `rgba(0,7,16,.18)`
- Title `var(--qs-accent-fg)` (`#000710`)
- Body `rgba(0,7,16,.78)`

#### Directions — pick one

- **A · Numeral.** Mono `01` / `02` / `03` over a hairline, with one lime accent card as the section's single signal. No icon dependency. **Recommended** unless an icon set is available.
- **B · Icon slots.** Same structure with a 34px dashed placeholder per card and no accent card.

**The design system ships no icon set** — the Quicksort identity is logo- and type-forward, and the source Figma file contained no icons. Direction B is only viable once an icon library is chosen; until then its slots are placeholders, not artwork.

#### Content (placeholder — replace with real copy)

| # | Title | Body |
| --- | --- | --- |
| 01 | Move with intent | Every decision leaves a trace. We choose direction before speed. |
| 02 | Human in the loop | The system proposes. The person decides, and can always take back control. |
| 03 | Earn the trust | Show the work. Nothing happens that can't be inspected or undone. |

Eyebrow: `Our values`. Headline: `Some of our core values`.

---

### 2. Open roles list

**Purpose:** List current openings. Each row offers two actions: apply externally, or read the full role description.

**Layout:**

- Outer section: `padding: 30px 26px 26px`, `border-radius: 18px`, `background: var(--qs-bg-0)`, `color: var(--qs-fg-1)`.
- Header block: `max-width: 38ch`, `margin-bottom: 28px`. Left-aligned.
- Rows: `display: flex; flex-direction: column; gap: 10px`.
- Each row: CSS grid, `grid-template-columns: minmax(0,1fr) auto`, `align-items: start`, `gap: 16px`. Left column holds title/chip/meta/apply; right column holds the "Know More" link.

**Header components:**

| Element | Spec |
| --- | --- |
| Headline | `--qs-font-display` 400, 32px/1.1, `letter-spacing: -.02em`, `color: var(--qs-fg-1)`, `text-wrap: pretty`, `margin-bottom: 14px` |
| Body | `--qs-font-sans` 400, 14px/1.55, `color: var(--qs-fg-2)`, `text-wrap: pretty` |

**Role row:**

| Element | Spec |
| --- | --- |
| Row | `padding: 20px`, `border-radius: 14px`, `background: var(--qs-bg-1)`, `border: 1px solid var(--qs-border)`. Hover: `border-color: var(--qs-border-strong)`, transition `border-color var(--qs-dur-2) var(--qs-ease)` |
| Title | `--qs-font-display` 400, 19px/1.2, `letter-spacing: -.01em`, `color: var(--qs-fg-1)` |
| Title row | `display: flex; flex-wrap: wrap; align-items: center; gap: 10px` — title and chip sit on one line and wrap together |
| Department chip | `inline-flex`, `align-items: center`, `gap: 7px`, `padding: 4px 11px 4px 9px`, `border-radius: 999px`, `border: 1px solid var(--qs-border)`, `--qs-font-sans` 500 11px/1.4, `letter-spacing: .02em`, `color: var(--qs-fg-2)`, `white-space: nowrap`. `::before` is a **5px lime dot** (`background: var(--qs-accent)`, `flex-shrink: 0`) |
| Meta line | `display: flex; flex-wrap: wrap; align-items: center; gap: 8px`, `--qs-font-mono` 400 12px/1.4, `color: var(--qs-fg-3)`. Separators (`·`, `|`) in `var(--qs-fg-4)` |
| Apply button | `align-self: flex-start`, `inline-flex`, `gap: 9px`, `padding: 9px 15px`, `border-radius: 999px`, `border: 1px solid var(--qs-border-strong)`, `background: transparent`, `--qs-font-sans` 500 13px/1, `color: var(--qs-fg-1)`. Hover: `background: var(--qs-bg-2)`, transition `background var(--qs-dur-2) var(--qs-ease)` |
| Know More link | `inline-flex`, `gap: 8px`, `--qs-font-sans` 500 13px/1, `color: var(--qs-fg-1)`, no underline, `white-space: nowrap`, `padding-top: 4px`. Hover: `color: var(--qs-fg-2)` |
| Arrow glyph | 11×11px inline SVG, `viewBox="0 0 12 12"`, `fill: none`, `stroke: currentColor`, `stroke-width: 1.5`, path `M3 9L9 3M9 3H4.2M9 3v4.8` (a 45° up-right arrow). Used in both actions |

> **Note on the Apply hover:** it is `--qs-bg-2`, not `--qs-bg-1`, because `--qs-bg-1` is the row's own ground — a `bg-1` hover would be invisible.

#### Content (final)

Headline: `We unite world-class talent to push boundaries and build what's next.`

Body: `We believe in building teams where unique perspectives and talents can thrive and everyone has what they need to excel in their role, career, and at home.`

| Title | Department | Location | Contract |
| --- | --- | --- | --- |
| Senior AI & ML Engineer | Engineering | Paris, France | Permanent (CDI) |
| B2B Growth & Digital Marketing Manager | Growth & Business Development | Chennai, India \| Remote / Hybrid | Permanent (CDI) |

Actions per row: `Apply on LinkedIn` (external, opens the LinkedIn posting) and `Know More` (internal, navigates to the full role page).

#### Departures from the original careers-page reference

Three deliberate changes were made to bring the section in line with the design system. Preserve them:

1. **Filled rows, not floating cards.** One grey row per role stays quiet as the list grows; heavier card treatments get noisy past three or four openings.
2. **Pink removed; one lime dot instead.** The reference used a second accent colour (pink) on every icon. The system permits one accent, so the department chip is neutral with a single 5px lime marker.
3. **Icons dropped.** The location pin and clock became mono meta text, since the system ships no icon set.

---

## Interactions & behaviour

**Mode switching.** Both prototypes include a demo Light/Dark segmented control. **This control is a documentation device, not part of the design** — do not ship it inside these sections. In the real product, mode belongs to the page or app shell.

The mechanism to implement:

- Set `data-theme="light"` or `data-theme="dark"` on `<html>`, `<body>`, or any wrapping element. Tokens are inherited, so a dark section inside a light page works with no extra CSS.
- `data-theme="auto"` follows the OS via `prefers-color-scheme`.
- `design/ThemeToggle.jsx.txt` is the design system's real switch component (see `ThemeToggle.d.ts.txt` for its API): uncontrolled by default, writes `data-theme` on `<html>`, persists to `localStorage` under the key `qs-theme`. Props: `theme`, `onChange`, `target` (`'root' | 'local'`), `size` (`'sm' | 'md' | 'lg'`), `showLabel`, `labels`. Helpers `getTheme(el)`, `setTheme(theme, target)`, `restoreTheme(fallback)`.
- **Call `restoreTheme()` as early as possible** (a blocking script in `<head>`, or the framework's equivalent) to avoid a flash of the wrong ground on load.
- Add `transition: background var(--qs-dur-3) var(--qs-ease), color var(--qs-dur-3) var(--qs-ease)` to section grounds so the flip isn't a hard cut.

**Hover states.** Role row border lightens to `--qs-border-strong`; Apply button fills to `--qs-bg-2`; Know More text drops to `--qs-fg-2`. All at `--qs-dur-2` with `--qs-ease`. Value cards have no hover — they aren't interactive.

**Not specified in the prototypes** — decide with the product owner:

- Responsive behaviour. The prototypes are fixed-width design references. Suggested: the values grid collapses to 1 column below roughly 720px; the role row's two grid columns stack, with Know More moving under the Apply button.
- Focus-visible rings. The prototypes only style hover. Use `--qs-border-strong` at `outline-offset: 3px` for consistency with `ThemeToggle`.
- Empty state for the roles list ("no open roles right now").
- Whether role rows are entirely clickable, or only via their two explicit links. The design assumes the latter.

## State management

Minimal. No local state in either section.

- **Mode**: one app-level value (`'light' | 'dark' | 'auto'`), persisted to `localStorage` under `qs-theme`, applied as `data-theme` on the document element. Owned by the app shell, not these sections.
- **Roles data**: the list should come from a data source rather than being hardcoded. Shape per role: `{ id, title, department, location, contractType, linkedInUrl, detailUrl }`. Location is a display string in the design (it contains a `|` for "Chennai, India | Remote / Hybrid"), so either keep it a single string or model `{ city, country, arrangement }` and compose it in the view.
- **Values data**: static content; a constant array is fine.

## Assets

**None required.** Both sections are pure type, colour, and layout.

- The only vector artwork is the 11×11px arrow glyph, inlined as SVG (path given above).
- Fonts come from Google Fonts via the `@import` at the top of `colors_and_type.css`. In production, prefer self-hosting or a `<link rel="preconnect">` + `<link>` pair over a CSS `@import`, which blocks rendering.
- Logo assets exist in the design system (`assets/logo-mark-*.svg`, `assets/logo-wordmark-*.svg`) but are not used by these two sections.
- **Helvetica Neue Medium** appears in the source Figma file for one slide title. There is no license-safe web copy, so Inter Medium is the shipped substitute and Helvetica Neue is named nowhere in the CSS. If pixel-perfect Helvetica Neue is required anywhere, the licensed font file needs to be supplied.

## Files

```
design/
├── values-section.html      — Values section, both directions, with demo mode switch
├── open-roles.html          — Open roles list, with demo mode switch
├── colors_and_type.css      — THE token layer: palette, light/dark scopes, type, spacing, radii, motion
├── styles.css               — single entry point; imports colors_and_type.css
├── _card.css                — preview harness only (page reset + .card wrapper). NOT part of the design; do not port
├── ThemeToggle.jsx.txt      — the design system's real mode switch (React). Drop the .txt to use it
└── ThemeToggle.d.ts.txt     — its typed API. Drop the .txt to use it
```

The two `ThemeToggle` files carry a `.txt` suffix so the design system's own compiler doesn't treat this reference copy as a second component definition. Remove the suffix when porting.

Open either HTML file directly in a browser to see it live. Both default to light mode; the switch in the top-right flips the section to dark.

`_card.css` and the `.card` wrapper, the `.modebar` segmented control, the `A ·` / `B ·` direction labels, and the closing `.mono` explanatory note are all **preview scaffolding**. None of it ships.
