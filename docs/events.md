# Event cards

Admins manage event cards at `/events` in the admin portal. Add a title, date, location, Luma link and square banner; save as a draft or publish. Existing events can be edited or unpublished. Both original Luma events are seeded in the events table.

The public website reads published events from Supabase on page load, when the tab regains focus, and every minute while visible. Publishing does not require redeploying the website. Failed requests show an error; an empty published list shows an empty state, never hardcoded cards that could restore unpublished content.

`event-banners` is a public image bucket restricted to JPEG, PNG and WebP up to 5 MB. Only existing admins can insert banners or write events. Updates compare the previously loaded timestamp and the database stamps changes to detect concurrent edits. The original two banners remain hosted on www.quicksort.fr.

Migration `20260927214521_event_cards.sql` was applied to the existing project `kupbvrnjppcwqxmzxasi`. It creates the table, policies, bucket and seed rows. Do not replay it manually.

Validation: `node --test tests/events.test.mjs` exercises real PostgreSQL permissions and publishing with PGlite. For the isolated admin editor fixture, run `node tests/events-preview/server.mjs` and open http://127.0.0.1:5180. Its writes are in-memory and never touch production. Both web and admin build scripts must pass before release.

The gallery rotates continuously while visible and offers previous/next controls. The operating system's reduced-motion preference displays a static gallery.
