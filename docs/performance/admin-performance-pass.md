# ServiceFlow admin performance report

Date: 2026-09-15. Production: https://serviceflow-admin.vercel.app.
Functional release: `eadb2e8`; diagnostic resource-buffer correction: `495322c`.

The read-path changes are deployed through GitHub → Vercel. Mobile and Ottawa Painters were not changed. Historical business data was not rewritten. Verification found significant improvements, with occasional slow responses and incomplete cold-baseline evidence described below. This is not a claim that every measurement requirement or every latency target is universally satisfied.

## Shipped changes

| Module | Change |
|---|---|
| Contacts | Database search and 50-row pages, canonical project counts/latest activity, complete multi-project relationships. Contact details join related records in the database rather than building oversized UUID URLs. |
| Project details | Budgets and assignments scoped to the selected project; two image previews and separate accurate media counts; previews stream independently. Staff authorization runs alongside the RLS-protected presentation lookup. |
| Jobs & Budgets | Database summaries and 50-row pages replace all-history downloads. Full filtered totals, current-budget selection, ordering, historical effective rates, zero/missing rates, rounding and active clocks preserved. |
| Timesheets | Database search/filters and 50-row pages, full-filter totals, recent 90-day scope plus active entries, compact dropdown options. Successful edits refresh rows and totals. |
| Photos | 60-record cursor batches instead of 600 initial records; filters before pagination; UUID tie-breaker; thumbnails in galleries and originals in viewer; obsolete requests cancelled and stale responses ignored. |
| Crew | Purpose-specific summary; individual rate history loads when its editor opens. |
| Overview | Purpose-specific summary; map/location data loads independently. Scoped location reads paginate past API limits. |
| Navigation | Browser-native opt-in timing of click-to-content, excluding automation execution time. No broad prefetch or shared private-response cache introduced. |

All new RPCs use caller rights and authenticated execution. The photo view uses security-invoker semantics. Browser code receives no service credentials. Database changes are additive; reverting code does not require undoing data migrations.

## Navigation measurements

Browser-native click → destination heading mounted → two animation frames, visible Chrome tab. This measures primary content readiness, not every thumbnail/map tile or LCP. Median uses the two middle observations; p95 uses nearest rank. Samples are production observations in one session, not a guarantee for every device/network.

Primary acceptance sample: 20 sidebar interactions per module on `93c8a5c`, followed by 20 recorded detail interactions on `eadb2e8`.

| Module | Median | p95 | Maximum |
|---|---:|---:|---:|
| Deals | 99 ms | 432 ms | 694 ms |
| Contacts | 441 ms | 996 ms | 1,138 ms |
| Jobs & Budgets | 593 ms | 1,300 ms | 3,545 ms |
| Timesheets | 654 ms | 1,752 ms | 1,766 ms |
| Photos | 656 ms | 1,584 ms | 4,094 ms |
| Crew | 398 ms | 1,065 ms | 1,899 ms |
| Overview | 399 ms | 574 ms | 3,090 ms |
| Contact detail | 450 ms | 1,121 ms | 1,818 ms |
| Project detail | 556 ms | 1,822 ms | 2,688 ms |

Each primary sample meets median ≤1 second and p95 ≤2 seconds. Individual outliers remain. Five additional request-accounting runs caught Contacts at 3,449 ms and Overview at 2,181 ms; combining the 25 sidebar observations puts Overview p95 at 2,181 ms, above target. Do not describe the entire rollout as uniformly meeting the target.

Project-detail p95 before the final parallel-read adjustment was 3,147 ms (median 758 ms); afterward it was 1,822 ms (median 556 ms). These are separate live windows, so timing variability contributes to the difference.

### Reload observations and improvement limits

Five after-release full navigations with warm browser assets (not controlled cold loads):

| Module | After samples, ms | Median | Earlier baseline interpretation |
|---|---|---:|---|
| Contacts | 1653, 3314, 592, 710, 748 | 748 | Earlier 537 ms median used the incomplete content-ready instrument; no valid improvement claim. |
| Jobs & Budgets | 886, 653, 467, 707, 528 | 653 | Earlier 675 ms median used the incomplete instrument; no valid improvement claim. |
| Timesheets | 907, 601, 576, 1182, 844 | 844 | Earlier 593 ms median used the incomplete instrument; no valid improvement claim. |
| Photos | 450, 615, 485, 484, 620 | 485 | Content-ready baseline 2294 ms median: about 79% lower in this small sample. Baseline was already after the order index. |
| Crew | 663, 491, 574, 431, 521 | 521 | Earlier 633 ms median mixed initial load and reloads; suggestive, not a controlled comparison. |
| Overview | 352, 349, 314, 270, 496 | 349 | Earlier 1397 ms median included a first new-assets load; suggestive, not a controlled comparison. |

A first new-release Overview load was 1,881 ms with 331,569 measured bytes; cache/server coldness was not controlled. Controlled five-run cold baselines, five matched prefetch/non-prefetch before/after scenarios for every release, and equivalent before/after detail baselines were not completed. Earlier page timing omitted streamed content or document bytes; those observations remain in the historical notes but are excluded from acceptance claims.

### Requests, bytes and server/database time

The first long session exhausted the browser's default resource-timing buffer. Its click-to-content durations remain usable, but later zero-request and prefetch classifications do not. `495322c` enlarges the opt-in buffer; five follow-up runs per sidebar module verify request accounting.

Typical warmed-assets, uncached route navigation after the first visit used one page-data request:

| Module | RSC response bytes | Typical observed RSC duration |
|---|---:|---:|
| Contacts | ~4,874 | 269–550 ms, plus 3,356 ms outlier |
| Jobs & Budgets | ~11,960 | 220–285 ms |
| Timesheets | ~21,675 | 240–280 ms, plus 1,459 ms outlier |
| Photos | ~12,410 | 409–809 ms, first 1,231 ms |
| Crew | ~2,220 | 207–255 ms |

Deals used cached/prefetched data after the first visit (~6,314-byte RSC). Overview starts work before the click and streams map data, so its route duration is not equivalent to primary content readiness. Initial visits also load component chunks. Byte totals cover completed measured resources, not all later images/map traffic. An unfinished streamed document can report 300 bytes; that is not its final size. Prefetch classification indicates a prior matching completed resource, not proof that all current content was prefetched.

Authenticated database execution observations (distinct from network/server/page time): Contacts 43.3 ms; Jobs summary page 32.0 ms; Crew 5.0 ms; Overview 14.3 ms. Photo batch initially 2845 ms; query-plan evidence justified the global media order index, then per-request plans reduced batch RPC from 175 ms to 12.7 ms and filter summary from 321 ms to 154 ms. No speculative indexes were added.

Remaining bottleneck: intermittent end-to-end response delays remain much larger than these database execution times. The follow-up Contacts outlier spent 3356 of 3449 ms in its RSC response. Streamed routes and authentication/network work need separate trace attribution before choosing another optimization. No unsupported root cause or cold-start claim is made.

Follow-up audit: Overview's tracking-status query now selects only employees represented in its displayed shifts, in 50-ID batches. Empty shift lists issue no tracking-status query. The fixture verifies a target beyond the first 1,000 employees and all 1,200 requested employees without duplicates; build passed. This closes an unbounded map read, but is not evidence that the primary-content latency outlier is resolved.

Post-`ef08925` verification: 20 additional Contacts → Overview sidebar navigations measured a 384.5 ms median, 544 ms p95 and 1,043 ms maximum for primary content. Samples (ms): 384,480,389,373,362,359,544,417,373,351,367,406,335,1043,411,394,385,392,379,382. This sample meets the target; earlier outliers remain recorded rather than discarded. Full streamed response durations include independently loading map data and must not be substituted for primary-content latency. The before-deployment cold baseline cannot be reconstructed exactly; acceptance of documented current-only cold measurements versus a separate historical-code benchmark has been asked of the user and remains unanswered.

## Correctness and live verification

- Eight test files pass, including >1,000-record fixtures: 1,200 contacts/related projects, 1,200 jobs/entries/employees, 1,205 cursor-paged media records, and scoped location/assignment reads beyond API limits.
- Verified canonical project selection, separate projects per contact, complete pagination without duplicates, empty searches, filters, full-result totals, historical/zero/missing rates, active milliseconds, budget precedence, and duration-segment parity.
- Contact links render with a stalled or rejected photo-preview promise. Live contact/project links, preview counts and photo sections render correctly.
- Production Timesheets page boundaries, empty/active filters, Jobs page boundaries, Photos 60→120 distinct items, rapid filter changes, thumbnails/original viewer, Crew lazy rate editor and Overview sections verified.
- A dedicated temporary Hermes QA entry changed 30→45 minutes through the UI; both row and full filtered total refreshed. A QA budget save refreshed its row. Exact temporary entry/job/budget records were cleaned up; the existing QA employee and real records were unchanged.
- Fixed-time Overview comparison matched existing JavaScript totals and on-site percentage on 44 production entries.
- All 13 new functions were checked as invoker-rights and not executable by anon. Anonymous Photos API redirects to login. Restricted-RLS fixtures and no-user authenticated query checks pass.
- Production builds succeeded. Intended changes were committed separately; unrelated project-note/profile work remains uncommitted and excluded.

Tests: `contacts-page.test.mjs`, `contact-preview-isolation.test.mjs`, `job-work-summary.test.mjs`, `timesheets-page.test.mjs`, `photo-feed-page.test.mjs`, `crew-summary.test.mjs`, `overview-summary.test.mjs`, `project-scoped-queries.test.mjs` under `scripts/`.

## Rollback and unresolved acceptance items

Revert individual code commits through the same GitHub production path; retain additive RPCs/index/view. No destructive schema/data migration is necessary for rollback. Main functional release sequence: `327543c`, `f999333`, `404a3bb`, `a16fe47`, `ae09ed8`, `5cd2af7`, `49e2597`, `0b10bc1`, `93c8a5c`, `eadb2e8`.

Outstanding evidence: controlled cold-load and fully matched before/after scenarios, complete post-stream transfer sizes, and repeated confirmation of tail latency across environments. Overview's combined 25-run p95 misses the target; occasional >2-second visits remain elsewhere. These are measurement/latency limitations, not failed data-copy or calculation checks.

## Raw primary navigation samples (ms)

- Deals: 109,95,99,251,694,79,107,66,95,114,137,432,81,98,80,64,89,65,119,120
- Contacts: 817,777,594,460,677,390,397,416,400,609,1138,409,372,996,601,419,422,658,395,418
- Jobs: 627,710,439,852,1300,535,3545,542,529,456,687,691,457,436,579,437,581,604,709,824
- Timesheets: 1752,550,732,1766,1093,671,1322,425,752,637,448,712,423,1090,699,488,627,433,446,456
- Photos: 1584,604,565,1272,682,615,4094,604,581,592,596,724,683,717,796,594,1506,1120,569,629
- Crew: 450,864,358,1003,397,397,1899,342,351,357,351,399,443,437,359,430,437,1065,359,370
- Overview: 343,441,412,522,547,3090,571,387,394,393,432,193,348,574,398,399,394,522,381,393
- Contact detail after final release: 475,1121,651,316,237,563,345,553,1818,209,284,294,440,339,231,612,472,290,459,477
- Project detail after final release: 643,620,733,616,1772,1822,2688,438,1150,404,457,407,380,500,630,415,580,390,532,420
