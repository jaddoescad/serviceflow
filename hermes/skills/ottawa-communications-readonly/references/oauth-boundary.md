# Gmail authorization boundary

The intended permission is Google OAuth scope `https://www.googleapis.com/auth/gmail.readonly` with offline access.

- Store the refresh token encrypted in the Hermes secret store, never in the repository or skill files.
- Keep the OAuth consent app in production/internal mode as appropriate. A testing-mode external app can issue short-lived refresh tokens.
- Restrict the exposed tool surface to search/get/list operations even though the OAuth scope already prevents writes.
- Authentication can normally persist through refresh-token renewal without repeated prompts, but it is not literally permanent: Google/user revocation, prolonged inactivity, password/security events, client changes, or token limits can require reauthorization.
- Never request `gmail.modify`, `gmail.compose`, or `mail.google.com` for this assistant.

