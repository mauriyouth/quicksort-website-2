# @quicksort/design-system

React component library for the Quicksort brand, extracted from the identity
system in `apps/web/quicksort-design-system` (the standalone
`quicksort-design-system-standalone.html` is a bundled *export* of that
source — this package is built from the source, not the bundle).

## What's inside

| Layer | File | Contents |
| --- | --- | --- |
| Tokens | `src/tokens.css` | Primitive palette (Rich Black / Dim Gray / Timberwolf / Seasalt / Signal Lime), semantic light/dark tokens (`data-theme`), type, spacing, radii, elevation, motion, brand grid + halo utilities |
| Components | `src/components.css` | `.qs-*` product primitives: button, card, panel, pill, stat, notice, empty, field/input, list row |
| React | `src/index.ts` | `ThemeToggle`, `Logo`/`LogoMark`, `Button`, `Card`, `Panel`, `Pill`, `Stat`, `Notice`, `Empty`, `Input`, `Textarea`, `Field`, `ListRow` |
| Theme | `src/theme.ts` | `getTheme`, `setTheme`, `restoreTheme` (persisted under `localStorage["qs-theme"]`) |
| Assets | `assets/` | Logo SVGs + grain texture from the identity file |

## Usage

```tsx
// once in the app entry
import "@quicksort/design-system/styles.css";

import { ThemeToggle, Button, Card, Pill, restoreTheme } from "@quicksort/design-system";

// early, to avoid a flash of the wrong mode (or use an inline <head> script)
restoreTheme("dark");
```

- **Light is the default mode.** Opt into dark with `data-theme="dark"` on
  `<html>`, `<body>`, or any subtree; `data-theme="auto"` follows the OS.
- `ThemeToggle` flips the mode (root by default, or `target="local"` for a
  subtree) and persists the choice.
- Never introduce a second accent colour. One lime element per composition.
- Text on lime is always Rich Black (`--qs-accent-fg`).

## Portal integration

`@quicksort/hr-ui` and `@quicksort/ui` both alias their legacy variable
names (`--qs-bg`, `--qs-ink`, `--qs-deep`, …) onto these tokens, so the
admin/HR portals and the web app share one token source and flip with the
same `data-theme` attribute. The portals default to dark via a boot script
in their `index.html`.
