# Admin performance pass — in progress

Scope: ServiceFlow admin only. Full user plan remains active: measurement, Contacts/project details, Jobs & Budgets/Timesheets, Photos, Crew/Overview, incremental deployment and complete verification.

## Measurement baseline (2026-09-15)

Production instrumentation commit: af8650f. Opt in by opening a route with `?__perf=1`. Records appear in browser console as `SERVICEFLOW_PERF`. No telemetry is transmitted. Measures actual click to route commit plus two animation frames; it excludes automation overhead. Resource transfer totals currently describe resources begun during the interval, not earlier prefetch bytes. Cold load and non-prefetched samples remain to be collected. Initial load measurements end at client hydration; do not label them paint/LCP.

Earlier reported 3-second sidebar timings included automation overhead and are superseded by these browser-native measurements. Prefetch/cached navigation does not establish uncached server performance.

Five baseline sidebar runs, milliseconds (same authenticated Chrome session):

| Module | Samples |
|---|---|
| Deals | 43, 24, 29, 29, 200 |
| Contacts | 39, 37, 31, 39, 35 |
| Jobs & Budgets | 32, 28, 36, 28, 36 |
| Timesheets | 62, 57, 61, 65, 59 |
| Crew | 36, 45, 43, 52, 44 |
| Photos | 41, 35, 33, 33, 32 |
| Overview | 88, 42, 41, 31, 182 |

All samples had a prior completed RSC request classified as prefetched except the first Deals sample (router-cached, no matching resource). All recorded zero newly completed request bytes during the click interval. One Deals initial load was 2383ms to hydration and 221379 resource transfer bytes; insufficient for a cold-load distribution. A prior RSC response is not proof of a current request cache hit; inspect this classification before final reporting.

## Prepared changes (not yet deployed)

- Project budget and assignment queries accept a project ID and apply it in PostgREST instead of fetching every job and filtering afterward.
- Budget projection reduced to fields required by existing selection and mapping.
- Two fixture tests pass (`node --test scripts/project-scoped-queries.test.mjs`): target job beyond a simulated 1000-row API limit; budget precedence/closed budgets/task exclusion/unchanged values/missing ID.
- Production build passes. Live project verification and deployment still pending.

## Remaining work

- Complete baseline cold/warm/non-prefetched measurements and request/byte accounting; database plans and timings.
- Contacts database pagination/search/counts/latest activity preserving canonical semantics; contact detail media scoping/defer.
- Job list exact aggregate parity, paginated jobs; Timesheets server filters/pages/full-filter totals; edit refresh tests.
- Photo cursor batching and filter/search parity; independent thumbnail failure behavior.
- Crew summaries and lazy rate history; Overview summaries and deferred map details.
- >1000-record and authorization checks, mutation verification on QA fixtures only, staged production deployments, at least 20 warm interactions/module after changes, final requirement-by-requirement audit.

Unrelated project-note cleanup files must remain excluded from performance commits.

## Contacts release preparation

- Added get_contacts_page invoker-rights RPC; deployed additive migration 20260915180938.
- 1485 visible customer contacts; first page 50, final page 35; known-name search 1, absent-name search 0 under authenticated staff role.
- Local PGlite test covers 1200 customers, separate projects, canonical archived fallback, hidden jobs, address search, boundaries, and non-overlapping pages. Build passed.
- Before release Contacts document load/hydration samples with warm browser asset cache: 537, 672, 502, 447, 563 ms. These are NOT cold browser/server measurements. Resource-only transfer bytes were zero; document bytes are not yet included by the instrumentation.

## First Contacts/project-scoping release

327543c deployed successfully; live Contacts pages show 1–50 and 51–100 of 1485; search from page two returned the correct contact and reset pagination. Project-scoped queries released with this commit; live labour verification remains pending.

Five distinct post-release Contacts reload/hydration samples (warm asset cache): 497, 1584, 379, 411, 775 ms. One duplicate console entry was excluded. Median 497ms versus baseline 537ms; the 1584ms outlier prevents claiming uniformly faster loads. New RPC measured 43.316ms under authenticated role. Cold scenarios, full document bytes, and 20-interaction acceptance runs remain outstanding.

Contact-detail previews are now prepared locally: shared two-image/count query, streamed separately from contact/project cards. Not yet deployed or live-tested.

f999333 deployed successfully. Live contact detail for the previously observed Lydia record retained its project link and exact one-photo count; thumbnail DOM confirmed loaded with `preview=1`. No contact or project data was changed for this verification. Independent media failure behavior, larger contact histories, and complete acceptance interaction counts remain pending.

## Timesheets preparation

- Additive get_timesheets_page RPC applied; caller RLS retained. Fifty entry rows, exact full-filter total hours/count, and global active count within the existing recent-or-active scope.
- Production read comparison at 2026-09-15T18:00:00Z: 144 total, 50 returned, counts and hours match the full SQL result.
- PGlite fixture passes with 1200 completed entries plus an old active shift, older completed exclusion, crew/job/name/status filters, negative-duration protection and unchanged totals between pages.
- Baseline warm-asset-cache document load/hydration: 1078, 666, 530, 593, 549 ms. No cold/cache-empty claim.
- Build passed. New page footer uses generated reference docs/design/timesheets-pagination-reference.png and existing table styles. Refresh after successful mutations is explicit.
- Jobs & Budgets aggregate work, option-list payload trimming, live edit verification, and 20-interaction acceptance remain outstanding.

404a3bb deployed successfully. Live Timesheets verified page 1 (1–50 of 144), page 2 (51–100), empty search (0 entries, 0m), reset to first page, and Active status (two active records, 1–2 of 2). No real entries were edited. Full mutation/permission verification and post-release reload samples remain outstanding.

## Jobs & Budgets work in progress

- Additive get_job_work_summary migration 20260915182306 applied. Aggregates explicit clock bounds and effective-at-start employee rates, unpriced hours, last clock-in, assignment counts.
- Local metrics optional summary input preserves existing rollup formulas; jobs route prepares 50-row server pages and filtered summary badges without downloading time-entry histories. Existing job sort comparator is reused.
- Current implementation still retrieves project/budget lists for server-side joining; row-cap and parity tests must be completed before deployment. No Jobs & Budgets code release yet.
- Production build passes for this prepared code. Need validate UTC rate/date and active durations, >1000 records, preserved budget precedence/amounts, aggregate parity against existing JS, then baseline/deploy/live checks.

### Jobs & Budgets release verification

- Replaced raw all-history entries/rates/assignments and all-project/all-budget downloads with authenticated database aggregates and a 50-row database page. Existing rollup display formulas remain in TypeScript; filtering, ordering, current-budget selection and full-result alert totals run in the database.
- Fixture compares database hours/wages/unpriced hours/assignments to the existing calculation on 1,200 entries and checks all 24 pages of 1,200 projects without duplicates. Includes historical rate changes, active milliseconds, zero rates, missing rates, manual-budget precedence and empty search. Passed.
- Authenticated production RPC execution: 32.033 ms in EXPLAIN ANALYZE. This is database execution, not end-to-end page timing. No index added.
- Warm-asset baseline page loads captured separately from prefetched navigation. First visit 2,758 ms (not a controlled cold-cache measurement); reload samples recorded below.
- Five warm-asset reload baseline samples: 827, 686, 675, 478, 661 ms (median 675 ms). Initial document transfer bytes are not yet captured by instrumentation; do not treat the zero cached-resource bytes as a zero-byte page.
- Invoker RPC with authenticated role but no user sees zero records. Anonymous execute denied in fixture. No stored business data changed.
- Jobs release `a16fe47`: Vercel Ready; canonical site renders 1–50 of 220, then 51–100 of 220 with the existing labour columns and edit buttons.

### Measurement correction

The App Router can commit a loading boundary before the content. Instrumentation now waits for the destination heading and includes document transfer bytes. Earlier measurements without `contentReady: true` may stop early on streamed loads; retain them as historical observations, not acceptance evidence. Re-baseline outstanding modules with the corrected instrument. Resource transfer numbers still cover the measured interval; `routeBytes` separately records the most recent matching RSC response, including a prior prefetch where available.

### Photos baseline and prepared release

- Corrected content-ready warm-asset baseline: 1,377, 1,064, 2,294, 3,711, 5,359 ms; median 2,294 ms. These were measured after adding the order index but before replacing the 600-row UI. Not a pre-index end-to-end baseline.
- `get_photo_feed_page` first EXPLAIN: 2,845 ms. Underlying scan sorted 7,713 visible media rows. Added `(captured_at DESC NULLS LAST, created_at DESC, id DESC)` index; RPC then 175 ms. Existing indexes began with job/lead and did not cover the global order.
- Full filtered count and filter choices stay separate from 60-item cursor batches. Query fixture traverses 1,205 records with identical timestamps and null capture dates without loss/duplicates; media filters run before pagination; invoker view/RPC respects restricted RLS. Passed.
- Gallery images use the existing thumbnail endpoint; viewer uses originals. Video bytes load on demand. Obsolete filter requests abort and cannot overwrite newer state.
- Photos release `ae09ed8` is Ready on Vercel. Live page shows 60 images, all 60 with thumbnail URLs and loaded image dimensions; total is 7,713. Rapid video→image filters exercised; full batch/filter verification continues.

### Crew prepared release

- Replaced time-entry, assignment and rate-history downloads with a compact invoker summary. Rate history loads only for the opened editor. Existing actions remain authoritative; success refreshes summary rows.
- Fixture: 1,200 employees, 1,200 shifts/assignments, old active shift, excluded old completed shift, future rate and scoped history all pass. Authenticated live summary execution 5.023 ms.
- Pre-release content-ready observations: 744, 633, 1,655, 630, 529 ms (median 633 ms). First sample is prior initial load, remaining samples warm-asset reloads; not a controlled cold run.
- Photos load-more verified: 120 distinct thumbnail URLs after second batch. Five post-release content-ready warm-asset loads: 2,626, 1,577, 1,586, 1,619, 1,754 ms; median 1,619 ms versus 2,294 ms baseline (~29% lower). This is not the 20-interaction navigation acceptance test.
- Crew `5cd2af7` is Ready on Vercel.

### Overview prepared release

- Replaced raw entries/rates/budgets/assignments with a purpose-specific summary, chart series, current shifts, the existing seven activity days, and six off-site entries. Map data starts within its own streamed boundary; location failures no longer block the primary page. Map project reads are scoped and location history is paged past API row limits.
- Fixture verifies 1,200 shifts, complete activity counts, chart parity, missing/overlapping/invalid segments, millisecond bounds and active clocks against existing JavaScript. Live fixed-time comparison on 44 records also matches on-site percentage and both weekly totals. No stored data changed.
- Overview baseline content-ready samples: 3,067, 1,397, 1,473, 896, 1,357 ms (median 1,397 ms). First includes new deployment assets; cold-server state was not controlled.
- Timesheet option props now contain only labels/IDs, and project option queries page beyond API row limits.

### End-to-end verification and remaining latency

- Overview `49e2597` and contact relationship fix `0b10bc1` are Ready; the live Overview retains all summary/chart/shift/map sections. Contact relationships now use a database join and pass a 1,200-related-project fixture without an oversized UUID URL.
- Dedicated temporary Hermes QA job/time entry created for edit verification. A browser correction changed 30m→45m in both the row and complete filtered total; database clock-out matched. Job amount save refreshed the row and labour allowance. Lazy pay-rate editor loaded the QA employee's empty history. Temporary entry, its two generated budget versions, and job were removed by exact ID; existing employee retained. No real operational/historical amounts edited.
- Anonymous Photos API redirects to login (307). New functions remain invoker-rights; security advisor reports no warning on these new functions/view. Existing unrelated sync/legacy function advisories were not changed.
- Browser acceptance remains in progress: early non-prefetched visits exposed multi-second outliers; they are not hidden behind successful builds or DB timings. Added data-fetch, route-duration and commit/frame-wait diagnostics. Examples: Timesheets initial data fetch 807ms; Photos fetch 1,475ms / route 1,797ms.
- Root cause found in photo optional-filter generic plans: indexed literal query 4.7ms versus RPC 175ms. Per-request plans retain RLS and reduce batch RPC to 12.7ms; full filter-summary RPC reduced from 321ms to 154ms. The photo fixture still traverses 1,205 rows with correct filters and RLS.
- Prepared final read optimization: Timesheet dropdowns use a compact database result (tested with 1,200 jobs), and Photos authorizes in parallel with RLS-protected reads. Full browser timing reruns follow deployment.
