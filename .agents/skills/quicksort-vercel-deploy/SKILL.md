---
name: quicksort-vercel-deploy
description: Deploy or configure Vercel projects for this QuickSort repository. Use for previews, production releases, custom domains, Vercel project linking, or deployment troubleshooting within this repository only.
---

# Quicksort Vercel Deploy

Apply this policy only when the active repository root is this `quicksort-website-2` checkout. Do not apply it to sibling folders or unrelated repositories.

## Required destination

- Every deployment from this repository must use the Vercel account `jermiah.jerome96@gmail.com`.
- Every project must be created or selected inside Mohamed's Vercel team/project context.
- Never deploy from the previously observed `coreteam@conversyai.com` / `coreteam-8812` session or into `ConversyAI's projects` or `test` unless the user explicitly changes this repository policy.
- Do not infer that an unrelated team is Mohamed's team. If the authenticated account does not expose an unambiguous Mohamed destination, stop before linking, creating, deploying, or assigning a domain and ask the user to select the exact team.

## Verification before mutation

1. Confirm the repository root with `git rev-parse --show-toplevel`.
2. Check the installed Vercel CLI and current authentication with `vercel --version` and `vercel whoami`.
3. List teams with `vercel teams list --format json` and verify Mohamed's exact team slug.
4. Inspect the relevant app's `.vercel/project.json` or the repository `.vercel/repo.json`. Treat a link to another account, team, or app as invalid for this deployment.
5. If account identity is uncertain, reauthorize through Vercel and verify the email in the account UI before continuing.

Authentication, team selection, project creation, domain assignment, and deployments are external mutations. Preserve the normal confirmation requirements of the active deployment workflow. This skill does not authorize commits or Git pushes; obtain explicit user approval before either.

## Repository applications

Preserve each application's existing build configuration and use its directory as the Vercel root:

- Public website: `apps/web`
- Admin portal: `apps/admin`
- Candidate portal: `apps/candidate`
- Business intelligence: `apps/intelligence`

The Business Intelligence production domain is `business.quicksort.fr`. Its Vercel project must use `apps/intelligence` as the root directory and the checked-in `vercel.json`.

## Deployment behavior

- Create a separate Vercel project when the requested app is not already linked to the verified Mohamed destination. Never overwrite another app's link.
- Use preview deployments by default. Deploy to production or attach a production domain only when the user explicitly requests it.
- After deploying, verify the deployment status and open the returned URL. For `business.quicksort.fr`, also verify the custom-domain state and report any DNS record Vercel still requires.
- Report the verified account, team slug, Vercel project name, deployment URL, deployment status, and domain status. Do not report a step as complete merely because the command was issued.
