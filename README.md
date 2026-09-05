# Quicksort

> We craft Human + AI collaboration.

The Quicksort marketing site — React, Vite, Tailwind, React Router.

## Getting started

Requires [Node.js](https://nodejs.org/en/).

```
npm install
npm run dev     # http://localhost:5173
npm run build
```

## Design system

**Everything about how this site looks lives at [`/design-system`](http://localhost:5173/design-system).**

That page is the single source of truth for colour, typography, spacing,
shape, motion and components. It renders the real components from `src/`, so
it cannot drift from what ships — if a button looks wrong there, it is wrong
on the site.

Two rules follow from that:

- **Never write a raw colour, font size or radius in a component.** Use a
  token: `bg-surface`, `text-ink-muted`, `border-line`, `font-qs-display`.
  If the value you need has no token, add one — do not reach for a hex.
- **Check both themes before shipping.** The site is dark by default with a
  light theme behind a toggle. A component written against tokens supports
  both for free; one written against a hex supports neither.

Tokens are defined in `tailwind.css` and exposed as Tailwind names in
`tailwind.config.js`. The design rationale — why Signal Lime is the only
accent, why it darkens as text, where the category hues are a deliberate
exception — is documented on the page itself and in
`docs/superpowers/specs/`.

The brand source material this system was derived from is in
`quicksort-design-system/`.
