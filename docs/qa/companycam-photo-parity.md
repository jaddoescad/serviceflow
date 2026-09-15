# CompanyCam photo workflow investigation — 2026-09-14

Status: in progress; not an acceptance report.

## Reference fixture

CompanyCam project `114513868`: **ServiceFlow Photo QA — TEST ONLY — 2026-09-14**.
URL: https://app.companycam.com/projects/114513868/photos
Created through the UI with no customer or address. Use only this fixture for writes.

## Observed reference behavior

- Create project accepts a project name without customer/address, defaults creator as project user.
- Empty Photos tab has Upload Photos and Assign Users; separate project sidebar.
- Add Photos modal contains a drag/drop or click target. File selection immediately starts uploading without a second confirmation step.
- Accepts PNG/JPEG/HEIC and multiple video extensions; multiple file input.
- Upload in progress says `Uploading 1 photos…`.
- Narrow 629px viewport sidebar overlaps photo controls until collapsed. Do not replicate this layout defect.
- Browser filechooser bridge timed out. Native foreground Chrome chooser succeeded; no permission blocker established.
- First submitted fixture: repository ServiceFlow icon PNG (harmless branding asset). Await completion, then test detail view/actions and further uploads.

## ServiceFlow code findings

- project-media-upload.tsx uploads serially; first failed request aborts the batch. Retrying resends successful earlier files. No request idempotency header currently sent, no per-file status, timeout, cancellation, or retry policy.
- Entire selected batch rejected if any selected file is invalid.
- Reads full media records in getProjectMediaData; inspect pagination and ordering before changes.
- Media proxy performs session + database lookup + worker request for every original. No transformed thumbnail path yet in proxy. No fetch timeout/catch for upstream network failure.
- Gallery tracks active image array index instead of stable media ID; audit refresh/reordering behavior.

## Required investigation and acceptance

Reference tests: successful single and batch upload, invalid file, retry/duplicate behavior, grid/date/order/filter controls, lightbox navigation and zoom, captions/comments/tags, download, selection/bulk actions, deletion/recovery, refresh persistence, video handling, narrow/wide viewport.

ServiceFlow: derive final behavior from reference evidence, generate imagegen reference before UI edits, implement reliable per-file queue and backend idempotency, private efficient media delivery, persistence and editing actions, accessible responsive gallery; test actual fixture end-to-end plus failures, authorization, concurrency/retries, and large galleries. Preserve mobile compatibility and OP read-only media access.

No production code changes made for this objective yet. Pre-existing untracked migration `supabase/migrations/20260914234011_remove_project_notes.sql` is unrelated and must not be included.

## Verified follow-up observations

- Native foreground Chrome upload succeeded. Image `3565742698` uploaded, processed, and appeared as Photos (1), grouped under Monday September 14 with time + creator. Test description: `QA only: upload and description persistence check.`
- Upload modal transitions from uploading to a processing message, stays open, and permits more files; closing returns to the updated grid.
- Grid adds View, Date Range, Users, User Groups, Tags, select control, per-image checkbox/menu once populated.
- Clicking a photo opens route `/projects/114513868/photos/3565742698/photo` in an overlay (deep-linkable). Viewer has edit/annotation, fullscreen, zoom in/out, download, Move to Trash, creator/date, location availability, tags, tasks, description, comments.
- Description uses inline rich text with Saved feedback and formatting controls; test text persisted when exiting edit mode and opening/closing annotation editor.
- Annotation editor visually includes selection, free draw, polygon, color/width, arrow, circle, rectangle, text, rotation/crop, adjustments, undo/redo. No annotation saved yet.
- Trash test PASSED: moved QA photo to trash, disappeared from active grid and count subsequently changed to 0. Confirmation explains 90-day recovery for manager/admin. Project Menu > View Project Trash shows dated group, checkboxes and preview-size slider; selecting image exposes Move Back to Project. Restore succeeded and trash reports no photos.
- No real customer project was edited. No comments/messages posted. QA project retained for further batch/video/filter/annotation tests.

## Baseline and design

- Existing worker test suite: 31 passed, 0 failed. It covers current upload/auth/range/multipart/video-thumbnail/permanent-delete/OP read-only behavior, but NOT retry idempotency, soft deletion, image thumbnail variants, or concurrent uploads. Do not use this baseline as evidence that the requested reliability work is complete.
- Live `job_media` has no deleted_at, description/tags columns, or client-request identity. source_metadata JSON holds imported description/creator data. Policies allow select through visible job/lead; insert requires uploaded_by=auth.uid and app source; delete requires uploader ownership. No UPDATE policy presently.
- Imagegen reference saved at `docs/design/project-photo-workflow-reference.png`. Use its PHOTO grid, viewer, and queue layout as guidance. Do not add the generated image's unrelated navigation, scheduling, accounting values, or fictional product features.
- Live database inspected read-only only; no migration applied for this goal.

## Implementation checkpoint — upload reliability (not deployed)

- Worker accepts optional x-upload-id UUID, replays a matching committed row, rejects reused IDs with changed uploader/project/type/size/name, and uses separate R2 keys per attempt to protect winning objects during concurrent requests.
- Worker resolves ambiguous insert responses before cleanup. Unknown 5xx commit state retains the attempt object rather than risking a broken committed photo. NEED retained-attempt reconciliation/sweeper (including orphan review) before claiming complete lifecycle reliability.
- Browser upload UI rebuilt around per-file queue with two active requests, XHR byte progress, 180s timeout, automatic start, cancel/retry using stable IDs, per-file validation, duplicate selection suppression, closeable modal + upload status launcher, navigation/unload warning. UTF-8 filenames use explicit URI-encoding header decoded by worker.
- Worker tests: 36 passed (5 new retries/concurrent-conflict/ambiguous-commit tests). Queue tests: 4 passed. Production Next build passed before final small attempt-token/filename adjustments; incremental tsc started afterward (session 24132 at checkpoint).
- All code remains local. Worker MUST be deployed before web because the new browser confirms server row ID matches request ID.
- Still required: full QA UI test of cancellation/auth failure and retry timing; durable queue across navigation/reload and lost commit reconciliation; gallery/server pagination+thumbnail+metadata/actions+trash functionality; remaining CompanyCam batch/video/filter/annotation tests; fixture integration, mobile/OP compatibility checks, deployment and acceptance audit.
- Unrelated concurrent edits remove project notes in project-photos, profile-panel, project-slots, project-profile action and project-data; preserve them, exclude from this task's commit unless separately authorized. Unrelated project-profile.test.mjs and remove_project_notes migration also exist.

## Database and recovery checkpoint — September 14 follow-up

- Found live `job_media_object_key_matches_metadata` requires canonical media ID filenames. Prior mocked upload tests did NOT exercise this database constraint. Worker attempt keys now preserve logical media ID as `{mediaId}~{attemptId}.ext`.
- Applied compatible storage-key constraint migration to destination first, then ServiceFlow. Existing canonical keys still pass; project ID, logical media ID and MIME extension remain enforced. No existing file paths were changed.
- Applied ServiceFlow-only `edit_photo_details` private definer/public invoker RPC. Active managers only; no direct UPDATE grant. Row lock and client revision protect against stale saves, exact retries are idempotent, existing import metadata is retained. Description/tags use existing synced source_metadata.
- Database tests in `supabase/tests/photo_details.sql` ran against ServiceFlow inside ROLLBACK, both before and after applying migrations. Covered successful edit, metadata preservation, retry, stale revision, revision reuse, wrong project, oversized content, wrong storage project/media/MIME, legacy keys, missing identity/unregistered user, and grants. No fixture records persisted. Still need actual authenticated-role/API tests and concurrent transaction tests.
- Local viewer now tracks active photo by UUID, adds description/tags editor and warns before abandoning unsaved details. Fixed Tab handling in text fields. Not yet browser-verified. No video viewer parity yet.
- Added IndexedDB upload persistence scoped by signed-in user and project. Bytes and original identity are saved before sending; interrupted uploads resume when the project page is reopened. Failed/cancelled remain paused. Completed files are removed from the local recovery store. Quota/storage failures block starting newly selected files and show a message. Transfers still stop when this component unmounts; moving queue ownership to a persistent app-level manager remains outstanding for background uploads across navigation.
- Added pinned dev-only fake-indexeddb 6.2.5 and five persistence tests (all pass), plus existing four queue tests pass. Worker36 tests pass after key correction. These are unit tests, not browser quota/multitab/logout/reload acceptance.
- UI/worker still not deployed. Database changes above ARE applied. Production Next build session6769 completed successfully after recovery changes, including type checking. Focused unit total is 45 passing (36 worker, 4 queue, 5 persistence).
- Still pending: durable queue race/StrictMode/multitab/browser acceptance, metadata editor browser acceptance, trash/restore, pagination/thumbnails, selection/filter/download/annotation/comment parity, remaining reference tests, full live deployment and verification. Goal remains active.

## Recoverable trash and gallery checkpoint

- Draft migration `20260915000926_recoverable_photo_trash.sql` is NOT applied. Restrictive authenticated SELECT policy hides metadata-flagged trash (including old mobile clients), manager-only RPC exposes trash for recovery, revision-checked mutation preserves original rows/keys and sync metadata. Active uploaders may trash their own files; only managers restore. Permanent DELETE grant retirement intentionally deferred until compatible worker deploy. Destination read filtering must be added before enabling production trash, because its sync copy still has the old visibility policy.
- `supabase/tests/photo_trash.sql` PASSED inside a rolled-back ServiceFlow transaction using actual `SET LOCAL ROLE authenticated`: hides trashed row, exposes manager trash preview, restore visibility, exact retry, stale trash after restore, wrong project, no direct UPDATE, non-manager preview denial and non-owner deletion denial. No rows or schema changes persisted.
- Local worker DELETE now calls trash RPC and NEVER removes R2 objects. Manager-only `/v1/media/:id/trash` preview uses trash RPC. Worker suite38 passed. Existing deployed worker still physically deletes; coordinated rollout remains required.
- Local UI adds Trash modal, manager restore, per-photo trash action with stable retry ID, dirty-edit confirmation. Media proxy binds trash request to exact project through manager RPC, forwards to private worker trash route, adds network timeout and catch, and uses private revalidation. Not browser-tested/deployed.
- Reference fixture foreground Chrome tab580656631 (native `chromePhotoQA`) verified View menu: show tags; all/photos/videos; small/medium/large; newest/oldest. Videos-only correctly showed filtered-empty message for one-image fixture; restored All afterward. Selection checkbox opens bottom actions; Actions includes download, tag/remove tags, duplicate, print, cover, hide/unhide timeline, move, trash. Those menu options observed, not executed. Selected fixture image remains selected with Actions menu open.
- Native Chrome click works for these controls; background browser radio clicks did not change state. Use native `Escape` (not ESC). `qa` is browser tab580656631, `chromePhotoQA` is native Chrome binding.
- Implemented local View options, user/tag/date filters, filtered empty state, tag chips and stable timestamp/UUID sorting. Still client-side over loaded dataset; server pagination/filtering and thumbnail performance are unfinished. Selection/bulk actions not implemented yet.
- Typecheck after gallery controls passed. Production build session60023 was typecheck; build session returned separately after checkpoint, inspect result. No commit/deployment from this checkpoint.

## First live rollout — 2026-09-15 00:27 UTC

- Commit `51679ba` pushed to `jaddoescad/serviceflow/main`. Vercel production deployment `CevvcbQeL66RsJyKxa2YBJaPDEvX` confirmed **Ready**, 37s build, canonical `serviceflow-admin.vercel.app`. Built both the working tree and an isolated checkout of the actual index (unrelated project-notes removals excluded); both passed.
- Worker deployed with pinned Wrangler4.123.0: version `2241feb3-c2d1-4c35-9309-988e89a3753b`; `/health` returned `{ok:true}`.
- Applied paged-project-gallery RPC/indexes, source trash RPC/policy, destination restrictive trash visibility, then worker, then source direct DELETE revocation, then web. Authenticated client hard-delete is now false; anon trash/gallery RPC execution false. The trash migration is no longer merely a local draft.
- Paging loads 48 rows with timestamp/UUID cursors, project-wide type/date/creator/tag filters, options and counts. Preserves last valid rows on failure; ignores stale filter responses; deduplicates appended IDs; active photo snapshot remains open through list refresh. Thumbnail delivery and query-plan timing still need verification.
- `supabase/tests/project_gallery_page.sql` passed in rollback with 123 temporary rows: 3 pages, no missing/duplicate IDs including timestamp ties and null captured dates, reverse ordering, image filter, Toronto date boundaries, wrong-project and malformed-cursor checks. All fixture rows/outbox entries rolled back. SQL never returns object keys or full source metadata.
- Security advisor reports no findings on the new photo functions. Existing sync RPC definer warnings and password-protection warning remain outside this change; private sync tables' no-policy INFO findings remain deliberate deny-by-default. Stored tool result available as `photoAdvisors` in functions store during this session.
- Created permanent dedicated live QA fixture (no contact details): lead/project `5cce599f-9d30-49b9-b064-89dccaa17c25`, name `ServiceFlow Photo QA — TEST ONLY`, metadata.qa_fixture `serviceflow_photo_qa_20260914`, marketing_eligible=false, exclusion_reason=test. Only sync/channel-normalization triggers exist for fixture creation. No real project edited.
- Canonical QA URL loads new Trash/upload UI successfully. Browser tab580656632 (`sfPhotoQA`) is logged in and has upload modal open. Native foreground Chrome also opened a second QA tab (ID not inventoried). CUA `chromePhotoQA` currently stuck on native Go To sheet; typed/Return/Escape behaved unexpectedly (path reset to `/`). Browser chooser `setFiles` failed with timeout; docs require extension **Allow access to file URLs**, exact user-facing guidance sent. Do not claim a ServiceFlow upload succeeded: no QA media uploaded yet. CompanyCam existing one-photo fixture remains intact.
- Still outstanding: real upload/edit/trash/restore/browser/reload/multitab/permissions tests; thumbnails; bulk actions/downloads; video viewer/deep links/zoom/annotation/comments; retained ambiguous-object reconciliation; background upload ownership across navigation; broader CompanyCam reference tests. Goal remains active and incomplete.

## Live API verification and preview rollout — 00:38 UTC

- Worker version `7c856d05-8220-456f-84bd-de7866cdea85` deployed with private IMAGES binding. Image previews are 640x480 WebP, stored as `.preview-v1.webp`, with authorization before cache lookup. Original files are preserved. Transformer rejects inputs above20MB; client will fall back to original when a preview is unavailable. Video frame behavior retained; cached derivatives still require authorization. Unit suite40 passed.
- Added manual `scripts/photo-workflow-live-test.mjs`. It verifies the exact QA fixture, creates a temporary confirmed test identity/manager workforce record with no emails sent, exercises only fixture media, and disables/bans the test identity in finally. No secrets printed/stored in reports. Test actors `25dc4a15-afaa-44cc-8cc3-3a2970a244a6` and `a99c29c0-c529-4a6a-94c9-5368815e7fea` are both disabled; source workforce records kept for media provenance.
- First run timed out at stale-edit API request after seven successful checks. Original photo retained. Changed application conflicts from database serialization code40001 (HTTP500 mapping) to PostgREST PT409 in forward migration `20260915003735_photo_conflict_http_status.sql`; applied to source. Do not claim the precise timeout cause was proven. Frontend now recognizes both codes.
- Second live run completed all12 checks: concurrent upload one row; replay same ID; original checksum; anonymous read denial; real WebP transformation; cache byte identity; metadata edit and retry; stale edit409; trash hides original and cached preview; manager trash preview checksum; restore checksum; legacy DELETE route soft deletion. Final restore succeeded; test identity disabled. Test image237491bytes -> preview6844bytes (~97% reduction for this fixture).
- Retained QA photos: `5f0f8d53-7bbf-4db6-adf8-f1ccfac7f60f` (first run) and `52d2de1c-3096-4551-8c72-e908fe8cebd4` (successful run). Both harmless ServiceFlow icon, each restored/active. Private reports under `/Users/jad/.codex/migration-reports/photo-workflow/`.
- Browser tab580656634 (`sfGalleryCheck`) opened live two-photo fixture and its first photo. Description changed through UI to `QA only: saved through the ServiceFlow photo viewer.` and Saved feedback observed. Viewer remained open; focus jumped to Close after save, fixed locally by separating navigation data from focus lifecycle. Narrow629px screenshot inspected; details scroll below photo with thumbnail strip.
- Local follow-up adds thumbnail proxy/component, images/video in same viewer, image zoom/pan/fullscreen and download; live UI is still previous commit until next push. Browser upload via file chooser still unverified; direct live API evidence does not replace it. UI trash/restore, zoom/pan/video/download, queue recovery, bulk actions, comments/annotations/deep links, retained-object reconciliation and full acceptance remain pending.

## Bulk selection checkpoint — 2026-09-15

- Viewer/preview follow-up committed as `ec86de5`; exact staged production build passed. Not pushed yet; live web remains the prior release.
- Browser access rechecked twice: host reports Mac locked and automatic unlock failed. This blocks live CompanyCam/ServiceFlow UI checks, not local implementation.
- Added per-photo selection, selection across loaded pages/filters, an explicitly labeled select-loaded action, and a bottom bulk action panel for add tags, remove tags and recoverable trash. Uses existing authenticated server actions/RPC authorization and optimistic revisions.
- Bulk requests freeze each original revision, description, tags and a fresh request UUID before starting. Retries submit only unfinished items with the same payload/identity. Per-item errors remain visible; conflicting edits are not overwritten. Selection is locked while a partial batch awaits retry or finish.
- Three automated tests passed covering preservation of descriptions/tags/revisions, tag validation/removal, and partial/ambiguous retry behavior. Browser interaction and live bulk mutation checks are pending; this is not a claim of completed parity. Batch progress is currently in memory; navigation/reload recovery still needs implementation.
