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
