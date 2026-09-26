# ServiceFlow project workspace

## Reference

Inspected CompanyCam in Chrome: Projects, project photos and contact sidebar,
project menu, global Photos and media viewer, and Labels. The generated
`project-workspace-reference.png` supports that reference.

The CompanyCam edit-project route returned an error during inspection. The
ServiceFlow editor therefore retains its existing contact fields in one modal,
using the observed project layout and controls.

## Behavior

- Projects, Photos, Customers and Team are the primary navigation items.
- Resources contains Labels and Project Trash.
- Project creation requires an existing customer contact. The database also
  requires a contact on jobs; leads already required one.
- Every active team member can browse projects and media. Manager-only mutations
  and financial routes retain their authorization checks.
- Project lifecycle is separate from job/accounting status. Archive comes before
  delete; restore returns a trashed project to Archived.
- Trash is recoverable for 90 days. After that the project is unavailable and
  cannot be restored. Underlying business records remain as tombstones so that
  project deletion does not destroy linked accounting or contact history.
- Photos and videos use lazy thumbnails and the same viewer arrangement. Full
  media loads on open. Date ranges use America/Toronto, including the full end day.
- Photo descriptions retain the existing revision/conflict checks.
- Tasks, comments, conversations, documents, checklists, maps, project assignments,
  sharing, showcases, review requests and stars are omitted from this workspace.

## Verification

- `node --test scripts/project-workspace.test.mjs`: lifecycle ordering, retention,
  per-project media isolation, manager/painter/anonymous permissions, required
  contacts and retry-safe project creation.
- Authenticated production database read: 1,516 projects and a 60-item media page.
- Directory query measured at 12.580 ms database execution time on the current
  dataset. This is a database measurement, not browser load time.
- Production build and TypeScript checked during implementation.
- Authenticated browser checks passed for real thumbnails, full-size photo viewing,
  video playback, user/project/date filters, and tile sizes. A September 7–8 range
  returned 14 items; adding Christine Girouard returned one.
- The existing TEST ONLY project passed description save/clear, contact editing,
  archive, trash, restore and unarchive. It was returned to its active state with
  its original contact name and empty description.
- Created and assigned a temporary label, then verified the label filter. This
  exposed a JSONB serialization bug in the directory query, now fixed. The
  temporary label and its project link were removed after verification.
- Media worker tests: 47 pass, including poster authorization, input limits,
  invalid image rejection and serving cached posters without reading originals.

## Large video previews

The existing 51-second video plays correctly, but the live worker reports
`MEDIA_TRANSFORMATION_ERROR 9402` because its original exceeds 100 MB. The worker
now accepts a JPEG poster from the verified original uploader and normalizes it
with the image processor. Mobile camera uploads send their existing captured
poster after saving the video. A poster failure never retries the original upload.

The worker changes were deployed on September 16 (version `f2de84f3-9bea-4cfe-96a2-c2ddca8710a1`). The mobile poster-upload change is not yet published. The existing oversized video still
needs a one-time thumbnail backfill; imported large videos without a captured
poster retain the fallback tile. Browser uploads currently cap videos below the
transformation limit.

## Delivery

Changes are in the active ServiceFlow repository on its existing branch. The two
project-workspace migrations were applied to ServiceFlow Supabase. The web app
has not been committed, pushed or deployed.

## September 15 interaction audit

Observed in the signed-in CompanyCam Chrome session:
- Project Labels is its own searchable, two-column checkbox dialog with removable selected labels and a Create Label footer action. Creating/editing returns to the selection dialog.
- Label editor uses nine named colors (Green, Blue, Purple, Navy, Yellow, Orange, Red, Light Gray, Dark Gray).
- Labels directory has inline name/color edits, sortable Name/Projects/Last Updated columns, project-count links, and row actions.
- Photos exposes hover checkboxes and per-item menus, date-group selection, and a dark selected-count Actions bar. Reference actions include Download, Tag, Remove Tags, Move, and Move to Trash; excluded sharing/documents are intentionally omitted.
- Global feed now reuses the project-gallery tag/remove-tag/trash batch engine, with hover selection, date selection, direct action opening, and a fixed selected-count bar. Selection metadata loads in one bounded query; originals are not downloaded for selection. Bulk Download now streams an authenticated ZIP; single selection downloads the original file. Move between projects remains outstanding. Layout/build success alone is not parity verification.

Implemented label picker/editor/table against these observations. Label assignment uses a separate transactional RPC, locks the project row, rejects trashed projects and non-manager writes, and leaves contact/project fields untouched.


### Download verification and next move dependency
- Browser-selected two files from different projects, downloaded `ServiceFlow-photos.zip`, and verified both entries with `unzip -t` (no errors).
- ZIP stream tests cover exact image/video bytes, filename safety, source failure, and cancellation. Downloads are bounded to 500 files / 3.5 GB; larger selections receive an explicit message.
- Uses server-only `fflate` ZipPassThrough (no recompression of JPEG/video): https://github.com/101arrowz/fflate#usage.
- CompanyCam Move Photos opens a compact dialog with a searchable project combobox (recent 25 project names/addresses) and a Move Photos button.
- Actual `job_media_object_key_matches_metadata` CHECK binds storage key to job/lead ID and media ID. A move must coordinate R2 copy + transactional metadata update and retries. Do not simply reassign job_id/lead_id, weaken this constraint, or leave synced storage paths invalid.

### Move implementation
- Added a CompanyCam-style searchable destination dialog shared by project and global selection actions. Failed moves retain per-file request IDs for safe retry.
- `move_project_media` validates manager access, project lifecycle, current owner and move revision during preparation and again during commit under row locks.
- Worker `POST /v1/media/:id/move` streams the source to a revision-specific destination key and copies the thumbnail before committing metadata. Existing storage-key constraints remain intact. Original bytes are retained for in-flight readers and recovery; orphan reconciliation remains a separate existing maintenance gap.
- Database tests cover metadata preservation, no reassignment before commit, repeated requests, stale ownership, inactive destinations and permission failures. Worker tests cover copied content, thumbnail preservation, failed authorization, missing originals and conflicting commits.
- Picker search/selection verified in the local browser. No production media was moved. Worker endpoint is deployed and its storage-to-gallery runtime verification is recorded below.

### Project gallery and label-menu follow-up
- Project and global photo galleries now share the Date Range, Users, Tags and View toolbar. Project filtering supports multiple users/tags through a new RPC; the original single-filter RPC remains a compatibility wrapper.
- Browser verified a 54-item project: one photographer returned 16 items, both returned 54. Selecting a second tile raised the selection count to two and the date checkbox reported its indeterminate state. Selection is locked during active operations and capped at 500 items.
- Label action menus use native popovers so scrollable tables and picker lists cannot clip them. Browser verified the last-row menu, keyboard focus, Escape returning focus to its trigger without dismissing the surrounding Project Labels dialog, and nested deletion. Temporary QA label was deleted after verification.
- Full CompanyCam parity is still not established. Sidebar search, per-photo menu/viewer consistency, remaining project/customer/team flows, and deployed media-move integration remain open audit items.

### Sidebar search
- CompanyCam sidebar search shows project-name suggestions while keeping navigation visible. Verified against the live Wardah project query.
- Replaced navigation-link filtering with an authenticated, debounced project search (eight suggestions, stale-response protection, keyboard selection, and a full-results link). Browser verified the matching project and ArrowDown/Enter navigation.
- The inline label-color picker now also uses a native popover. Browser verified all nine colors are visible below the final table row and changing to Blue persists; disposable test label removed afterward.

### Shared media viewer
- Inspected CompanyCam's actual photo viewer: white top-left toolbar, black media canvas, a 400px details panel with project/address/uploader/date, tags and description. Kept the requested exclusions (map/tasks/comments).
- Extracted shared presentation for the project and global viewers. Both now use the same header, details layout, navigation controls, image tools, and video download/trash controls. Heavy annotation code remains dynamically loaded.
- Fixed global-viewer Escape handling around the annotation editor and keyboard focus trapping from form fields. Navigation no longer wraps around at the ends. Global trash success refreshes its feed; stale detail responses cannot attach to the next selected media.
- Browser verified global photo tools, annotation open/Escape return, project video playback (readyState 4, duration 50.818s, advancing playback), cancelable trash prompt, and video-to-photo navigation. No customer media was edited or deleted during these checks.
- Production build and TypeScript passed. Individual tile menus and full deployed move integration remain incomplete; this is not a complete parity claim.

### Individual tile actions
- Re-inspected CompanyCam's per-photo menu. It contains Download, Duplicate, Set as Cover Photo, Share, Tag, Move to Trash. Sharing remains excluded by the request.
- Added a shared anchored native-popover menu to project and global tiles. Download is direct; Tag and Move to Trash open their dialogs directly with fresh metadata, without replacing the current bulk selection. The existing batch engine retains revision checks and safe retries.
- Verified global Tag/Trash open and cancel, project Tag open and cancel, and independent date-group bulk selection (16 items). No customer photos were changed. TypeScript and five batch integrity/retry tests pass.
- Duplicate and Set as Cover Photo still require implementation; the menu is not claimed to have full functional parity yet.

### Project cover photos
- Added persistent `project_workspace.cover_media_id` with a foreign key and validation against the project's available image media. The authenticated manager RPC uses the existing workspace authorization/lifecycle rules.
- Directory previews prioritize the selected cover, then latest visible media, using a bounded cover lookup plus three recent rows. Moved/trashed/deleted covers fall back without exposing another project's media or broken thumbnails.
- Added Set as Cover Photo to image menus (not video menus), with save feedback.
- PGlite tests cover persistent ordering, rejection of video/other-project media, trash/move/delete fallback, manager checks and anonymous denial. The migration was applied to ServiceFlow.
- Browser action selected photo `46d457fa-944b-4df6-a79c-d998b6389885` for Wardah; verified the project directory rendered its preview URL first. Restored `cover_media_id` to null afterward, matching the prior automatic-cover behavior. No original media changed.
- Repeated the browser check with a different image (`a9f44dff-368b-41b6-b272-dc0db2b02e4f`) and confirmed it replaced the default `46d457fa-944b-4df6-a79c-d998b6389885` thumbnail. Restored null again after verifying the ordering change.

### Team, Customers and required-contact creation
- Inspected CompanyCam Team: table with Name/Role/Info/Latest Activity, active people before deactivated people, searchable users, and user detail leading to their media. Our table now follows the main column/row treatment and active-first ordering; actual activity, user detail and management actions remain open. Status is shown truthfully instead of fabricated activity.
- CompanyCam Customers currently has no records in the reference account, so a populated reference table could not be inspected. Observed its single-row title/search/create header and Customer modal with plain header, contact details and fixed footer. Updated our header/form to those patterns without adding unsupported fields.
- New Project now opens the shared customer form inline instead of navigating away. Cancel preserves the project draft; Save selects the created customer and returns to the draft. Existing server-side required-contact and idempotent creation protections remain.
- Browser verified both paths with project name/address preserved; successful creation selected the new customer and enabled Create Project. Removed temporary unreferenced customer `54006899-bd28-4b6c-b6de-8494ce115d9e`. No test project was created.
- Team search and rendered customer header checked. Production build and TypeScript passed.

### Deployed media move verification
- Deployed worker version `f2de84f3-9bea-4cfe-96a2-c2ddca8710a1` after 51 worker tests passed. Existing bindings and environment variables were preserved. Admin UI has not been pushed/deployed.
- Added `scripts/media-move-live-test.mjs`: dedicated QA account/project/media only, original and thumbnail checksum verification, description/tag preservation, repeated-request safety, stale ownership rejection and move-back verification. Credentials never enter output/reports. Live checks passed.
- Verified the actual local browser selection → Move → destination search → Move Photos flow against the deployed worker. Source gallery went from one to zero photos; destination rendered the moved thumbnail successfully. Database ownership and description/tags matched.
- QA photo `c9a91282-0697-423e-91de-93065102751d` was moved to recoverable trash through the UI. Destination `047064ac-b3dc-4ca0-a699-f4f1e7e20b97` was archived then trashed; QA account was disabled/banned. No customer media was moved.
# Large video thumbnail verification

Backfilled the existing 127 MB Wardah video with a 30,745-byte JPEG poster at its thumbnail object key. The original video is unchanged. In the authenticated project gallery, the preview endpoint loaded a 480 × 640 image successfully and no video element was initialized. Browser resource timing was unavailable through the automation surface, so no measured transfer latency is claimed.

Thumbnail error state now follows the failing source URL, allowing a different project cover image to load after an earlier preview failed.

## Team profile interaction

Observed CompanyCam `/users/4005454`: clicking a name in Team opens an avatar/name/contact header followed directly by that user's date-grouped photo feed. Implemented `/employees/[id]` using the shared `PhotoFeed`, including project/date/view filters, hover controls, selection, actions, and media viewer. Names in the directory now link to those profiles. No duplicate gallery implementation was added.

`20260916030000_user_photo_feed.sql` adds an exact `uploaded_by` constraint to the existing paged feed RPC and is applied live. Existing callers remain compatible. Imported CompanyCam media currently has a separate numeric creator ID and null ServiceFlow uploader ID; it is not assigned to an employee by matching display names. A verified account mapping remains outstanding for those imported assets.

Verification: browser navigation Team → Bilal showed 16 media items; date-group selection selected 16; Videos Only retained Bilal's scope and displayed his one video with a loaded thumbnail. The database test covers identical display names, 60-item pagination, media/order filters, missing users, legacy calls, and anonymous denial. User management controls remain outstanding.

## Sidebar controls

Re-inspected CompanyCam's top-left Create menu and avatar menu in Chrome. The create menu offers Create Project plus group/invitation features outside the requested scope. Its avatar menu includes My Photos and Sign Out. ServiceFlow now places the compact logo, Create control, and account avatar in the top row; the account menu links to the authenticated member's photo profile and retains sign-out. Removed the previous permanent account footer. Resources now expands/collapses Labels and Project Trash. Desktop and mobile share the header; mobile retains its close button and traps keyboard focus, while letting nested project dialogs handle their own Escape/Tab events.

The global Create Project control lazily loads the existing required-contact form, preserving its request ID and nested customer creation behavior. Browser verification: opened Create Project from Labels, checked the required-contact form, dismissed with Escape and verified focus returned to Create; collapsed Resources; opened the account menu and followed My Photos. No project or customer was created during this check.

## Lifecycle audit and menu fixes

Re-inspected the CompanyCam project menu on project 114588109. ServiceFlow retains the requested stricter archive-before-delete rule. Replaced the non-dismissing disclosure with a native popover: outside clicks/Escape dismiss it, opening focuses its first action, and selecting an action closes it. Trash errors now render inside the confirmation dialog instead of behind its backdrop.

Extended the lifecycle database test to assert unchanged job/contact fields, identical restored media metadata, retained labels and archived status, successful restoration at 89 days 23 hours, rejected restoration at 90 days, and rejected attempts to extend an existing trash timestamp. Tests pass. TypeScript passes.

Browser verification used only `Media Move QA — TEST ONLY` (047064ac-b3dc-4ca0-a699-f4f1e7e20b97): Escape closed its menu and returned focus; Restore exposed its original QA contact and archived status; Delete opened the 90-day confirmation; Move to Trash returned it to the trash directory. The fixture is left in trash. Its previously trashed media remains independently trashed.

## Contact and description editor recovery

Audited the project editors. The main Edit Project form already catches rejected requests; the smaller contact/description editors now do the same and retain their drafts with an inline retry message. Escape/backdrop dismissal is blocked while saving, consistent with the disabled Cancel button, and fields are disabled during the request so newer edits cannot be discarded by an older successful save. Removed redundant description helper copy. TypeScript and diff checks pass. Browser cancellation was checked on the dedicated QA project's description; no save was submitted. Network rejection and pending Escape behavior are covered by code inspection here, not a simulated browser outage.

## Customer project history

CompanyCam's [customer documentation](https://help.companycam.com/en/articles/15327299-creating-and-managing-customers) confirms that the detail record groups linked projects together. The live reference account has no customer records, so exact populated-screen visual parity is not claimed. Replaced the old Deals & jobs card layout with the established workspace project-row treatment, contact info, actionable email/phone links, cover thumbnails, labels, and archived badges. Removed finance/source badges and redundant helper copy from this workspace screen without changing underlying records.

Customer projects now read `project_directory`, matching Projects naming, canonical membership, archive state, and trash exclusion. Removed the obsolete duplicate job/lead reconstruction and its unused types/helpers. Project history paginates in groups of 40, matching the preview RPC bound. An out-of-range page redirects to the last available page. Browser checked Wardah's project/address/thumbnail and contact links. Customer edit/additional contacts/import functionality remains outstanding; this change does not claim full customer parity.

## Customer editing

Added the customer record's ellipsis → Edit Customer workflow, reusing the existing create form with prefilled name/email/phone/address. The dialog keeps its draft on failure, disables fields during save, and returns focus to the menu trigger. The customer actions are shown only to managers/admins; authorization is also enforced server-side and in the database.

Live testing exposed that direct contact updates are intentionally denied. Preserved that boundary and added `20260916040000_update_customer_contact.sql`, applied live: manager-only RPC, bounded field/email validation, normalized email/phone updates, atomic merge of only the address metadata key, and an updated-at concurrency check. `scripts/customer-edit.test.mjs` passes for normalization, unrelated metadata preservation, stale writes, non-manager denial, and anonymous denial.

Browser round trip used only QA contact 3323f5eb-b52e-4f36-b283-ec51a81d6d94. The initial denied request retained its draft and displayed an error. Retrying through the RPC saved the address, reopening showed it prefilled, and a second save restored its original blank address. Database verification confirms its original name, null email/phone/address. No real customer was changed.

## Stale Projects pagination recovery

Reproduced `/projects?view=trash&page=99` failing with a range-not-satisfiable server error. Projects now retries the first bounded page only for a 416 response, obtains the current total, and redirects to the last valid page while retaining search/status/label filters. Normal pages retain the existing single query. Non-integer or unsafe page numbers fall back to page one. Browser verified `view=trash&page=99&q=Media` redirects to `q=Media&view=trash` and displays the QA project. TypeScript and diff checks pass.

## Date-filter interaction refinement

Observed CompanyCam's active date filter in Chrome: selecting September 14 produces a dark `Sep 14` chip with an inline clear control. Updated the shared toolbar to use readable dates/ranges, a dark active state, no date dropdown chevron, and one-click clearing without reopening the calendar. Removed the redundant clear link inside the calendar. Browser verified selection produced the expected empty result for Bilal on September 14 and clearing restored his 16 media items. Temporary reference filters were cleared afterward.

The browser surfaced a missing React key on the server-rendered Team profile header passed into PhotoFeed; added the stable member ID key. Reload verified 16 media items and no issue badge. TypeScript and diff checks pass.

## Workspace language and empty states

Fixed PhotoFeed's empty-state classification: a fixed user-profile scope no longer counts as a user-selected filter, and helper copy no longer branches on an always-zero photo count. Empty results distinguish no media from no matching media and consistently mention photos/videos and projects. Browser verified Abdellah's empty profile shows the genuine empty state. Customer rows now show their existing project count instead of separate job/deal badges and omit an empty address placeholder. TypeScript and diff checks pass.

## Project directory sorting

Observed CompanyCam's Project Name header reorder the list alphabetically. Added Project Name and Last Updated sort controls with visible direction indicators and accessible current-order labels. Sorting runs on the database before the 40-row page limit, with ID as a stable tie-breaker. Search, status/label filters, pagination, and stale-page recovery retain sort/direction URL parameters. Switching sort resets to page one. Fixed recent-photo column width for alignment with its header.

Browser verified name ascending, Next to page two with preserved URL parameters and Alejandra/Alex rows, then toggled descending with page reset and Zohra/Zinambarki/Zeana first. Returned the reference list to Last Updated. TypeScript passes.

## Shift-range media selection

CompanyCam's [Moving Photos documentation](https://help.companycam.com/en/articles/6828375-moving-photos) explicitly supports first-click → Shift-click range selection. Added the same behavior to both shared-feed and project-gallery checkboxes and selection-mode tile clicks through one small selection helper. It preserves visible order, supports reverse ranges/deselection, ignores unavailable anchors, and respects the 500-item action limit.

Three selection tests pass. Browser verified first-to-fifth Shift-click selects exactly five images in Bilal's user feed and exactly five items (including a video) in Wardah's project gallery. No bulk mutation was submitted. TypeScript passes.

Duplicate investigation: the [reference duplicate workflow](https://help.companycam.com/en/articles/6828346-duplicating-a-photo) creates an independent copy for markup. The existing worker move pipeline provides bounded requests, R2 stream copies, thumbnail copies, and prepare/commit validation, but cannot be reused as a move operation because duplication requires a new media identity and retry-safe insertion. Duplicate remains unimplemented; no nonfunctional menu item was added.

## Duplicate implementation — database stage

Added draft migration `20260916050000_duplicate_project_media.sql` and `scripts/media-duplicate.test.mjs`. Preparation returns a new media-ID-derived storage key; commit rechecks source project/key/availability and inserts an independent record. A per-copy request lock and provenance check make retries return the existing copy. The original record is never updated. Description/tags are preserved; move-revision metadata is removed from the copy. Active manager authorization and anonymous denial are retained. Videos are rejected because the observed Duplicate workflow is for photos.

Database test passes for plan/commit, unchanged original, separate identity/key, retry uniqueness, stale key rejection, metadata behavior, trashed-original rejection, non-manager and anonymous denial. This migration is NOT applied live yet. Storage copying, worker tests, server action, menu integration, and live QA remain required before Duplicate is usable.

### Duplicate photo wiring — September 16

- Added Duplicate to image hover menus and photo-only bulk selections through the shared action component. Copy IDs persist through partial or uncertain retries; videos are rejected by both batch preparation and the database.
- Added the staff-authenticated server action and worker endpoint. Each worker attempt has a separate destination object key; the database commits only one row per requested copy ID, preventing a late storage write from overwriting the winning copy.
- Applied `duplicate_project_media` to ServiceFlow and deployed worker version `37e6cf54-281b-4059-83e0-d6deb49f541b`.
- Verification: 53 worker tests, 7 batch/database tests, TypeScript, and diff whitespace checks pass. Local browser opened Duplicate from an image hover menu, displayed its dialog, and cancelled with Escape.
- Still required: live QA-only duplicate submission, checksum/metadata verification, partial-failure UI verification. The admin changes remain local; this is not a production UI deployment or a claim of complete parity.

### Duplicate live and browser verification — September 16

- `scripts/media-duplicate-live-test.mjs` passed against the deployed worker and database using dedicated QA records. It checks source/copy image and preview checksums, retained description/tags, unchanged original record, repeated-request idempotency, and independent editing of the copy. The generated account was disabled and test media moved to trash.
- Browser verified the project gallery's individual Duplicate action (1 → 2 photos), then bulk Duplicate (2 → 4 photos). Both completed through the actual server action and refreshed the gallery. Corrected success wording to say duplicated or moved to trash.
- Bulk trash removed the four browser test photos. Database verification found zero active `media-duplicate-qa.png` records; all five records from API/browser verification remain recoverable in trash. No customer photos were changed.
- TypeScript passes. Browser partial-failure handling remains supported by batch tests but has not been fault-injected end to end. Broader visual/responsive and remaining reference workflow audit still pending; full goal remains active.

### Bulk action menu dismissal — September 16

- Observed CompanyCam's global Photos selection menu: clicking the Photos heading dismisses Actions and preserves selection.
- Replaced the shared bulk action `<details>` with a native auto popover and button. It dismisses outside/on Escape, uses the top layer, and positions within the viewport. Pending operations disable its trigger.
- Browser verified global photo selection: menu shows the supported actions; its bounds fit the viewport; outside click closes it; Escape closes it and returns focus to Actions. Tag opens the existing dialog, and cancelling returns focus to Actions. No photo data changed.
- TypeScript passes. This applies to project and global galleries through their existing shared component.

### Labels page inline creation — September 16

- Directly rechecked CompanyCam Labels → Create Label. The reference inserts a light-gray draft row at the top of its table, focuses Name, defaults to gray, and hides Create while drafting. The prior local modal was a real workflow mismatch.
- Changed only the Labels page creation path to an inline draft using the existing row and palette. Name saves on Enter or leaving the row; color can be chosen before saving; Escape cancels. Blank drafts do not persist and a synchronous in-flight guard prevents duplicate submit events. Nested project-label creation continues using its existing editor.
- Browser created `Inline Label QA — TEST ONLY`, selected Blue before saving with Enter, verified the saved row, deleted the unassigned QA label, and verified Escape cancels a fresh draft. No QA labels remain. TypeScript passes.

### Integration audit and Team reference — September 16

- Production build (`NEXT_DIST_DIR=.next-build npm run build`) passes after Duplicate, action-menu, and inline-label changes. Build-generated tsconfig changes were removed. Eight focused checks pass across lifecycle/90-day restore, multi-filter pagination, cover selection, exact user feeds, customer edits, and Shift selection.
- Rechecked actual CompanyCam `/users`: rows link to photo profiles, active roles have an inline dropdown, and the ellipsis menu provides Edit User and Deactivate. The role dropdown shows Admin, Manager, Standard and Restricted. ServiceFlow must retain its own admin/manager/painter model; restricted project access is expressly outside the requested scope.
- Confirmed a concrete remaining regression: the new Team directory currently omits account creation, role updates and activation controls that were available in the old EmployeesTable. Existing server actions and the `project-assignments` Edge function provide creation/role/status operations. The function does not currently support profile-name editing.
- Before exposing restored controls, review account authorization and protect self/last-admin access. Current backend prevents managers granting admin but does not protect changing an existing admin or deactivating one. Restore controls with authoritative backend restrictions and QA-only account tests; do not mutate real staff access for verification.
- Remaining broad delivery checks: Team management, responsive layouts, imported creator-to-user mapping, global tag-filter parity, final staged diff review and deployment verification. Existing chronological notes above include superseded gaps; this audit does not claim full parity.

### Team role controls in progress — September 16

- Restored inline role selection on the new Team table for admins, retaining ServiceFlow's admin/manager/painter roles. Own-role editing is disabled. Failed requests show a row-level error; pending requests disable the control.
- Added local Edge-function permission checks for managers targeting admin accounts, self-demotion/deactivation, and non-boolean activation input. Three permission tests and TypeScript pass.
- Retrieved deployed `project-assignments` v21 and confirmed it matches the original local implementation. Backend edits are NOT deployed yet; transactional last-admin/concurrent-change protection still needs completion before shipping account management.
- Browser verified roles render and Jad's own role is disabled. No account role or activation was changed. Creation, activation menu, profile editing and live QA account mutations remain outstanding.

### Atomic Team account updates — September 16

- Added service-role-only `manage_team_account` database operation. It serializes account changes, re-reads active caller/target roles, rejects manager changes to admins, blocks self-demotion/deactivation, and preserves an active admin. Authenticated/anonymous callers cannot invoke it with a forged actor ID.
- Applied migration `20260916123800_manage_team_account.sql`; deployed `project-assignments` v22 with JWT verification retained. Existing role/status routes now call the atomic operation. Removed the superseded local TypeScript permission helper; SQL tests exercise the actual authorization implementation.
- Database permission test and TypeScript pass. Browser changed the inactive Media Duplicate QA account from Manager to Painter and restored Manager through the actual Team control and Edge function. It remained inactive. The browser bridge reported a transient select-value mismatch while the controlled input awaited its server refresh; refreshed UI showed the successful Painter value, and final SQL verified Manager/inactive.
- Creation, activation UI, profile editing and remaining full-goal audit are still outstanding.

### Team activation menu — September 16

- Added the reference-style per-user ellipsis menu with Reactivate/Deactivate, using the deployed atomic account operation. Only admins see these controls in the current UI, and the signed-in user has no self-deactivation menu.
- Browser reactivated the dedicated Media Duplicate QA account, verified its row changed to Active with Deactivate available, then deactivated it again. Final database check confirms Manager/inactive. Its existing auth ban was not modified; no real staff account was changed.
- TypeScript passes. Account creation and profile editing still remain; the existing creation backend uses generated passwords rather than email invitations, so the UI must represent that behavior accurately.

### Team account creation — September 16

- Inspected CompanyCam Invite Users: email entry → Review Invites → Done. ServiceFlow's existing backend creates a password login, so the restored UI accurately says Add User/Create User rather than claiming email invitations.
- Added lazy-loaded name/email/role form using the shared modal and existing creation action. Pending requests lock dismissal/fields, failures preserve the form, success shows the generated password once and refreshes Team.
- Browser created `Team Create QA — TEST ONLY` with `sf-team-create-qa-20260916@example.invalid`, verified success/password presence without logging the secret, then deactivated it through the new row menu. SQL confirms ID `54a6c9d0-f301-4c42-9a5a-313781b12dac`, painter, inactive. No email sent.
- TypeScript and diff checks pass. Team profile editing remains outstanding; account creation is functional but intentionally retains the existing password delivery mechanism rather than pretending invitation parity.

### Team profile editor implementation — September 16

- Inspected actual CompanyCam Edit User: profile name, phone and job title plus account/role controls. Added a compact Edit User form to the existing Team row menu, retaining ServiceFlow's single full-name field. Phone and job title display in the directory when present.
- Applied `edit_team_profile` migration: optional phone/job-title columns, admin-only edit RPC, shared account lock, field validation and expected-updated-at conflict protection. It preserves email/role/activation state. Local SQL test verifies those invariants, unauthorized access, and stale edits; TypeScript passes.
- New form preserves drafts on errors, locks while saving, and lazy-loads. Own profile can be edited while self-deactivation remains disabled. Browser save/reopen/restore verification remains next; account email/password changes were not implemented in this step.

### Team profile browser verification — September 16

- Browser edited the dedicated Team Create QA account: phone `613-555-0100`, job title `QA Test`. Saved values appeared in the directory; reopening retained them. Phone values were omitted by text/DOM inspection but the screenshot showed the populated field, and SQL independently confirmed persistence.
- Restored phone/job title to null through the form. Final SQL confirms the original QA name, null phone/title, painter role, and inactive status. No real staff profile was changed.
- TypeScript passes. Team's restored core flows now have live browser evidence for create, role change, activation/deactivation, and profile editing. Email invitations and account credential changes remain different from CompanyCam's broader settings workflow; the app retains its existing password-login creation behavior.

### Global Tags filter — September 16

- Added the shared Tags multi-select to the global Photos/user feeds, API validation (30 tags, 60 characters each), and paged SQL filtering before the 60-item limit. Tags combine with other filters using the same any-selected-tag behavior as project galleries.
- Added an RLS-respecting tag-options RPC excluding trashed media. Applied `20260916125035_workspace_photo_tags.sql`.
- Extended database paging tests: a comma-containing tag remains one tag; a 65-item tagged set paginates 60+5; tags intersect exact uploader filters; existing legacy calls remain valid. TypeScript passes.
- Browser temporarily restored one dedicated tagged QA photo, selected Duplicate QA in Tags, and verified only that photo appeared. Returned it to trash through the photo menu; the filtered feed became empty. No customer media changed.

### Refresh filter choices after photo edits — September 16

- Found that global photo mutations reloaded only media rows, leaving newly added tags unavailable in filter choices until a page reload.
- Added an explicit API options refresh for mutation callbacks. Ordinary filtering/pagination still fetch only a media page; successful mutation refreshes also replace filter choices with current summary/tag options.
- PhotoDetailsEditor now optionally reports successful saves. Global viewer tracks those saves and refreshes feed/options on close, avoiding disruption while editing or navigating. Trash refreshes options as well.
- TypeScript and formatting checks pass. Full browser add-tag → filter-without-reload verification remains next.

### No-reload tag refresh verified — September 16

- Browser restored one dedicated QA photo, filtered it by its existing Duplicate QA tag, opened the viewer, added Fresh Tag QA, saved, and closed the viewer.
- Without navigation or reload, Tags offered Fresh Tag QA. Selecting only that new tag returned the QA photo, proving the save → refresh-options → filter request flow works.
- Returned the photo to trash through the menu and removed the temporary Fresh Tag QA value from that QA record. Original Duplicate QA tag retained. No customer photos changed.

### Final desktop visual pass and build — September 16

- Compared live CompanyCam global Photos and project detail screens against local Photos and a populated project. Sidebar width, compact photo grouping, filter arrangement, and the contact/description card treatment follow the inspected reference. Different viewport widths and content prevent claiming pixel-perfect parity.
- Rechecked Labels in the browser: Create Label inserts a grey inline row and immediately focuses its name input. Existing creation/save/color/delete and Escape cancellation checks are documented above.
- Read-only feed SQL timing: 13.478 ms privileged and 32.064 ms under the signed-in authenticated role and claims, with no disk or temporary reads. These are database execution measurements, not end-to-end browser performance benchmarks.
- Production Next.js build passed after Team and global tag changes, including type checking and route generation. Restored the development tsconfig includes after the isolated .next-build run.
- Full responsive verification and verified identity mapping for imported photo creators remain outstanding. Admin changes are local; this is not a production UI deployment or a claim of complete parity.

### Verified imported creator identity — September 16

- Inspected CompanyCam's Team directory, including profile IDs and email addresses. Creator 4005454 and the existing ServiceFlow account uniquely share info@paintersottawa.com. The other five imported creators have no verified matching email; same-name matches are not treated as proof.
- Initial attempt to populate uploaded_by was rejected atomically by job_media_source_attribution_check. No imported rows changed. Retained this invariant and replaced that unapplied migration with a separate read-only media_creator_links mapping.
- Applied the corrected migration and extended the exact user-feed filter to consult verified source-provider/creator-ID mappings. This preserves native upload attribution, original metadata and source IDs. Client roles cannot edit mappings.
- SQL tests pass for 60+5 paging, same-name/different-ID exclusion, ambiguous email rejection, unchanged imported attribution, and denied client mapping writes.
- Live database reports one verified mapping, zero imported records with native uploaded_by, and a 60-item first page. Browser profile renders the imported photo groups correctly. Other legacy creators remain searchable in global Photos by their preserved names; they do not acquire login accounts.

### Narrow-screen photo filters — September 16

- At a 390px viewport, reproduced Users opening beyond the right edge, clipping names and controls. The shared toolbar popover used trigger-relative alignment without viewport clamping.
- Added measured horizontal positioning before paint, retaining trigger alignment when space permits and recalculating on resize. Choice panels respect their available width.
- Browser screenshots verify Users remains inside the viewport at 390px and after resizing the open menu to 320px. Date picker also fits at 390px. TypeScript passes. This verifies these filter states, not every responsive workflow.

### Mobile photo interaction and label overflow — September 16

- At 390px, selected a photo, opened the bulk action menu, cleared selection, and opened the photo viewer. Menu actions and loaded viewer/details fit the viewport. No photo data changed. This desktop viewport check does not emulate a physical touch device; hover:none visibility is present in the shared controls.
- Opened navigation drawer, verified Tab from the last link wraps to its first link, then Escape dismisses and restores focus to Open navigation.
- Labels inline name and color picker are usable at this width. Reproduced document scrollWidth 592px versus clientWidth 380px, caused by the absolutely positioned screen-reader table header escaping the table scroll container. Positioned the container relatively; browser now reports both widths as 380px, retaining table-local horizontal scrolling.
- TypeScript and diff checks pass. Cancelled the unsaved draft, closed the temporary tab, and reset viewport overrides.

### Responsive directories and project edit — September 16

- Reproduced Team document overflow at 390px (scrollWidth 704 versus clientWidth 380). Made its table scroll container positioned, keeping the screen-reader column header inside it. Browser confirms scrollWidth and clientWidth now both 380.
- Customers and Projects both report 380px document widths at this viewport; screenshots show usable search, primary actions and lists.
- Inspected populated Wardah project and its Edit Project dialog at 390px. Project name/address, contact name/email/phone, description, Cancel and Save Changes are visible and usable without horizontal clipping. Cancelled without saving.
- Fixed project gallery capture times wrapping AM onto a second line by matching the global feed's nonshrinking, nonwrapping time treatment. Browser confirms 11:27 AM and 11:19 AM each occupy a single 16px line.
- TypeScript and diff checks pass. Reset viewport and closed temporary verification tab.

### Feed request and thumbnail review — September 16

- Reviewed global AbortController cancellation/request identity checks and project-gallery generation checks. Superseded requests cannot replace current results; appends deduplicate media IDs. Normal global filtering/paging omits summary/tag option queries.
- Browser initially rendered 60 images, all lazy preview URLs, with no mounted video player. After activating Load more on the hydrated page and waiting for the 120th figure, the DOM contained 120 unique image URLs, all lazy previews. Early clicks during hydration did not initiate the request; the successful check observed the button disabled during loading and then the appended figures.
- No browser console errors were captured in this check. This is resource-selection and pagination evidence, not a cold-load latency or throughput benchmark.

### Integrated build and action review — September 16

- Production Next.js build passes after responsive fixes and creator mapping: compilation, type validation and route generation. Restored development tsconfig includes after the isolated build.
- Reviewed shared media menu/selection loading, global and project request lifecycles, member/staff authorization and move/duplicate action boundaries. Member reads remain separate from staff mutations, IDs are validated, and worker operations retain stable retry IDs and bounded timeouts.
- Build reports first-load JavaScript of 124kB for Photos, 116kB for Projects, 114kB for Labels, 111kB for Team and 110kB for Customers. These are build output sizes, not measured browser load times. Project details remain 207kB and warrant inspection for unnecessary eager code in the final performance pass.

### Separate photo route entry point — September 16

- Moved PhotosSlot unchanged into project-photos-slot.tsx, so the photo route no longer imports the server module containing labour/task client panels. Existing legacy routes retain their own exports and behavior.
- Production build passes. Project detail first-load JS falls from 207kB to 204kB; the legacy labour/task routes fall from roughly 204kB to 111kB by no longer importing the photo surface. This is modest for the photo route and does not explain its entire bundle.
- Browser verified Wardah's 54-item gallery and Upload photos control still render after the move. No upload/session recovery code changed.
- Located existing opt-in NavigationTiming QA instrumentation (?__perf=1), which reports browser timing locally to console. Next performance verification can use the production build with this instrumentation rather than infer browser speed from build sizes.

### Production-build browser timing — September 16

- Started the existing optimized .next-build artifact on a temporary local port (3102) and used the existing opt-in ?__perf=1 console instrumentation. Reused the authenticated browser; no deployment or login changes. Stopped the temporary server after verification.
- Single desktop samples, heading committed plus two animation frames: Photos initial load 578ms (server response wait 352ms, dataFetchMs 348); Projects navigation 439ms; Customers 359ms; Team 325ms; Labels 322ms. Navigation samples reported prefetched=false.
- Populated Wardah project heading checkpoint 316ms with cached assets. Its 54-item gallery subsequently verified attached. This heading checkpoint does not time the streamed gallery or complete image decoding.
- Photos transferred 255,119 bytes by that checkpoint, across 20 recorded requests; later lazy image requests are outside this measurement. No errors captured on the populated project.
- These provide actual local production-build browser measurements, not a cold-cache benchmark, mobile network simulation, percentile study, or proof of matching CompanyCam latency.

### Label column fidelity — September 16

- Reopened live CompanyCam Labels in Chrome. Its compact 80px color column keeps names aligned near the left edge while the three content columns share remaining width.
- Replaced automatic label-table column sizing with a fixed layout, 80px color and 64px actions columns. This removes the previously observed empty-state-to-draft name-column shift; minimum table width accommodates dates inside the existing horizontal scroll container.
- Browser measured identical column x positions before/after Create Label: 274, 354, 627, 899, 1172. Screenshot confirms the inline name field stays beneath Name and focused. Cancelled the draft; no label data created.

### Combined regression and desktop comparison — September 16

- Ran the combined workspace suite: 18 tests passed, zero failures. Coverage includes account permissions, customer edits, gallery filtering, duplicate/move transactions, Shift selection, streaming ZIP integrity/cancellation, creator mapping, cover photos, lifecycle rules, profile conflict handling and user-feed pagination.
- Reopened CompanyCam Photos and local Photos; compared the local feed at the same 1512px viewport width. Sidebar, title/filter hierarchy, compact thumbnail sizing, avatar/timestamp metadata and date grouping follow the reference. The extra reference User Groups filter and excluded sidebar modules remain intentionally omitted.
- Current data differs between products, so screenshots cannot establish identical photo content or a pixel-perfect match. Local thumbnail check found 32 loaded of 60 lazy images, zero broken images and no captured console errors; remaining lazy images were outside the visible region. Reset viewport after the comparison.
