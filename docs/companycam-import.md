# CompanyCam document and photo import

Run the administrative importer from `web/` with Node 22 or later:

```sh
node --experimental-strip-types scripts/sync-companycam.mjs --documents-only
node --experimental-strip-types scripts/sync-companycam.mjs --apply --documents-only
node --experimental-strip-types scripts/sync-companycam.mjs --apply --photos-only
```

The default is a dry run. `--report /absolute/path.json` selects a private local
report; `--max-items N` limits a pilot and `--concurrency N` bounds photo requests
(default 8, maximum 12). A rerun skips existing source identities. This is a
manual one-way import, not a scheduled or two-way sync.

The `import-companycam-documents` Edge Function reads CompanyCam's current
Pages, Photos and Projects API using the existing server-only
`COMPANYCAM_API_KEY`. Its gateway requires JWT verification and the handler
validates administrative credentials against Supabase Auth. It only returns
data for CompanyCam company `1383272`. Deploy this function to ServiceFlow's
`bwbckdkouqghdadpkjvn` project; it does not write documents itself.

The importer uses `SUPABASE_SERVICE_ROLE_KEY` from the environment, or retrieves
it through an already authenticated Supabase CLI. Cloudflare access comes from
`CLOUDFLARE_API_TOKEN` or the existing Wrangler login. Keys stay in memory and are
never written to reports, the browser or the repository.

Destination company is Ottawa Painters within ServiceFlow. Prefer explicit
job/lead CompanyCam links. For missing job links, require a unique match on
customer identity, street address and postal code. Ambiguous and unmatched
projects remain unassigned and are recorded in the report. No jobs, customer
addresses or accounting records are created or changed by this importer.

One Pagers replace untouched blank Job Start Template copies in place. Keep
one job-start page per project, use the latest source page, and skip older
source versions. Filled local documents require review before replacement.
Other documents retain their source titles. No CompanyCam suffix is displayed.
`project_documents.source_provider/source_id` preserve identity through edits
and template replacement so rerunning cannot recreate duplicate copies.

Structured CompanyCam content is converted and sanitized using the existing
ServiceFlow document sanitizer. Unknown content nodes fail visibly. Embedded
images are copied to the private Supabase `project-documents` bucket and use
the existing authenticated document-image routes. Project photos are copied
at original resolution into the existing private R2
`ottawa-painters-project-media` bucket in account
`db8c567871fd5f7697613b1313acdfbd`, then registered in `job_media` with their
CompanyCam source IDs and creator metadata. Existing photos are not overwritten.
Private, inactive and unprocessed source photos are skipped. No public bucket
access is enabled, and CompanyCam originals remain unchanged.

Verification:

```sh
node --experimental-strip-types --test scripts/companycam-import.test.mjs
deno check ../supabase/functions/import-companycam-documents/index.ts
```
