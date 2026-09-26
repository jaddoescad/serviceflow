# Ottawa Painters React Native App

A cross-platform React Native app for Ottawa Painters employee clock-ins, job-site photos and videos, timesheets, and backend-created employee accounts.

## Stack
- React Native
- Expo
- Supabase Auth, tables, and row-level security
- Cloudflare Workers and private R2 object storage

## Project photos and videos

Project media follows one private, authenticated path:

`Expo camera/library -> Cloudflare Worker -> private R2 bucket`

The file bytes stay in the private `ottawa-painters-project-media` R2 bucket.
Supabase `public.job_media` stores metadata and applies the same signed-in job
access model through RLS. The app and Worker pass the user's Supabase bearer
token in request headers; there are no public R2 object URLs and no R2
credentials in the mobile build.

Provisioning and deployment are documented in
`cloudflare/project-media-worker/README.md`. Mobile builds require
`EXPO_PUBLIC_PROJECT_MEDIA_API_URL` to point to the deployed Worker.

The one-time CompanyCam migration copied 6,753 explicitly mapped historical
photos into R2. `npm run import:companycam-media` is a dry-run by default and
can be re-run to audit for any new matched photos; `-- --apply` is required to
copy data, and source IDs prevent duplicates. The maintenance command reads
the ignored `.env.local` file and never runs in the mobile app.

## Local setup
1. Install dependencies
   - `npm install`
2. Start Metro
   - `npm start`
3. Open on:
   - iOS: scan with Expo Go or run `npm run ios` (requires Xcode + simulator)
   - Android: scan with Expo Go or run `npm run android` (requires Android Studio + emulator)

## Office workflow
Employee accounts and project assignments are managed from the backend, not from sign-up inside the app.

Required env values:
- `ASSIGNMENT_ADMIN_TOKEN`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` or `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Commands:
- `npm run office -- list`
- `npm run office -- create-employee --email painter@example.com --name "Painter Name"`
- `npm run office -- assign --email painter@example.com --project "Tyler Duncan"`
- `npm run office -- remove --email painter@example.com --project "Tyler Duncan"`
- `npm run office -- projects --search "Duncan"`

## Important files
- `App.js` app shell, tabs, and shared tracking state
- `src/lib/timeTracking.js` clock-in, active shift, location status, offline queue, and Supabase writes
- `src/lib/projectMedia.js` authenticated media listing, upload, and deletion
- `src/screens` app screens
- `supabase/migrations` database schema changes
- `cloudflare/project-media-worker` authenticated R2 upload and delivery API
- `scripts/office.cjs` backend/office employee and assignment CLI
