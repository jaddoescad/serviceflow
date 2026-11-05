# ServiceFlow

One private repository for the ServiceFlow admin website, crew apps and backend.

| Folder | What | Release |
| --- | --- | --- |
| `web/` | Admin website (Next.js) | Push `main`; Vercel (Root Directory `web`) deploys https://serviceflow-admin.vercel.app |
| `ios/` | Native iOS crew app (SwiftUI) | App Store; see `ios/README.md` |
| `android/` | Native Android crew app (Kotlin / Compose) | Google Play; see `android/README.md` |
| `supabase/` | Shared backend: migrations, edge functions, SQL tests | Supabase project `bwbckdkouqghdadpkjvn` |
| `cloudflare/` | Photo and video Worker in front of the private R2 bucket | `wrangler deploy`; see `cloudflare/project-media-worker/README.md` |
| `docs/` | Cross-project plans and ownership notes | — |

## Development

Admin: `cd web`, `npm ci`, then `npm run dev`. `npm run build` validates production. Tests run from `web/` with `node --test scripts/<name>.test.mjs`.

Crew apps: see `ios/README.md` and `android/README.md`.

All of them use the ServiceFlow backend. Ottawa Painters' own admin, accounting and business files live in the separate `ottawa-painters-admin` repository and database.

## Deployment

Vercel builds the admin from `web/` with `npm run build`. GitHub source is `jaddoescad/serviceflow`, branch `main`.

The crew apps keep the iOS bundle identifier and Android application ID (`com.ottawapainters.app`), so existing installs and store listings keep updating. See `android/README.md` for mandatory release verification.

Ignored credentials and environment files belong next to the app that uses them (`web/.env.local`, `android/local.properties`, `ios/Config/Signing.xcconfig`). Obtain them securely for new checkouts; never commit signing credentials or production secrets.
