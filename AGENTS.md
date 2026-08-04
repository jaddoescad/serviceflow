# Project agent notes

## Quo API access

- This workspace can access the Quo (formerly OpenPhone) API.
- Use the server-side `QUO_API_KEY` from `.env` for authentication.
- Never expose the key in browser code, logs, documentation, commits, or user-facing output.
