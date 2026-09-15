# project-media-worker

Cloudflare Worker that serves as the only door to the private R2 bucket holding
job photos and videos. The Expo app never talks to R2 directly and there are no
public object URLs.

```
Expo app ──JWT──▶ Worker ──R2 binding──▶ ottawa-painters-project-media (private)
                    │
                    └──same JWT──▶ Supabase Data API (public.job_media, RLS)
```

Authorization is delegated to Supabase RLS: every data route forwards the
caller's Supabase JWT to the Data API with the publishable key. The Worker holds
no R2 credentials (bucket binding only) and no service-role key.

## Routes

| Route | Auth | Behaviour |
| --- | --- | --- |
| `GET /health` | none | Liveness only, no internals. |
| `PUT /v1/jobs/:jobId/media` | Bearer JWT | Validates UUID/content type/`x-media-type` and a known body size (`Content-Length` or browser `x-file-size`; 25 MB images, 95 MB videos), confirms the caller can SELECT the job, writes `jobs/{jobId}/{mediaId}.{ext}` to R2, inserts `public.job_media` with the same JWT, resolves uncertain database commits before cleanup, returns the created row (201). Optional `x-upload-id` makes retries idempotent and uses `{mediaId}~{attemptId}.{ext}` keys to isolate concurrent requests. |
| `PUT /v1/leads/:leadId/media` | Bearer JWT | Same authenticated upload flow for an unconverted lead, using `leads/{leadId}/{mediaId}.{ext}` and `job_media.lead_id`. |
| `GET`/`HEAD /v1/media/:mediaId` | Bearer JWT | Looks up `job_media` by id with the caller's JWT (RLS), streams the R2 object with `Content-Type`, `ETag`, `Cache-Control: private`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Content-Length`, and `Range` support (206/416) for video scrubbing. HEAD returns headers only. |
| `DELETE /v1/media/:mediaId` | Bearer JWT | Moves the photo to recoverable trash through the restricted database RPC (204). Keeps the metadata row and R2 bytes; managers can restore it. |
| `OPTIONS *` | none | CORS preflight for `Authorization`, `Content-Type`, `Range`, and the `x-*` metadata headers. `Allow-Origin: *`, never credentials. |

Accepted upload types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
`image/heif`, `video/mp4`, `video/quicktime`. Object keys are always derived
server-side (UUID + extension from the MIME allowlist); client filenames are
sanitized and stored as display metadata only.

## Setup

1. Use Node 22 or newer, then run `npm install`.
2. Create the private bucket once: `npx wrangler r2 bucket create ottawa-painters-project-media`
   (leave public access / r2.dev disabled).
3. Apply the app repo migration `supabase/migrations/*_create_job_media.sql` to
   the Supabase project.
4. Configure the two Worker variables once, then deploy. The publishable key is
   deliberately used instead of a service-role key; authorization still comes
   from each user's JWT and RLS. `keep_vars` preserves these values on later
   deploys:

   ```sh
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
   npx wrangler deploy
   ```

5. Point the app at the Worker: set `EXPO_PUBLIC_PROJECT_MEDIA_API_URL` to the
   deployed Worker URL.

## Develop & test

- `npm test` — unit tests (Node's built-in runner; Supabase and R2 are mocked,
  no deployed infrastructure needed).
- Copy `.dev.vars.example` to `.dev.vars`, fill in the local values, then run
  `npm run dev`. Never commit `.dev.vars`.

## Photo workflow rollout

Deploy the upload-key constraint to the read-only copy first, then ServiceFlow.
Deploy ServiceFlow photo editing, gallery paging and recoverable trash migrations
before this worker. After this worker is live, apply
`finalize_photo_trash_permissions` to revoke direct client DELETE access.
Then push the admin changes to main for the GitHub/Vercel deployment.

`GET/HEAD /v1/media/:id/trash` serves retained originals only through the
manager-only trash RPC. No automatic purge is configured. Uncertain upload
attempts may retain unreferenced objects; reconciliation is still pending.
