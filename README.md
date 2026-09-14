# ServiceFlow

One private repository for the ServiceFlow admin website and mobile app.

| Component | Directory | Release |
| --- | --- | --- |
| Admin website | Repository root (`src/`) | Push `main`; existing Vercel project deploys https://serviceflow-admin.vercel.app |
| Mobile app | `apps/mobile` | Expo EAS channels `preview`, `pilot`, `production` |

## Development

Admin: run `npm ci`, then `npm run dev` at the root. `npm run build` validates production.

Mobile: `cd apps/mobile`, `npm ci`, then `npm start`. Run all Expo and EAS commands there. The two apps retain independent lockfiles and dependencies; this repository intentionally does not hoist native dependencies into the admin.

Both use the existing ServiceFlow backend. Ottawa Painters remains in its own repository and database. Combining the code does not merge their data or releases.

## Deployment

Vercel keeps its existing project, domain, environment, root directory (`.`), and `npm run build` command. GitHub source is `jaddoescad/serviceflow`, branch `main`. No new Vercel project is needed.

Mobile retains the ServiceFlow display name, Expo project ID, runtime version, update channels, iOS bundle identifier, and Android application ID. Package metadata is now named `serviceflow`. Keeping the platform identifiers preserves updates for existing installed apps and store listings.

From `apps/mobile`, use `eas update --branch <preview|pilot|production> --message "description"` for JavaScript releases, or the existing EAS build/submit profiles for native releases. See `apps/mobile/AGENTS.md` for mandatory release verification.

Ignored mobile credentials and environment files belong inside `apps/mobile`, not the repository root. Obtain these securely for new checkouts; never commit signing credentials or production secrets.

## Migration provenance

The mobile history through `9beb24a` was imported with a full-history subtree merge. Admin history remains intact. The old mobile checkout/repository is a recovery reference, not the active development source. Do all future mobile and admin work here.

Historical admin documentation is retained in `docs/admin-legacy-readme.md`; descriptions of removed accounting modules there are historical, not current features.
