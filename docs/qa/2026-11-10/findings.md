# ServiceFlow browser QA — November 10, 2026

Tested the live https://serviceflowapp.com app in the existing signed-in Chrome session as Jad Slim, at a 1512 × 828 desktop viewport. This was an exploratory, read-only pass. No forms were saved, messages sent, accounting changed, or deployments performed. Source reads were used to explain observed behavior; source findings below are not assertions about the exact deployed commit.

## 1. P2 — The Labour list and job detail disagree about the painter budget

1. Open [Labour](https://serviceflowapp.com/jobs).
2. Find Richard Labrèche: Painter budget is **$825 (21h 48m)**.
3. Open [that job](https://serviceflowapp.com/deals/a97d3c44-421f-5a30-ae0b-d97ed6e1927b) and click **Labour budget**.
4. The detail says **37% of the $2,062 job = $763 labour ÷ $35/h = 21h 48m**.

Expected: both places show the same dollar budget for the same job. Actual: the list implies 40% of revenue, while detail explicitly uses 37%. The $62 difference can mislead staffing and margin decisions. The hours agree, so this is not simply two independently chosen budgets.

Source lead: `web/src/components/projects-table.tsx:17` computes dollars from `costTargetPercent`; `web/src/lib/metrics.ts:366` falls back to `LABOUR_ALERT_PERCENT`. Check this fallback against the detail's budget calculation before changing data.

Evidence: [Labour list](labour-usage.png), [job detail](job-labour-budget.png).

## 2. P2 — “All” proposals silently omits existing records

1. Open [Proposals → All](https://serviceflowapp.com/proposals).
2. The rendered table contains exactly **300 proposal rows**. There is no pagination, load-more control, search, or truncation notice.
3. Switch to [Accepted](https://serviceflowapp.com/proposals?status=accepted).
4. This shows **236 accepted records**, including **22 customer names absent from All**, such as Laura Braden, Rashonda Legault, and Mike Ralph.

Expected: All provides access to every matching proposal through pagination or loading more. Actual: users cannot find these records in All, even though they exist in a narrower filter.

Source confirmation: `web/src/lib/proposals.ts:129` applies `.limit(300)`; `web/src/app/(app)/proposals/page.tsx` renders the result without pagination.

Evidence: [record comparison](proposal-list-comparison.json), [Accepted list](proposals-accepted.png). Comparison uses displayed customer names; the omitted names are proof of omissions, not a complete inventory of omitted proposal IDs.

## 3. P2 — Customer phone search requires stored formatting

1. Open [Customers](https://serviceflowapp.com/contacts).
2. Search **Blair Simpson**. One customer appears with phone **(613) 712-9869**.
3. Replace the search with **6137129869** and press Enter.
4. The page shows **No customers match** and **0 customers**.

Expected: digits-only search finds the same phone number. Actual: punctuation prevents matching, which can make existing customers look absent and encourage duplicate creation.

Source lead: `supabase/migrations/20261024120000_pipeline_views_customer_tools.sql` compares the raw phone text with `strpos`; no phone normalization is applied in the search predicate.

Evidence: [name finds customer](customer-name-search.png), [digits-only phone fails](customer-phone-search.png).

## 4. P2 — “Hourly usage” displays a revenue percentage

1. Open [Labour](https://serviceflowapp.com/jobs).
2. Richard Labrèche shows approximately **13h 40m clocked / 21h 48m budgeted**, alongside **24.5% Hourly usage**.
3. The job detail shows **66% of budget** using pay-weighted hours.

Expected: a column called Hourly usage describes hours consumed against the hour budget, or clearly identifies a different metric. Actual: 24.5% is approximately $506 wages / $2,062 revenue. Even raw hours / budget is about 63%, not 24.5%.

Source confirmation: `web/src/components/projects-table.tsx:168` labels the column Hourly usage; line 233 passes wage cost divided by revenue. Rename the metric to labour cost as a percentage of revenue, or calculate the metric named by the heading.

Evidence: [Labour list](labour-usage.png), [job detail](job-labour-budget.png).

## 5. P3 — Today places all-time project hours beside today's clock-in without a label

1. Open [Today](https://serviceflowapp.com/).
2. Richard Labrèche's card shows Burim **in at 7:49 a.m.**, with **13h 40m** beside it around 1:41 p.m.
3. Open the job's Labour budget tab. The time log shows approximately **5h 53m today** and **7h 48m yesterday**.

Expected: clearly distinguish today's shift duration from cumulative hours on the job. Actual: the unlabelled cumulative figure looks like today's shift duration. This is a presentation issue; the evidence does not establish incorrect time entries.

Source confirmation: `web/src/app/(app)/page.tsx` sums the painter's project history; `web/src/components/today-board.tsx:89` and `:92` place today's clock-in and the cumulative total side by side.

Evidence: [Today](today-hours.png), [time log](job-labour-budget.png).

## Coverage and limits

Walked through Today, Labour, job detail and its Labour budget tab, Customers search, Sales Pipeline search, Appointments and an existing appointment modal, Job Schedule, proposal list/status filters and an existing draft editor, Photos and next-photo navigation, and the Sales report. Photo navigation, pipeline name search, and Sales report rendering worked in the exercised cases. No captured browser console errors were returned during the inspected session.

Not tested: saving or deleting records, sending messages/proposals, uploads, customer acceptance/payment, permissions across roles, mobile layouts, or the separate canonical Vercel hostname. This is not a complete end-to-end certification. No implementation fixes were made.
