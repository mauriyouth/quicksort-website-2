# Kanban portal access and attribution

Admin rights apply to Kanban only when the verified Clerk session token's `azp`
claim matches an explicitly allowed admin portal origin. The role is still read
from `user_roles`; an admin origin never upgrades a candidate account. Missing
or unknown origins have membership-only access. Request headers and UI flags do
not grant administration.

Allowed origins are the admin custom domain, its two stable Vercel aliases, and
localhost / 127.0.0.1 port 5174. New admin domains require an explicit migration;
arbitrary Vercel preview URLs intentionally do not inherit administration.

In the candidate portal every account, including an admin or the board creator,
requires a grant in `kanban_project_members` or `kanban_board_members`. Project
grants include current and future boards. Direct board grants reveal only that
board and its parent project. Independent board grants survive project-grant
revocation. Admins grant/revoke candidate access through **Manage access**.
Creating a project or board never creates a candidate access grant.

Project and board attribution is stamped from the authenticated workspace profile
by database triggers. Clients cannot supply or edit the creator. The board header
shows its creator independently of the **Card creator** filter. Historical authors
remain unknown unless confirmed; this migration restores the two incident boards
identified by their owner using exact names and creation timestamps.

Run `node --experimental-strip-types --test tests/kanban.test.mjs` for real
Postgres RLS checks covering same-identity portal separation, explicit grants,
revocation, attribution, forged origins/headers, and candidate mutation limits.
