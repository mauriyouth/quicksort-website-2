# Technical SEO implementation - September 2026

## Build and routing

`npm run build` creates the Vite browser bundle, renders the same React application through a StaticRouter at build time, and writes one complete HTML document per route. `src/lib/seo.ts` is the public route/metadata manifest. Blog and job routes derive from their existing data modules. The browser hydrates the HTML and updates metadata on client navigation.

Generated files include robots.txt, sitemap.xml, optional llms.txt and a noindex 404 page. The email-signature utility is preserved, noindexed and excluded from the sitemap. Vercel clean URLs serve the generated files; there is no catch-all SPA rewrite. Apex-host redirects are permanent. Hosting platform domain-level redirects must also be verified because they can take precedence over project config.

## Content and metadata

Public routes have unique titles/descriptions, self-canonicals, Open Graph/Twitter cards and JSON-LD. Organization/WebSite identify Quicksort; services and article pages add suitable markup and breadcrumbs. Publication days, authors, job posting dates, ratings and certifications were not invented. JobPosting rich-result markup needs confirmed publication/expiry details before implementation.

Three service headings now use H1. Blog markdown is available during build rendering. Placeholder pagination was removed; existing category controls now filter actual posts. Decorative alt labels and mobile menu accessibility were improved. Existing uncommitted content/team edits were retained.

## Images and headers

Team portraits use responsive 320/640 WebP variants and lazy decoding/loading below the fold, with image dimensions and preserved originals. The largest portrait decreased from 2,664,842 to 126,886 bytes for its larger variant. Existing missing careers image references were replaced with real team assets. A 1200x630 social image is generated from the checked-in `scripts/social-preview.html` design.

The duplicate stylesheet and invalid Google Fonts import were corrected. Vercel adds nosniff, frame denial, referrer policy and a CSP matched to the current application. Revisit CSP when adding third-party scripts, forms, analytics or remote assets. HTTPS/HSTS are managed by the hosting platform.

## Verification

- `npm run test:seo` checks generated HTML, metadata uniqueness, H1s, JSON-LD, local asset existence, optimized portrait size, discovery endpoints and error statuses.
- `npm run preview:seo` serves the static result locally with production-like statuses/headers for browser review.
- Browser validation covered all nine public routes with JavaScript on and off, article content, React hydration, canonical updates, mobile navigation, blog category filtering and horizontal document overflow. No hydration/CSP errors or failed local asset requests were recorded.
- Local preview tests do not prove Vercel behavior; verify the actual deployment too.

## Remaining business/account dependencies

GSC/GA4 ownership and credentials, field CWV, verified authors/exact publishing dates, case studies, legal/privacy details and a French-language strategy require real business/account inputs. No ranking or CWV pass is claimed from these code changes. Do not substitute the earlier SEO tool's heuristic performance numbers for measurements.

## Restored latest-push baseline — 6 September 2026

Based on GitHub main commit `86d26d3` (client logo quality), retaining the prior light/dark theme implementation and design-system route. The main checkout `quicksort-website-2` is synchronized with the validated `quicksort-latest-restored` checkout. Earlier local edits are preserved in Git stash `ff79131b25c7`.

English remains at `/`, French at `/fr`. Arabic was removed at the user's request. All nine marketing pages exist in both languages (18 sitemap URLs). `/design-system` and `/email-signature` are available in English and noindex. Removed `/ar` pages return 404.

Theme selection is remembered with `qs-theme`. `public/theme-init.js` applies it before paint under the existing CSP. React hydrates with a deterministic initial state, then synchronizes the theme. The navigation offers the theme toggle on desktop and inside the mobile menu. Client logo files are the unchanged high-resolution assets from the latest push.

Translations are maintained in `src/lib/translations.json` and `src/content/blog/fr`. The language menu preserves page, query and fragment. Self-canonicals, reciprocal en/fr/x-default tags and schema language are generated from `src/lib/seo.ts`.

Validation: `npm run build && npm run test:seo`. Checks cover translated metadata, language return links, true 404s, original high-resolution logo bytes, theme bootstrap and the design-system's static noindex document. Browser acceptance covers all 18 marketing pages plus design-system in both light/dark themes, persistence on reload, EN/FR switching and mobile navigation.
