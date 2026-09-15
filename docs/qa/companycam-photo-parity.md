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

## Persistent upload ownership checkpoint — 2026-09-15

- Bulk photo actions committed `e36fb7d`, still not pushed. Browser recheck again reports locked Mac; no claim of live UI acceptance.
- Moved upload-session ownership from project pages into the root layout. Navigation now leaves mounted sessions/transfers intact; the global upload indicator opens individual project queues. Each modal identifies its destination project. Auth changes remove previous-user sessions and abort their requests.
- Added account-prefixed IndexedDB scope discovery using an index key cursor (does not read file bytes while discovering projects). Saved queues recover when the same account returns, including from a different page. Failed/cancelled files remain paused; interrupted uploads reuse IDs.
- Added a shared two-transfer semaphore across project sessions. Tests verify global capacity, FIFO admission, idempotent release, recovery scope isolation and cleanup. Queue/storage/semaphore suite: 11 passed. Production build passed before the final modal-title prop addition; final `tsc --noEmit` check passed after the modal-title addition.
- Still pending: live navigation/upload/cancel/logout/reload checks, multi-tab coordination and transient automatic retries; bulk progress persistence; remaining CompanyCam parity and acceptance described above. None of these new UI changes are published yet.

## Temporary upload failures and verification gate — 2026-09-15

- Persistent layout queues committed `1bbff52`, still not pushed. Added up to three automatic retries for network errors, timeouts, HTTP408/429/5xx, with 1/3/8-second backoff and bounded Retry-After support when the response exposes it. Request UUID and bytes never change. Permission/validation/conflict/cancellation/local-storage failures do not automatically retry.
- Attempt counts and delayed-retry timestamps persist in IndexedDB; manual retry explicitly resets the budget. Delayed queues retain Cancel controls and before-unload protection. Test suite includes limits, permanent errors, rate limits, stable IDs and persisted retry state.
- Production build passed; final typecheck passed after the header-read guard. All 15 queue/storage/retry tests passed, including the persistence assertion.
- Browser access has now returned locked-Mac errors on four consecutive goal turns. Local implementation progressed, but new controls remain unverified in an actual browser. Next required gate is interactive CompanyCam and ServiceFlow verification, including upload recovery/navigation/logout, viewer controls, bulk mutations and responsive usability. Do not keep expanding UI blindly or declare parity based on these unit/build results. Unlock the Mac to resume the gate; canonical web still runs `51679ba`. Three later commits plus this retry work remain unpublished. Goal incomplete.

## Browser access resumed and production verification — 2026-09-15 02:00 UTC

- Mac unlocked; browser access works again. Pushed `ec86de5`, `e36fb7d`, `1bbff52`, `945c92a` to origin/main. Linked Vercel deployment (detail breadcrumb E592KCnRp) reports Ready, Production Current, commit945c92a, duration47s and canonical serviceflow-admin.vercel.app. Four follow-up commits are now published.
- Chrome tab580656635 (`sfLive`) loaded current canonical fixture. Both previews have `?preview=1`, naturalWidth640 and complete=true. Selected both fixture photos and added `Browser QA` via bulk UI; UI reported2 updated and both tag lists include it. Existing description on photo52d2... remained unchanged. Zoom button displayed150%; reset worked.
- CompanyCam fake fixture duplicate action created second photo3565891805 from3565742698 without a confirmation. No real project changed. Tab580656631 (`ccVerify`) remains reference fixture.
- Automation chooser.setFiles still timed out, but native foreground picker succeeded. Foreground tab580656633 (`sfForeground`) reloaded current release, selected known harmless apps/mobile/assets/serviceflow-icon.png via Go to Folder and Open. UI showed Uploaded; gallery count2→3. This is an actual end-to-end browser upload (not merely API evidence). Uploaded by Jad Slim, capture timestamp7:31PM from file.lastModified. New photoUUID can be read from fixture DB/DOM later.
- Closed upload panel and navigated to fixture Tasks via client link. Tasks page loaded and global Uploads ·1 project remained. This proves completed queue state survives navigation; an in-flight navigation/reload test is still outstanding.
- Fullscreen needs closer verification: browser DOM checks reported fullscreen=false while foreground native accessibility showed only photo canvas/zoom/fullscreen controls. Do not call this a proven failure or pass yet; background tab/transition behavior may affect observation.
- User switched foreground to a real project5567... in an old tab with old uploader displaying non ISO-8859-1 filename error. Did not modify that project or upload the user's screenshot. Told user to refresh that stale tab and reselect file for new uploader. Avoid taking foreground while user is interacting. Native upload work was only on the QA fixture.
- Further work remains: live bulk trash/restore and remove-tags, in-flight navigation/recovery/cancellation/logout and multi-tab tests, viewer download/video/fullscreen, annotations/comments/deep links and other approved parity gaps. Goal is active and incomplete; do not equate deployment with completion.

## Live bulk recovery and viewer verification — 2026-09-15

- Bulk remove-tags tested in tab580656635: all3 fixture photos updated; Browser QA removed and original Before/QA tags preserved on the two API fixtures.
- Native JavaScript trash confirmation wedged tab580656635 in CDP focus-emulation timeouts. Subsequent read-only database check showed all3 photos active, so no unconfirmed change was assumed. Browser shortcut dialog issue is specific to that tab; tab580656633 remained responsive.
- Fullscreen clarified: tab580656633 AX showed only image canvas/zoom controls. Clicking Toggle fullscreen returned the full viewer/header/details, proving enter/exit behavior. Download click emitted the browser download event for fixture original a37b4ca2-76af-447b-85eb-b56096286743. Earlier readonly DOM fullscreen=false is not reliable evidence of failure in this tooling.
- Replaced native window.confirm for single and bulk trash with in-app confirmations. Build passed. Committed/pushed c2d0650; Vercel Ready, production canonical domain,49s duration.
- Verified canonical single-photo trash a37b...: confirmation → count3→2 → Trash entry → Restore → empty trash and count3. Tested cancelling bulk confirmation preserves count3. Then selected all3 QA photos, confirmed bulk trash → count0 and3 updated; restored each through UI → empty trash and count3. No real-project media altered.
- Test upload ID from prior browser run is a37b4ca2-76af-447b-85eb-b56096286743. All three fixture photos ended restored/active. Shared original descriptions/tags preserved.
- Remaining goal: video/upload lifecycle under navigation/reload/cancel/outages and multiple tabs, annotation/comments/deep-link functionality, broader CompanyCam parity and final requirement-by-requirement acceptance. No completion claim.

## Direct photo links and saved annotation reference — 2026-09-15

- Implemented direct #photo=UUID links and an authenticated, project-bound RLS lookup for photos outside loaded gallery pages. Opening/navigation updates the fragment; refresh restores the selected photo. Invalid/unavailable links show recoverable feedback. External hash changes consult the existing unsaved-edit guard. Original schema/data unchanged.
- Commit51b1e3f pushed; Vercel Ready in43s. Build and final typecheck passed;2 parser/format tests passed.
- Live tab580656633: open browser-uploaded photoa37b... → URL fragment appears → reload → same photo3of3 opens. Close → creator filter Photo Workflow QA excludes Jad photo → navigate to a37b fragment → linked photo opens while filtered gallery has2 items. All-zero missing UUID returns unavailable/access feedback; Dismiss and Clear filters restored normal gallery. Server fallback currently omits employee-name fallback (creator absent on linked-only viewer); align with gallery employee join in follow-up. Linked-only ARIA dialog label currently says image0ofN; correct that too.
- CompanyCam tab580656631: opened duplicate fixture3565891805, Edit Photo, chose Arrow, drew an arrow and clicked the green save check. Editor completed; screenshot of returned viewer confirms a yellow arrow persists over the image. Original fixture3565742698 left untouched. Duplicate did not carry the original description. Toolbar includes Draw, Line, Color, Thickness, Arrow, Circle, Square, Text, Timestamp, Sticker, Rotate, Crop, Edit, Clear All, Undo/Redo. Current viewer shows Tasks, Description, Comments. No comments sent.
- Pending: remaining photo parity, annotation/comments implementation, upload/video lifecycle acceptance and performance checks. Goal incomplete.

## Annotation storage foundation — 2026-09-15

- Added/applied source migration20260915021540_photo_annotations.sql. Drawings are independent version1 JSON documents under source_metadata.annotations; original object keys/bytes remain unchanged. Separate annotation_revision prevents description/tag saves from overwriting drawings. Each successful drawing save appends private.photo_annotation_history with actor, previous revision and document. No public/direct history permissions; RLS enabled.
- Public invoker get/save RPC wrappers; private save is guarded by active-manager identity and exact project/media binding, denies video/trashed records, validates bounded normalized geometry and returns PT409 for stale/reused versions. Exact retry does not append duplicate history. Supported shapes: arrow,line,rectangle,ellipse,draw,text. Text is data, not rendered HTML. Documents limited to200 shapes/262144bytes; paths2000points; coordinates0..1; hex colors; bounded widths/text sizes.
- SQL suite passed before applying inside BEGIN/ROLLBACK, then passed again after application. Covers preservation of original file metadata/description/tags, independent concurrent description save, history count, stale writes/reused revisions, wrong-project access, malformed data, authenticated read through RLS, denied trashed/anonymous/non-manager saves and limited grants. Fixtures/outbox events rolled back.
- Added shared Zod model, geometry helper, server actions.3 model/geometry tests and tsc passed. Security advisor's only annotation finding is INFO for private history RLS with no policies, intentional deny-by-default with direct grants revoked. Existing unrelated findings unchanged.
- Annotation editor and viewing/export integration are NOT implemented yet. Database foundation is ready; no drawing UI or parity-completion claim. Next: visual reference, editor with overlay geometry/undo-redo/text/shapes, safe-save/conflict behavior and browser tests using fixture originals.

### Annotation editor checkpoint — 2026-09-14

- Implemented a lazy-loaded fullscreen drawing editor from the retained imagegen reference: arrows, lines, rectangles, circles, freehand, text, selection/movement, deletion, undo/redo, and clear/discard confirmations.
- Integrated versioned annotation load/save with the photo viewer. Original image bytes remain unchanged; saved SVG overlays share the original's fitted image bounds.
- Save retries retain their request revision; failed saves keep the draft. Gallery keyboard/swipe handlers are isolated from the editor, and unsaved drafts warn before page unload.
- Six model/history/geometry tests passed; Next.js production build and TypeScript passed.
- Browser verification was attempted but the Mac is locked. This editor is not deployed or runtime-verified yet. Test drawing, moving, saving/reopening, conflict handling, modal focus, touch, and original downloads after unlock.
- Gallery thumbnails and downloads still show original images, not rendered annotations. Annotated export and thumbnail representation remain outstanding.

### Linked-photo follow-up while browser access is unavailable

- Mac remains locked on the next continuation; no browser verification or deployment attempted beyond the access check.
- Fixed linked-only viewer accessibility label so a photo outside the current loaded results is identified as a linked photo/video, never item0.
- Direct-photo lookup now falls back to the uploader's employee name when imported creator metadata is absent, matching normal gallery semantics. It retains the same session client and RLS; only full_name is selected, and unavailable employee information remains null.
- Read-only source fixture query confirmed a37b... has no creator_name and resolves uploaded_by to Jad Slim. Authenticated-role employee lookup succeeded inside a rolled-back transaction. TypeScript passed. Actual direct-link browser recheck remains pending.

## Fidelity correction after user rejection — 2026-09-15

- User explicitly rejected generic UI additions and requires closer CompanyCam UI/UX fidelity, not a feature checklist. Previous editor reference is superseded by photo-annotation-editor-reference-v2.png.
- Browser unlocked. Published097c319; Vercel8ukDizaxGtjhdQ5ohoDsUe8x4RhL Ready39s. Canonical QA direct-link viewer loads three photos and Edit photo, uploader Jad Slim. This confirms deployment, not editor acceptance.
- Captured actual CompanyCam QA editor through native Chrome. It uses a48px white icon rail, charcoal full-height canvas, and upper-right circular close control. No header/properties sidebar/footer. Corrected our editor to that structure, removed persistent helper copy and shape-count UI, made colour/thickness contextual, and retained revision-safe save/undo.
- CompanyCam editor reference still includes additional capabilities (timestamp, stickers, rotate/crop/adjustment) not implemented. Gallery/viewer fidelity and complete functionality remain outstanding. Do not declare CompanyCam parity.

- Correction14ec14d deployed through GitHub; VercelG6EgHgqX3keRGfFxZJzAPv5CBD3E Ready49s. Canonical QA editor screenshot confirms compact white rail, charcoal canvas, full-height image and circular close; rejected header/sidebar/footer are gone. TypeScript and production build passed.
- Native Chrome foreground changes repeatedly interrupted gesture tests; one attempted gesture encountered gallery/overview navigation rather than a stable editor. No successful drawing/save claim. Browser extension tab access returned Debugger unattached; native control worked for reference/layout inspection. Need stable QA-tab interaction to complete end-to-end drawing/reopen and upload recovery tests.

## Stable browser control and drawing persistence — 2026-09-15

- Created fresh controlled Chrome QA tab580656665 through CUA; extension DOM and semantic controls work on it. Native foreground switching is unnecessary. Do not keep interfering with the user's active tabs.
- Fixture now has4 photos, including a user-added screenshot. That screenshot was not modified. Tested only known disposable icon a37b4ca2-76af-447b-85eb-b56096286743.
- Existing drawing contained1 shape. Added text `QA drawing save test` via Text control and canvas click; Save drawing enabled. Exercised Undo/Redo (text count also included textarea, so that count alone is not an undo assertion). Saved, waited for editor to close, reloaded page, reopened editor:2 shapes and exact text persisted in rendered drawing canvas. Closed editor successfully.
- Accessibility controls work in the dedicated tab after lazy editor load. A contemplated native-dialog change was withdrawn because the suspected missing controls were not reproduced with reliable tab access.
- Still pending: verified undo geometry, discard/conflict paths, arrow drag/move, photo-gallery/viewer fidelity, uploads under failure/navigation/reload, remaining scope in this report. Not complete.
- Arrow gesture verified with dedicated-tab drag: rendered shape count2→3. Undo→2;Redo→3. Close shows discard dialog;Keep editing retains3. Close→Discard→reopen returns persisted2. This verifies both undo/redo and unsaved discard without altering the saved QA drawing. Tab580656665 retained for continuing tests.

## Viewer fidelity pass — 2026-09-15

- Generated/retained photo-viewer-reference-v2.png based on observed CompanyCam modal. Removed full-width metadata header and thumbnail filmstrip, moved uploader/date/name/close to white sidebar, consolidated image tools in a compact icon toolbar, and made description/tags read-only until explicitly edited. Save retry/revision logic and recoverable trash preserved.
- Production build and TypeScript passed. Commitc87d873 pushed through existing GitHub deployment. Live acceptance pending below. Tasks/comments and other unimplemented parity features are not represented by nonfunctional controls.
- Vercel2xY83BpxfxDHwCGju6K29Ljfcu5M Ready46s for c87d873. Canonical QA viewer shows icon toolbar, metadata sidebar (stacked on narrow viewport), read-only description/Add Tags and no filmstrip/header.
- Browser fixture a37b... description changed through inline editor to `QA only: inline description save check.` Save returned read-only display; full refresh retained exact text. Opened tags, typed disposable tag, Cancel restored Add Tags without adding it. Compact trash opened its confirmation; Cancel left photo active.
- Browser viewport override1366x900 did not yield a desktop-sized existing-tab screenshot (still629px-wide). Do not claim desktop visual acceptance. Reset override after test. Dedicated QA tab580656665 retained; no real media modified. Broader gallery fidelity and other remaining acceptance work continue.

## Gallery fidelity pass — 2026-09-15

- Fresh CompanyCam QA gallery screenshot confirmed Small selected, square140px tiles, narrow gaps, date checkbox, compact Date Range/Users/Tags row with View/Upload on right. Generated/retained gallery-reference-v2; implementation uses only observed gallery structure, not invented navigation in mockup.
- Added date-group selection over currently loaded items, compact square sizes140/220/300, small default, uploader initials overlay, hover/focus selection controls, Date Range popover; removed repeated heading/subtitle and select-loaded prose. Existing selection/revision backend retained.
- Fixed upload queue/viewer title to use actual project presentation name, preserving separate deals for one contact.
- Production build/typecheck passed. fc961da pushed; pending live verification. No additional backend mutations.
- fc961da Vercel861E1JDYRzSXq7xjS2DagNmjP8X6 Ready47s. Live QA tab580656675: Monday date checkbox selects3 fixture icons, uncheck clears; Date Range reveals From field; thumbnail a37b opens correct3of4 viewer; ArrowLeft navigates2of4;close returns gallery. No file mutation. Viewport override reset. Gallery QA tab retained.

## Upload lifecycle verification gate — 2026-09-15

- Inspected current queue implementation: transfer semaphore is tab-local. Saved queue recovery has no cross-tab ownership coordination. Worker stable request IDs protect server record identity, but this does not prove cross-tab queue-state consistency; that remains an explicit reliability gap.
- Opened QA upload modal through dedicated tab580656675. Queue empty, choose-files control present. Standard filechooser flow timed out before supplying the harmless icon. DOM confirms the file input exists (1px sr-only input, accessible label Choose photos and videos). Native foreground is a separate real CompanyCam project; did not operate that project's picker or upload files there.
- Browser upload troubleshooting requires Allow access to file URLs for the ChatGPT Chrome extension. User was given the documented instruction. No successful new upload or in-flight lifecycle test is claimed. Need working upload bridge or native picker in the known QA tab, then test navigation/reload/cancel and multi-tab coordination.

## Selection toolbar reference and implementation — 2026-09-15

- Fresh CompanyCam QA tab580656680: date-group button selects both disposable photos. Observed navy selection bar with X, count and Actions menu. Actions contains Download, Tag, Remove Tags, Print, timeline visibility, Move and Move to Trash; separate Documents/Share/Before & After controls. Tag opens a Select Tags dialog with searchable combobox. No writes made to CompanyCam.
- Replaced ServiceFlow's persistent bulk select/input/Apply form with compact navy selection bar, Actions disclosure and native dialogs for supported tag/trash operations. Existing stable revisions and unfinished-only retry logic retained. Other observed actions and searchable tag picker remain pending; no placeholder controls added.
- Built-in imagegen reference saved as docs/design/photo-selection-reference.png. Prompt: restrained ServiceFlow selection toolbar following observed CompanyCam, navy X/count/Actions bar, white menu for Tag/Remove Tags/Move to Trash, small selected thumbnails, no persistent inputs or extra panels. Generated reference is a layout aid; actual CompanyCam remains authoritative.
- TypeScript, production build, diff check and all3 batch tests passed. Browser acceptance of the new controls and deployment remain pending. Upload-storage changes are separate unfinished work and excluded.
- a7a0f03 deployed through existing GitHub integration: Vercel GYDM6te7CBHqUyAWXnKf8QWeCyCR Ready35s, canonical serviceflow-admin.vercel.app. Live Chrome QA tab580656684 shows navy selection toolbar and white Actions menu.
- Selected Monday's3 disposable icons; Tag dialog saved `QA selection menu` to all3, retained existing Before/QA tags, and cleared selection. Remove Tags removed that test tag from all3. Trash Cancel kept all4 photos active. Tag draft Escape discarded the unsaved draft; Clear selection worked. User-added screenshot never selected or modified. No failed-batch injection or desktop-width visual acceptance in this run.
- Separate pending upload-storage race change passes all10 persistence tests, including retirement versus delayed writes in both transaction orders. This has not been deployed and is not full cross-tab ownership coordination.

## Remove unrequested trash interface — 2026-09-15

- User rejected standalone Photo trash panel and requested ongoing removal of UI slop, duplicates and overengineering. Added explicit reference-fidelity and simplicity rules to root AGENTS.md.
- Removed gallery Trash entry and ProjectPhotoTrash component, its loading/empty/recovery panel and unused client restore branch. Shortened single-photo confirmation. Retained underlying files, soft-trash storage and backend recovery capability; no database writes or deletions.
- Commit d817dc8 deployed via GitHub: Vercel36RyakFUgXRWUJAJauiS2qpUE9Ud Ready37s. TypeScript/build passed. Canonical QA tab580656690 confirms no standalone Trash button or Photo trash panel, Photos(4), upload control present, and disposable icon viewer opens.
- CompanyCam QA project menu inspected read-only. No standalone gallery trash interface observed. Continue deriving remaining controls from actual reference interactions; do not recreate an invented recovery panel elsewhere.

## Upload recovery retirement race — 2026-09-15

- Completed the pending IndexedDB fix: completion/clear writes a terminal marker in the same store; later status writes check it within their readwrite transaction. Delayed writes cannot restore retired file bytes to the recovery queue.
- All11 storage tests passed, including both competing transaction orders, fresh IDs/other scopes, retained retry budgets, and direct raw-record verification that only key/retired remain (no File, filename, or metadata). TypeScript passed. The marker is intentionally retained to reject delayed writes; no new service or coordination layer added.
- This fixes recovery resurrection only. Old deployed tabs unaware of markers and simultaneous active uploads are not fully coordinated. Live multi-tab upload acceptance remains outstanding; do not claim complete upload reliability.
