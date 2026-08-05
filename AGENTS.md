# Project agent notes

## Branch policy

- Work on the current branch by default.
- Do not create a Git branch unless the user explicitly asks for one.

## Quo API access

- This workspace can access the Quo (formerly OpenPhone) API.
- Use the server-side `QUO_API_KEY` from `.env` for authentication.
- Never expose the key in browser code, logs, documentation, commits, or user-facing output.
