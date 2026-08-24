# Project agent notes

## Branch policy

- Work on the current branch by default.
- Do not create a Git branch unless the user explicitly asks for one.

## Quo API access

- This workspace can access the Quo (formerly OpenPhone) API.
- Use the server-side `QUO_API_KEY` from `.env` for authentication.
- Never expose the key in browser code, logs, documentation, commits, or user-facing output.

## Deployment speed

- For explicit deployment requests, ship and verify the smallest testable version first, then harden it unless the user asks for production hardening before testing.
- Surface external-access blockers immediately. Do not silently expand a quick test deployment into a broader security or architecture project.
- Use the dedicated `Hermes QA` employee, `Hermes Clock-In QA` job, and `hermes-clock-in-qa-fixture` time entry for Hermes clock-in tests. Never test write behavior against a real employee's entry unless the user explicitly names and authorizes that entry.

## Production deployment

- The canonical production URL is `https://ottawa-painters-dashboard.vercel.app`.
- GitHub repository `jaddoescad/ottawa-painters-admin` is the deployment source of truth. Vercel is linked to its `main` branch.
- Deploy by committing only the intended files and pushing `main` to `origin`. The GitHub integration must perform the Vercel production deployment.
- Do not run `vercel deploy`, create preview deployments, promote previews, or create/link another Vercel project unless the user explicitly asks for that exact action.
- Before pushing, inspect the staged diff and exclude unrelated dirty-worktree changes. After pushing, wait for the linked Vercel deployment to become Ready and verify the canonical production URL.

## Historical job accounting lock

- Treat June 1, 2026 as the accounting cutoff. Do not create, update, reverse, or delete job-linked receipts, invoice allocations, direct transaction allocations, or budgets for a job whose verified `started_on` date is before `2026-06-01`.
- Also treat completed or archived jobs with no start/completion date as historical and locked. Do not change an old job's dates or status to bypass the lock.
- New evidence for a locked job may be archived as an unassigned invoice or receipt, but it must not be attached to the locked job or change its historical totals.
- If evidence is ambiguous between a locked job and a current job, leave it unassigned for review.
- Only reopen a specific historical job when the user explicitly names that job and explicitly asks to unlock or correct its accounting. Use a narrow forward repair; never disable the global cutoff.

## DripJobs job authority

- The latest validated DripJobs Jobs List exports are the source of truth for job amounts and production months. Export both active and archived/cancelled views with the table length set to `All`, validate both files, and require proposal IDs to be unique across the combined set. Do not derive job amounts from archived customer-invoice PDFs, invoice lines, invoice allocations, proposal estimates, or customer-invoice table totals.
- Match a CSV row to a job by its DripJobs proposal number. Require exactly one canonical job match; leave missing or ambiguous matches unchanged for review.
- The CSV `Amount` column includes 13% HST. Store and display the job amount before HST as `round(Amount cents / 1.13)`. Preserve the CSV gross amount, implied HST, proposal number, invoice ID, source filename, and source SHA-256 in audit metadata.
- When several CSV rows share a proposal number, never sum them or choose by date alone. Use an existing explicit void/supersession decision only to identify one current row; otherwise leave that proposal unchanged for review.
- Apply changes through a versioned job budget and keep `jobs.contract_amount_cents` synchronized. Preserve the previous budget and record the import in `verification_events`.
- For production month, only `Work Finished`/`Work Complete`, `Review Request`, and `Project Complete`/`Job Completed` qualify. Use the month of `Deal Stage Date`, store the first day of that month on both `jobs.production_month` and associated `job_budgets.production_month`, and preserve stage/date/source provenance. A later qualifying transition may advance the month; automation must never move it backward, clear it after reopening, or use the daily sync date.
- The historical job accounting lock still applies. A broad CSV import does not authorize changing locked historical jobs.
