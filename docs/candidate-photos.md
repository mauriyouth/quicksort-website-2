# Candidate portrait gallery deployment

The candidate portal shares 13 cropped portraits with every signed-in user. Downloads are JPEG crops at native source resolution, with 480 x 720 previews. The /api/team-photo endpoint verifies each Clerk session through the existing Supabase sync_clerk_profile identity bridge; private JPEG files are not served as static assets.

The HD images must never be committed: the GitHub repository is public. Keep apps/admin/private/team-photos outside Git. It contains <id>-preview.jpg and <id>-hd.jpg for each entry in apps/admin/src/portal/teamPhotos.json. The approved local deployment checkout contains these files. The originals remain in the user's Quicksort photo folder.

Deploy from this complete local source checkout using Vercel CLI, after pulling/syncing and pushing code. The root .vercelignore deliberately includes the private server files in the Vercel function bundle while Git excludes them. Never put these files in public/ or enable unreviewed Git-only deploys without restoring the private inputs. Website Git deployments remain unchanged.

The gallery ships inside the merged admin app: the same deployment serves the candidate portal to non-staff sign-ins and the back-office to admins. Target: the `quicksort-admin` Vercel project (root `apps/admin`), production admin.quicksort.fr; retire the old standalone candidate/HR project. The function needs existing VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables on the server. No service role key is needed.

Before deploying: pnpm --filter @quicksort/admin build and node --test tests/team-photos.test.mjs. The download tests require the private deployment inputs and check all 26 JPEG files, valid-session sharing, unauthenticated denial, attachment headers, and file size limits.

The baseline is the dark Clerk/Google candidate portal recovered from quicksort-website-2. Candidate-specific copies of its db/ui packages preserve this baseline without changing the older admin or marketing packages. Keep Google sign-in, ClerkProvider, domain restrictions and portal-theme.css intact.
