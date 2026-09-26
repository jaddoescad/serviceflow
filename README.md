# ServiceFlow

One private repository for the ServiceFlow admin website, mobile app and backend.

| Folder | What | Release |
| --- | --- | --- |
| `web/` | Admin website (Next.js) | Push `main`; Vercel (Root Directory `web`) deploys https://serviceflow-admin.vercel.app |
| `mobile/` | Crew app (Expo / React Native) | Expo EAS channels `preview`, `pilot`, `production` |
| `supabase/` | Shared backend: migrations, edge functions, SQL tests | Supabase project `bwbckdkouqghdadpkjvn` |
| `docs/` | Cross-project plans and ownership notes | — |

## Development

Admin: `cd web`, `npm ci`, then `npm run dev`. `npm run build` validates production. Tests run from `web/` with `node --test scripts/<name>.test.mjs`.

Mobile: `cd mobile`, `npm ci`, then `npm start`. Run all Expo and EAS commands there. The two apps keep independent lockfiles and dependencies.

Both use the ServiceFlow backend. Ottawa Painters' own admin, accounting and business files live in the separate `ottawa-painters-admin` repository and database.

## Deployment

Vercel builds the admin from `web/` with `npm run build`. GitHub source is `jaddoescad/serviceflow`, branch `main`.

Mobile keeps the ServiceFlow display name, Expo project ID, runtime version, update channels, iOS bundle identifier and Android application ID, so existing installs and store listings keep updating. From `mobile/`, use `eas update --branch <preview|pilot|production> --message "description"` for JavaScript releases, or the EAS build/submit profiles for native releases. See `mobile/AGENTS.md` for mandatory release verification.

Ignored credentials and environment files belong next to the app that uses them (`web/.env.local`, `mobile/.env.local`, `mobile/play-service-account.json`). Obtain them securely for new checkouts; never commit signing credentials or production secrets.
