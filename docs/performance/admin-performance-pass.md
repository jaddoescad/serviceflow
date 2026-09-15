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
