# Project agent notes

## Branch policy

- Work on the current branch by default.
- Do not create a Git branch unless the user explicitly asks for one.

## Quo API access

- This workspace can access the Quo (formerly OpenPhone) API.
- Use the server-side `QUO_API_KEY` from `.env` for authentication.
- Never expose the key in browser code, logs, documentation, commits, or user-facing output.

## Historical job accounting lock

- Treat June 1, 2026 as the accounting cutoff. Do not create, update, reverse, or delete job-linked receipts, invoice allocations, direct transaction allocations, or budgets for a job whose verified `started_on` date is before `2026-06-01`.
- Also treat completed or archived jobs with no start/completion date as historical and locked. Do not change an old job's dates or status to bypass the lock.
- New evidence for a locked job may be archived as an unassigned invoice or receipt, but it must not be attached to the locked job or change its historical totals.
- If evidence is ambiguous between a locked job and a current job, leave it unassigned for review.
- Only reopen a specific historical job when the user explicitly names that job and explicitly asks to unlock or correct its accounting. Use a narrow forward repair; never disable the global cutoff.
