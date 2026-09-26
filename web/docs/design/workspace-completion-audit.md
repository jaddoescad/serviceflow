# Workspace completion audit

Current scope: CompanyCam-style Projects, Photos, Customers, Team and Labels. The user's final exclusion of comments supersedes the earlier tentative request. Sharing, showcases, reviews, stars, maps, assignments, project conversations, documents, checklists, tasks and time tracking are outside this UI scope.

## Evidence as of September 16, 2026

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Every project has a contact | DB constraint, creation RPC test rejecting null contact, live project_directory count of missing contacts = 0 | Verified |
| Edit project and contact together | Shared project editor; browser desktop and 390px field inspection; contact RPC preservation/conflict tests | Verified |
| Archive before trash | DB check and lifecycle guard; lifecycle test; live trash_without_archive = 0 | Verified |
| Restore for 90 days | Tests accept 89 days 23 hours and reject exactly 90 days, including direct update; list query excludes expired entries | Verified |
| All active logged-in members can view projects | Member-gated pages and RLS; lifecycle test confirms painter read and anonymous denial | Verified in implementation/tests |
| Sidebar limited to requested features | Browser desktop and mobile navigation; drawer focus wrap and Escape return | Verified |
| Labels and project assignment of labels | Inline row create/name/color/save/delete tests in browser, project picker evidence in project-workspace.md | Verified for inspected flows |
| Photo hover selection, multiselect and actions | Desktop browser evidence; range selection tests; mobile action menu inspection; download/move/duplicate/tag/trash tests | Verified for implemented actions |
| Descriptions | Shared details editor, browser save/reopen evidence; global filter options refresh after edits | Verified |
| Users/projects/date/view filters | Shared toolbar, SQL filter-before-pagination tests, browser selections; viewport bounds fix | Verified for inspected combinations |
| Photos and videos together | Shared feed and viewer; populated Wardah gallery/video poster; worker tests | Verified for inspected media |
| Efficient thumbnails and paging | Thumbnail-only grid, originals on viewer; bounded feed paging; worker tests; authenticated SQL execution measured at 32.064ms | Verified for bounded loading; optimized local browser timing recorded below |
| CompanyCam visual fidelity | Actual Chrome interaction evidence across the main pages; desktop and narrow layout inspections | Compared against live Chrome reference; close adaptation, not pixel-identical |
| Clean readable implementation | Shared toolbar/viewer/selection components; TypeScript and production build; focused tests | Reviewed shared components and data paths; build and focused tests pass |

## Delivery state

Admin UI remains local at localhost:3100. Supporting database migrations and media worker changes have been applied as documented. No admin commit/push/deployment has been performed. The mobile video-poster upload change has not been published over the air.

## Known differences

- Team creation retains the existing generated-password workflow; it does not send CompanyCam-style invitations.
- Imported photo creators retain source identity. One account mapping is verified by exact email; unmatched legacy creators stay searchable globally without creating login accounts or guessing identity from names.
- Narrow-width verification uses a resized desktop browser, not a physical touch device.

## Final verification

- The consolidated suite passed 18 tests covering project lifecycle/contact requirements, filters and paging, selection, move/duplicate, downloads, covers, customer/team edits, and creator attribution. The media worker suite passed 53 tests.
- The optimized production build passed. Splitting the project photo slot removed the photo bundle from legacy labour/task routes (204 KB to 111 KB first-load JavaScript).
- An optimized local browser run measured the Photos heading and two animation frames at 578 ms, with 352 ms server wait. Subsequent Projects, Customers, Team and Labels navigation measured 439, 359, 325 and 322 ms. These are single local samples, not cold-cache benchmarks, full image decode timings, mobile measurements, or latency parity claims.
- The feed loaded 60 then 120 unique lazy preview images, with no grid video players or original-image requests. Desktop and 390px layouts were inspected. Labels retain identical column positions before and during inline creation.
- The final View menu comparison verified the same All/Photos Only/Videos Only, Small/Medium/Large, and Newest/Oldest controls. Changing Large updated the grid; the default Small setting was restored.
- Video duration badges use the bottom corner on devices without hover so they do not overlap the always-visible action menu.

The requested local implementation is complete for the scoped workflows. This is a CompanyCam-style adaptation with the exclusions above, not a claim of exhaustive or pixel-identical CompanyCam parity. Deployment remains separate from implementation.
