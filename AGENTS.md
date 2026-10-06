# Project agent notes

## Branch policy

- Work on the current branch by default.
- Do not create a Git branch unless the user explicitly asks for one.

## Deployment speed

- For explicit deployment requests, ship and verify the smallest testable version first, then harden it unless the user asks for production hardening before testing.
- Surface external-access blockers immediately. Do not silently expand a quick test deployment into a broader security or architecture project.
- Use the dedicated `Hermes QA` employee, `Hermes Clock-In QA` job, and `hermes-clock-in-qa-fixture` time entry for Hermes clock-in tests. Never test write behavior against a real employee's entry unless the user explicitly names and authorizes that entry.

## Production deployment

- The canonical production URL is `https://serviceflow-admin.vercel.app`.
- GitHub repository `jaddoescad/serviceflow` is the deployment source of truth. Vercel is linked to its `main` branch and builds the admin from the `web/` Root Directory.
- Deploy by committing only the intended files and pushing `main` to `origin`. The GitHub integration must perform the Vercel production deployment.
- Do not run `vercel deploy`, create preview deployments, promote previews, or create/link another Vercel project unless the user explicitly asks for that exact action.
- Before pushing, inspect the staged diff and exclude unrelated dirty-worktree changes. After pushing, wait for the linked Vercel deployment to become Ready and verify the canonical production URL.

## Historical job accounting lock

- Treat June 1, 2026 as the accounting cutoff. Do not create, update, reverse, or delete job-linked receipts, invoice allocations, direct transaction allocations, or budgets for a job whose verified `started_on` date is before `2026-06-01`.
- Also treat completed or archived jobs with no start/completion date as historical and locked. Do not change an old job's dates or status to bypass the lock.
- New evidence for a locked job may be archived as an unassigned invoice or receipt, but it must not be attached to the locked job or change its historical totals.
- If evidence is ambiguous between a locked job and a current job, leave it unassigned for review.
- Only reopen a specific historical job when the user explicitly names that job and explicitly asks to unlock or correct its accounting. Use a narrow forward repair; never disable the global cutoff.

## Backend ownership

This is ServiceFlow. Operational edits belong here. Sync only the approved operational columns to Ottawa Painters; never import Ottawa Painters accounting or login access. Production Supabase project: `bwbckdkouqghdadpkjvn`.

Ottawa Painters' business files, accounting, DripJobs import rules, Quo access and the Hermes assistant live in the `ottawa-painters-admin` repository. Do not add them back here.

## Repository layout

- `web/` is the ServiceFlow admin website, `ios/` the native iOS crew app, `android/` the native Android crew app, `mobile/` the React Native crew app (still the Google Play build until `android/` ships), `supabase/` the shared backend (migrations, edge functions, SQL tests), and `docs/` cross-project notes. Keep the repository root to these.
- Run admin npm commands from `web/` and mobile npm/Expo/EAS commands from `mobile/`; each keeps its own lockfile and dependencies.
- Follow `mobile/AGENTS.md` for Android release requirements and `ios/README.md` for the native iOS app. Its core logic lives in `ios/ServiceFlowKit`; run `swift run ServiceFlowCoreChecks` there after changing it. The native Android app (`android/README.md`) ports that core to `android/core` with the same names; run `./gradlew :core:test` from `android/` after changing it, and mirror core changes on both platforms.
- Before UI/UX design work, use the imagegen skill for a visual reference.
- Ottawa Painters admin stays in its separate repository.

## UI fidelity and simplicity

- Follow the user's reference product and observed workflows. For CompanyCam parity, inspect the actual screen and interaction before implementing it; generated mockups support that evidence and must not invent features.
- Remove UI slop: unnecessary helper text, repeated headings/counts, duplicate controls, decorative panels, and unrequested dashboards or workflows. Every visible element must serve a demonstrated user need.
- Keep one clear place for each action. Reveal secondary controls when needed instead of exposing every form and action at once.
- Do not overengineer. Reuse existing components and backend paths; add abstractions, dependencies, configuration, or infrastructure only for a concrete requirement or reproduced failure.
- Preserve necessary authorization, data integrity, and retry protections while simplifying presentation. Removing UI does not authorize deleting underlying user data.
- During each change, remove obsolete code within its scope and check for duplicates. Avoid unrelated cleanup or redesign.
- Verify the resulting screen and interaction against the reference in a browser. A successful build or feature checklist does not establish UI/UX fidelity.
