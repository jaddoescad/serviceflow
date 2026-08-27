# Hermes hardening checklist

Last updated: 2026-08-20 (America/Toronto)

| Priority | Work item | Status | Completion evidence |
| ---: | --- | --- | --- |
| 1 | Backups and recovery | **Completed** | Recovery archive created, downloaded, SHA-256 recorded, and ZIP integrity verified locally and on the Hermes host. Restore procedures are documented below. |
| 2 | Patch security vulnerabilities | **Deferred — Nous ticket open** | The post-resize audit still reports 12 Python advisory records, including high-severity findings in `aiohttp` 3.14.1 and `cryptography` 48.0.1. Doctor also reports high-severity npm findings in the agent-browser, web, and ui-tui workspaces. `/opt/hermes` is image-owned and read-only. Nous ticket `T-2255` remains open, but active follow-up is paused while other hardening work proceeds. |
| 3 | Slack user allowlist | Not started | Configure and verify approved Slack operators. |
| 4 | Separate Hermes profiles | **In progress** | The isolated email profile is complete; dedicated operations, deployment, and marketing profiles remain. |
| 5 | Isolated email-triage profile and automatic tagging | **Live deployed and healthy** | Live add-only tagging is enabled every five minutes. The August 14 Gmail 404 retry loop was patched and the catch-up queue was drained: 32 Hermes classifications are complete, backlog/errors/incomplete records are zero, no multiple-primary-label condition occurred, and two subsequent empty polls woke no model. The separate five-minute contractor-invoice intake is live; its August invoices are itemized and assigned only from exact printed job evidence. |
| 6 | Remove unnecessary skills and terminal access | **Completed** | The Slack daily profile is limited to five toolsets and 7 of 80 installed skills. A fail-closed pre-tool hook restricts terminal commands to approved Ottawa operations and read-only diagnostics; a real Slack `pwd` test was blocked without producing output. |
| 7 | Monitoring and failure alerts | **Completed** | Script-only job `0f2318f9f1bb` checks Meta API access, Meta backend freshness, Slack, Gmail, scheduled-job health, Meta-report freshness, Gmail intake health, and the daily DripJobs Jobs + Sales operations sync. Failure, one-time recovery, and silent-healthy paths were exercised after deployment. |
| 8 | Ottawa Painters operating playbook | Not started | Document policies, approvals, and systems of record. |
| 9 | Confirmations for sensitive writes | Not started | Require confirmation for high-impact employee, payroll, and customer changes. |
| 10 | Stronger model for selected tasks | Not started | Route sensitive or complex analysis to an appropriate model. |
| 11 | Daily DripJobs operations sync | **Live deployed and healthy** | The database holds all 1,469 exact Sales Deal IDs (70 active, 1,399 archived). Job `c26e43bc139b` runs daily at 6:00 AM Toronto with an overlapping seven-day Changed Date delta instead of re-reading all historical deals. |
| 12 | Meta Ads backend sync | **Live deployed and current** | Campaign/day facts are backfilled through August 20, 2026. Hermes refreshes a rolling 14-day window every four hours with stable upserts, raw action provenance, and dashboard-safe daily spend, lead, CPL-input, impression, click, link-click, and landing-page-view fields. |

## Current work

- [x] Create and verify a recoverable Hermes backup.
- [x] Document the recovery procedure without copying secrets into this repository.
- [ ] Apply the known vulnerable Hermes dependency upgrades. Attempted, but the hosted image rejected the write with permission denied.
- [x] Restart the Hermes gateway.
- [x] Resize Hermes Cloud from Small to Medium (4 shared CPUs, 2 GB RAM, 10 concurrent sessions).
- [x] Rerun the current-state security audit, dependency check, Doctor, gateway check, and Slack channel check after the resize.
- [x] Send Nous Support the managed-image patch request with exact versions, findings, instance URL, permission error, and `/opt/data` preservation requirement.
- [x] Receive Nous Support acknowledgment and ticket reference `T-2255`.
- [x] Pause the 30-minute ticket monitor while other hardening priorities proceed.
- [x] Restrict the everyday Slack profile to approved Ottawa skills and toolsets.
- [x] Verify from a real Slack message that an unapproved terminal command is blocked.
- [x] Install failure monitoring for Meta Ads, Slack, Gmail, scheduled jobs, and Meta-report freshness.
- [x] Replace the missed managed Chronos trigger with Hermes's verified in-process scheduler and restore a 30-minute cadence.
- [x] Create and verify the isolated Gmail read/analyze/add-label profile.
- [x] Simplify Gmail to fourteen working labels under six collapsible parents and preserve a reversible migration manifest; `Commercial Inquiries` was restored on August 14 for tenders and commercial bids.
- [x] Deploy the Gmail history cursor, two-day 404 recovery, deterministic rules, leases, deduplication, audit log, bounded classifier, and five-minute scheduler in dry-run mode.
- [x] Switch `HERMES_EMAIL_INTAKE_MODE` to `live` after the user explicitly waived the remaining 24-hour wait; verify a real batch, an empty no-model run, duplicate suppression, add-only writes, and the failure monitor.
- [x] Patch the Gmail intake loop so deleted/unavailable message IDs are safely audited and skipped instead of blocking later mail; deploy the checksum-verified library, drain the live catch-up queue, and verify monitor recovery.
- [x] Deploy the contractor-invoice intake from Gmail to Admin Labour Invoices with attachment evidence validation, exact contractor matching, unpaid/needs-review defaults, database deduplication, and failure monitoring.
- [x] Backfill the seven verified August contractor invoices, confirm all seven in the live Labour Invoices UI, and resume the five-minute intake.
- [x] Replace the Invoice List workflow with a strict two-view DripJobs Jobs List validator, exact-proposal importer, isolated browser profile, and daily 6:00 AM Toronto job (`c26e43bc139b`).
- [x] Prove the DripJobs guardrail rejects wrong pages, incomplete views, duplicate proposals, bad arithmetic, and failed downloads before the importer runs, and delivers a concise Slack failure.
- [x] Switch `HERMES_DRIPJOBS_SYNC_MODE` from `dry-run` to `live`; verify the combined amount/production-month import, database invariants, an idempotent second run, monitor recovery, and a subsequent silent healthy monitor run.
- [x] Extend the same guarded run to capture active and archived Sales List `All` views, exact Deal/Contact IDs, sources, stages, sales status, deal amounts, and salespeople.
- [x] Refresh job schedules, actual dates, invoice paid/balance fields, salespeople, project managers, and crews from the authoritative Jobs List rows without changing locked historical accounting.
- [x] Backfill all 1,469 active and archived Sales Deals into a lossless one-row-per-Deal-ID table; retain 516 unmatched historical deals without guessing a lead link.
- [x] Replace the daily all-time Sales List design with a seven-day Changed Date delta that catches active, archived, cancelled, and stage-changed deals through exact Deal-ID upserts.
- [x] Run the uploaded Hermes delta deployment, verify the schema-v5 live Jobs/Sales sync, and leave the permanent 6:00 AM job scheduled.
- [x] Backfill Meta campaign/day performance into the backend through today and deploy the four-hour rolling refresh.
- [x] Correct the Meta summary grain so campaign, ad-set, and ad rows cannot triple-count spend or leads.
- [ ] Receive a human confirmation that Nous deployed the patched image.
- [ ] Rerun the security audit and health checks after the managed image is patched.
- [x] Rewrite this table with completed work, the current blocker, and remaining priorities.

## Platform action required

1. Have Nous deploy or rebuild the Hermes Cloud image with `aiohttp` >=3.14.3, `cryptography` >=50.0.0, and remediated npm lockfiles for the agent-browser, web, and ui-tui workspaces.
2. Replace or restart the hosted instance while preserving `/opt/data`.
3. Verify the installed versions, run `uv pip check`, rerun the security audit, and confirm Slack and scheduled jobs are healthy.
4. Mark priority 2 complete only after those checks pass.

The Nous Cloud portal exposes resize and configuration recovery controls, but no image-update control. Its recovery action only replaces `config.yaml`, so it cannot patch the image.

Support escalation sent to `support@nousresearch.com` on August 12, 2026 with subject **Security patch request — Ottawa Painters Hermes Cloud**. The request asks Nous to deploy the patched image, preserve `/opt/data`, confirm completion, and identify any future self-service image-update control. Nous acknowledged receipt under ticket `T-2255`; the acknowledgment is automated and does not prove that the image has been patched. The ticket monitor is paused while other hardening priorities proceed.

## Everyday tool restriction

- Slack toolsets: `terminal`, `skills`, `memory`, `session_search`, and `clarify` only.
- Enabled skills: 7 of 80, all Ottawa Painters operational skills. The deployment skill remains disabled for daily use.
- Globally disabled toolsets include web/browser, file and code execution, media generation, delegation, cron editing, computer use, and unrelated integrations.
- Fail-closed hook: `/opt/data/agent-hooks/ottawa-tool-policy.py` blocks arbitrary shell commands and privileged tool actions while allowing the Ottawa CLIs, the two bounded email-intake interfaces, bounded exact-message reads, the Meta report, the health monitor, and read-only Hermes diagnostics.
- Live proof: a human-authored Slack request asked Hermes to run `pwd`; Hermes reported that the policy blocked it and produced no command output.

## Failure monitoring

- Job: `Hermes failure monitor — every 30 minutes` (`0f2318f9f1bb`).
- Schedule: `*/30 * * * *`; the next verified run after deployment was 10:30 AM America/Toronto.
- Mode: no-agent/script-only, so healthy runs use no model and send nothing.
- Checks: Meta Marketing API connectivity, Meta backend campaign-date/capture freshness, Slack authentication, Gmail label API, scheduler state, scheduled-job errors, Meta report delivery errors, a 26-hour Meta report freshness threshold, Gmail intake health, and DripJobs Jobs List live-sync freshness/validation/errors.
- Alert behavior: changed failures post to the Hermes Slack home DM; unchanged failures repeat after six hours. Recovery posts once when all checks return healthy. If Slack is down while Gmail is healthy, a fallback email is sent to `info@paintersottawa.com`.
- Verification: live self-test returned all monitored services; simulated failure output was concise; automatic in-process scheduler runs correctly suppressed Slack delivery. After live email rollout, a manual monitor run at 3:18:18 PM returned empty healthy output and sent no Slack message.
- DripJobs recovery verification: after the Jobs List rollout, the monitor sent one recovery at 2:52:50 PM on August 16; its immediate 2:53:49 PM rerun produced empty stdout and skipped Slack delivery, proving normal healthy operation is silent.
- Scheduler correction: the hosted Chronos provider missed the new job's automatic test fire. `cron.provider` was changed to the built-in scheduler, the Cloud instance was fully stopped and started, and startup logs confirmed `In-process cron scheduler started (interval=60s)` plus Slack Socket Mode connected.

## Isolated email profile

- Profile: `email`, rooted at `/opt/data/profiles/email`; the existing default/Slack profile was not replaced.
- Model: `deepseek/deepseek-v4-flash` through the existing Nous Portal connection.
- Enabled skills: 1 of 1, `ottawa-email-triage`.
- Read path: `/opt/data/bin/ottawa-gmail-read` performs bounded Gmail GET requests and cannot modify Gmail. Exact-message reads may temporarily download up to three allowlisted attachments (PDF, JPEG, or PNG; 5 MB each) solely for evidence extraction. PDF reads are capped at five pages and all extracted attachment evidence is capped at 6,000 characters; temporary files are mode `0600` and deleted after extraction.
- Write path: `node /opt/data/bin/ottawa-email-intake-cli.mjs classify` can add exactly one existing user label in `HERMES_GMAIL_LABEL_ALLOWLIST` for an active audit lease; it cannot remove labels or send, archive, delete, or change read state.
- Fail-closed hooks: both the active scheduler gateway and `/opt/data/profiles/email/agent-hooks/ottawa-email-tool-policy.py` permit only bounded Gmail reads and the two audited intake interfaces needed by this workflow; they block direct label writes, shell composition, and unrelated tools.
- Live verification: `HERMES_EMAIL_INTAKE_MODE=live`; audit database run 3 completed successfully at 3:15:19 PM and the job completed at 3:15:52 PM. Across 62 completed message records, Hermes applied 17 model decisions and skipped 45 existing-label records. Backlog was zero, consecutive errors were zero, and no record reported multiple working labels.
- August 14 incident and repair: Gmail history included unavailable message IDs. Before repair, one HTTP 404 aborted every batch and caused 178 consecutive failures after the last successful poll at 4:00 PM on August 13. The intake library now treats only per-message Gmail 404s as audited `missing_message` completions, continues the batch, advances the history cursor, and applies the same safe completion when a leased message disappears before classification. Non-404 Gmail errors remain fail-closed.
- Post-repair live evidence: runs 192-194 succeeded and drained the catch-up queue; 18 unavailable IDs were safely skipped, 15 real messages were classified by Hermes, 4 non-inbox messages were excluded, and 2 already-labeled messages were skipped. Runs 195 and 196 were empty no-model polls. At 7:00:24 AM the health record showed live mode, backlog 0, consecutive errors 0, and no last error; the audit database showed 0 incomplete messages, 0 pending sync IDs, and 0 multiple-primary-label records. The failure monitor cleared its fingerprint and recorded healthy recovery at 7:00:24 AM.
- Recovery copy: `/opt/data/backups/email-profile-2026-08-12.tar.gz`; temporary root upload staging files were removed after the archive was verified non-empty.
- Automatic intake commands: `node /opt/data/bin/ottawa-email-intake-cli.mjs poll` and `classify`; neither supports send, reply, forwarding, archive, delete, read-state changes, or following links. Attachment access is read-only and bounded by the exact-message reader described above; attachment text is treated as untrusted evidence and is never stored in the audit database.
- Automatic schedule: `Automatic Gmail tagging — every 5 minutes`, `*/5 * * * *`, Local delivery, no email digests, one email skill, terminal toolset only.
- Hermes Cloud runner note: alias-profile cron queues are not consumed while the alias gateway is stopped. The production scheduler therefore runs on the active gateway with the same single skill/toolset and bounded pre-check; manual email work remains isolated in the `email` profile.
- Rollout: `HERMES_EMAIL_INTAKE_MODE=live`. The user explicitly directed immediate activation on August 13 and thereby waived the remaining 24-hour dry-run duration and reviewed-agreement gate; this waiver is not recorded as a 24-hour acceptance pass. Deterministic fixtures pass 117/117 after restoring commercial-tender routing. Live run 4 at 3:18:18 PM found zero candidates, woke no model, made no duplicate writes, and left backlog/errors at zero. The failure monitor completed silently healthy at the same minute.
- Taxonomy rollback manifest: `hermes/migrations/gmail-taxonomy-2026-08-12.json`, copied live to `/opt/data/backups/gmail-taxonomy-2026-08-12.json`. The live allowlist contains stable Gmail label IDs for exactly fourteen working labels; parent labels are never applied.
- New backup before rollout: `/opt/data/backups/hermes-backup-2026-08-12-211249-a8c4e8e2.zip`.
- Attachment-classification rollout (August 14): backup `/opt/data/backups/hermes-backup-2026-08-14-112805-9cae1c3f.zip` was created before deployment. Live capability output returned `pdf_text: true`, `image_ocr: false`, and the allowlisted MIME types `application/pdf`, `image/jpeg`, and `image/png`. Bilal Akkacha's exact message `19ffd63af982bf0e` was read through the bounded GET-only command: `Invoice_8_2026-08-28.pdf` returned positive invoice evidence and was corrected to `Finance/Contractor invoices`. The sender `fennecps@outlook.com` and invoice-like attachment filenames are covered by the deterministic contractor-invoice rule for future mail.
- Attachment safeguards and regression evidence: 55/55 CLI and intake tests passed, including magic-byte validation, size/page/character limits, temporary-file cleanup, prompt-injection containment, GET-only attachment retrieval, deterministic Bilal and commercial-tender classification, and blocked unsafe terminal commands. The email skill passed `quick_validate.py`. Digital-PDF text extraction is live; image-only/scanned documents remain filename/metadata-based because server-side image OCR is intentionally unavailable.
- Scheduler verification after the attachment deployment: the gateway remained Running; the Gmail job remained scheduled at `*/5 * * * *`, completed its 7:40:59 AM run on August 14, and showed the next run at 7:45 AM. The live health record and audit database were updated at 7:40 AM.
- Commercial-inquiry restoration (August 14): Gmail label `Commercial Inquiries` was recreated as stable ID `Label_42`, added to `HERMES_GMAIL_LABEL_ALLOWLIST`, and added to both deployed email-triage skill copies. The deterministic rule covers Procore, BuildingConnected, SmartBid, ConstructConnect, and MERX bid/tender mail plus explicit bid-invitation, RFP, and RFQ subjects while leaving ordinary customer proposals for model classification. The Aerie/Bayshore Procore tender was corrected to exactly `Commercial Inquiries`; an overlapping pre-deployment scheduler decision briefly added `Client Communication`, which was removed during verification. The gateway restarted successfully and the tagging job completed its triggered 8:08:50 AM run.

## Contractor invoice intake

- Job: `Contractor invoice sync — every 5 minutes` (`ef447827f14a`), scheduled on the active Hermes gateway with only the `ottawa-email-triage` skill and terminal toolset. The exact Gmail source label is `Finance/Contractor invoices` (`Label_7335250296000113022`).
- Scope: new incoming messages carrying that label only. The first live poll establishes a cursor and never backfills older mail. Existing Bilal and other historical messages therefore were not converted into payables during rollout.
- Evidence and identity: Hermes reads bounded PDF, JPEG, or PNG attachment content as untrusted evidence. Supplier identity must independently match an exact contractor email, an authenticated fixed supplier alias, or an authenticated approved invoice platform plus exact supplier evidence. Every write also requires an invoice number, issue date, labelled totals, and valid subtotal/tax/total arithmetic. Multiple `Authentication-Results` and ARC verdicts are preserved so a provider-added header cannot hide Gmail's DMARC verdict.
- Result: one canonical v2 payable-labour invoice with status `recorded`, `paid_cents=0`, `balance_cents=total_cents`, itemized printed work lines, a private archived source document, and an audit event. Each line may create one job assignment only when a printed customer name, street address, or proposal number exact-matches exactly one eligible current job. Missing or ambiguous evidence stays `Unassigned`; Hermes never guesses. It never creates a payment, bank match, contact, or Gmail mutation, and the June 1 historical-accounting lock remains enforced.
- Deduplication: SQLite message/attachment leases prevent repeated processing, while live partial unique indexes `invoices_gmail_contractor_invoice_external_uidx` and `documents_gmail_contractor_invoice_sha256_uidx` enforce message and document uniqueness in Supabase.
- Itemized-assignment deployment (August 14): pre-install backup `/opt/data/backups/hermes-backup-2026-08-14-222511-e0e916b6.zip`; Supabase Edge Function `hermes-contractor-invoices` version 3 is active; the main and email-profile skill copies, bounded CLI, and both fail-closed hooks were installed. Hermes now classifies every printed invoice line as an exact current job, explicit `Company expense`, or `Unassigned`; company expenses are never job-assigned and unclear job work is never guessed. The final gateway restart completed at 6:33:39 PM and remained Running. Job `ef447827f14a` completed the final post-deploy live poll at 6:33:52 PM and scheduled its next five-minute run.
- Backfill evidence: seven exact Gmail invoices were repaired from their archived PDFs: XDesign `8611`, `8612`, and `8613`; Fennec `6`, `7`, and `8`; and Grutenco `GT-INV-202608-01`. Supabase confirmed eight printed lines and eight exact current-job assignments: Kim Kim (two), Carina Stark (two), Irene Roberts (two), Barry Dollin, and Tanya Wagdin. Invoice header totals remain unchanged at $7,233.37 subtotal and $7,954.33 gross; every invoice remains unpaid with its full balance, and no payment or bank allocation was created.
- UI and test evidence: production now labels the columns `Where it belongs` and `Assigned` and renders each destination as `Job — amount`, `Company expense — amount`, or `Unassigned — amount`; the Grutenco invoice visibly shows `Barry Dollin — $2,400.00` and `Tanya Wagdin — $1,105.87`. The seven repaired invoices are fully assigned, unpaid, and correctly show that review begins only after payment. Production deployment `E4hSzaznELZ6euySayPFWE3aqJh9` is aliased to `ottawa-painters-dashboard.vercel.app` and was verified in the authenticated live UI. The production build passed; invoice-readiness passed 21/21; the full Ottawa CLI suite passed 68/68; calculator passed 24/24; time CLI passed 5/5; task CLI passed 7/7; and the Edge Function passed `deno check`.
- Contractor-invoice visibility repair (August 15): `/invoices` now includes payable contractor-origin `other` invoices from the legacy and Gmail contractor importers without reclassifying them as labour. The live list shows these as `Company expense`, requires no job allocation, and excludes them from labour percentages. Authenticated production verification proved Caledonian #239609 and Assmaâ #2026-011 are visible; the current list contains 64 current and 163 historical invoices. The Gmail audit found 82 labelled messages since June 1, 72 invoice-like attachment messages, and no genuinely missing invoice after reconciling duplicate/update emails against supplier and invoice number. Production deployment `9igF5qkgd1UcSeUEi2iCwfFJ2JTP` is aliased to `ottawa-painters-dashboard.vercel.app`; build, invoice-readiness 22/22, Ottawa CLI 68/68, calculator 24/24, time CLI 5/5, and task CLI 7/7 all passed.
- Labour-percentage rollout (August 14; authority upgraded August 16): every assigned job destination shows `This invoice N%` from that allocation's before-HST subtotal and `Total labour N%` from all current labour invoices for the job. The denominator is exclusively the authoritative before-HST job amount from the latest validated DripJobs Jobs List `All` exports; archived customer invoices, Invoice List exports, and proposal estimates are not accepted as the current job-amount source. Missing Jobs List-backed authority shows unavailable. Displayed totals below 40% are green, exactly 40% neutral, and above 40% red.
- Carina Stark invoice revision (August 15): authenticated DripJobs invoice #431865 and the newly downloaded seven-page PDF include change order #112737 for Interior Painting - Doors ($337.00 before HST, $43.81 HST). The current archived invoice is $5,439.00 before HST, $707.07 HST, $6,146.07 total, $1,441.32 paid, and $4,704.75 outstanding. The prior $5,102.00 invoice snapshot is retained as void/superseded evidence, its payment and Stripe links were reassigned to the current revision without changing any payment or bank amount, and the current PDF SHA-256 is `fee2a461b52fe897065b003f0dc42e4aae6af4f7e19b7a61a5ba46cbab39ec96`. Production now shows $5,439 verified before-HST revenue, Fennec #7 at 17.7%, XDesign #8612 at 21%, and total labour at 38.6% on both the Labour Invoices list and Carina job page.

## Historical one-time job amount authority import (superseded)

- Source: user-provided `invoicelist.csv`, SHA-256 `d1818c95a1f6ba1f61c1f1629458554382f9ff8b37de47e0830ec2c754e3f90d`, archived privately as document `3125d28a-6562-5c27-bd23-e51651bc557e`. This was the initial August 15 source and is retained as historical evidence; it was superseded on August 16 by the validated DripJobs Jobs List workflow below.
- Rule: the CSV `Amount` is gross including 13% HST; the stored job amount is `round(Amount cents / 1.13)`. Exact proposal-number matching is required. Duplicate proposal rows are never summed or selected by recency, and archived customer invoices are never used to source the amount.
- Applied: 64 current jobs received versioned, provenance-backed budgets; 63 amounts changed and one already-correct amount received authoritative provenance. Database verification found 64 audit events, zero job/budget mismatches, and zero historical-lock violations. An idempotency dry run reports all 64 already applied and zero pending changes.
- Production: deployment `FNiQMoXZTn1pRhg8guYinyafrjCa` is aliased to `ottawa-painters-dashboard.vercel.app`. The authenticated Carina Stark job page shows `$5,439` with `before HST · stored job amount` and `38.6% of job`; the two labour-invoice rows show 17.7%, 21%, and 38.6% total labour.
- Preserved: 119 historical jobs remain unchanged under the June 1, 2026 accounting lock. Eleven proposal groups remain unchanged because no canonical job matched or duplicate CSV rows were unresolved: Erin Lee, Shezara Ali, Christine Leclair, Ian Rothwell, two Jad Slim proposals, Saroeun Cole, Blocked Don't Book, Nick Therien, Claire Colbert, and Shiho mshoshii.
- Representative verified amounts: Carina Stark $6,146.07 gross → $5,439.00 before HST; Irene Roberts $2,211.42 gross → $1,957.01 before HST; Sherrie Egan $4,678.20 gross → $4,140.00 before HST.

## Daily DripJobs operations sync

- Schedule: `Daily DripJobs Jobs List amounts + production month — 6am Toronto` (`c26e43bc139b`) runs daily at 6:00 AM America/Toronto on the active Hermes gateway. It is `no_agent`/script-only, uses `agent-browser` 0.33.1 with a persistent authenticated DripJobs profile, and requires no inference model. The legacy job name is retained so the existing health monitor continues to recognize it.
- Source and validation: Hermes exports active and archived/cancelled Jobs List `All` views. Sales Deals were backfilled once with Created Date = Anytime, Changed Date = Anytime, and All rows: 70 active plus 1,399 archived (1,469 unique Deal IDs). The daily Sales run now uses Created Date = Anytime plus an overlapping Changed Date = Last 7 Days window on both views; the verified August 20 sample was 40 active plus 61 archived rows. Hermes must submit `Go`, select `All`, and prove DripJobs' displayed total and DataTable total both equal the captured row count. Wrong pages, missing controls/columns, partial tables, duplicate IDs, bad amount arithmetic, failed authentication, and failed downloads stop before either live importer.
- Amount rule: match exactly one canonical job by DripJobs proposal ID and store `round(Amount cents / 1.13)` on `jobs.contract_amount_cents` and a versioned current budget. Gross amount, HST, proposal/invoice IDs, both source hashes/documents, and source rows are retained as audit evidence. The rollout corrected Ian Rothwell to 103,857 cents, Christine Leclair to 136,000 cents, and Shezara Ali to 85,500 cents before HST.
- Production-month rule: only Work Finished/Work Complete, Review Request, and Project Complete/Job Completed qualify. Hermes uses the qualifying `Deal Stage Date` month, synchronizes `jobs.production_month` and all associated `job_budgets.production_month`, advances on a later qualifying transition, and never clears or moves a month backward.
- Operational rule: current, exactly matched Jobs List rows also refresh scheduled start/end, actual start/completion, invoice paid/balance, salesperson, project manager, and crew. These operational updates use the same historical cutoff and concurrency checks as amounts and production months.
- Lead rule: every Sales List row is stored by its exact Deal ID whether or not a lead can be linked. A lead link is accepted only from the true Sales Deal ID, the exact event Deal ID, or a legacy Contact ID that has exactly one lifetime deal. No fuzzy customer matching is used. The first backfill exposed 139 multi-deal contacts that had been linked by legacy Contact ID; those lead values and links were restored from their recorded pre-backfill audit values.
- Safety and verification: the canonical Sales Deal table contains 1,469 rows, with 953 exact lead links and 516 intact unlinked historical deals. The daily 101-row delta applied 89 authority refreshes, zero lead value changes, persisted all 101 rows, and left the canonical count at 1,469; an immediate repeat dry run reported zero pending changes. The June 1 historical job accounting lock remains unchanged.
- Hosted rollout state: the schema-v5 package installed successfully at 4:01 PM on August 20. The live health record reports accepted Jobs and Sales exports, 1,469 canonical deals, and the small seven-day delta scope. The permanent 6:00 AM job and monitor IDs remain `c26e43bc139b` and `0f2318f9f1bb`.
- Credential isolation: the Supabase backend credential remains only in `/opt/data/hermes-job-amounts.env`, outside global Hermes Keys/provider configuration and browser/client code.

## Meta Ads backend sync

- Source: the existing read-only Meta Marketing API connection on Hermes. No token is stored in the repository, browser code, logs, or database.
- Storage: `marketing_performance` now has stable daily campaign identity on account/date/campaign, raw Meta action arrays and API provenance in metadata, and explicit spend, leads, impressions, clicks, link clicks, landing-page views, and capture timestamps. The existing 2026 history was retained and refreshed; current rows now extend through August 20 instead of stopping on August 1.
- Summary safety: `marketing_summary` now aggregates campaign rows only, preventing the previous campaign + ad-set + ad triple count. `marketing_daily_summary` exposes raw daily numerators and denominators plus derived CPL input; `campaign_reach_sum` is named explicitly because reach is not deduplicated across campaigns.
- Schedule: `Daily Meta Ads backend sync — every 4 hours` is a no-agent/script-only Hermes job. Each run re-reads only the latest 14 days, so late Meta attribution changes are corrected without re-fetching all history.
- Live verification: the permanent job completed at 4:15 PM on August 20. Supabase held 335 daily campaign rows through August 20 with a fresh 4:15 PM capture; August 1 summary spend exactly matched the campaign rows, proving the duplicate-grain correction.

## Hermes Desktop inference repair

- The Supabase credential was unrelated to the Desktop inference error. Hermes Cloud's default profile already used `deepseek/deepseek-v4-flash` through Nous Portal, and a post-restart Cloud test completed successfully in 1.5 seconds.
- The local Nous token had expired on August 15. A local Hermes one-shot refreshed it and returned `Hermes local online.`; status then showed a current Nous access token and the local provider/model remained configured.
- Desktop had selected the stopped `dripjobs-sync` automation profile, which originally had no model and produced `No inference provider configured`. The profile now has `deepseek/deepseek-v4-flash` assigned for clarity, but remains stopped because the daily sync is a script-only job on the active gateway.
- Desktop was left on the running default `Hermes` bot. A real Desktop message returned exactly `Hermes Desktop online.`, proving current inference works in the app.

## Post-resize verification

- Nous Cloud: **Medium**, Running / Healthy.
- Host resources: 4 cores; 792.1 MB / 1.9 GB memory (40.3%) immediately after restart, versus 96.3% during the earlier audit on Small.
- Hermes gateway: Running.
- Slack: Connected and enabled.
- Python dependency graph: all 136 installed packages compatible (`uv pip check` passed).
- Vulnerability audit: **not clean** — 12 advisory records remain across `aiohttp` 3.14.1 and `cryptography` 48.0.1; required fixed versions are `aiohttp` >=3.14.3 and `cryptography` >=50.0.0.
- Doctor: core services, configuration, SSL, Python, supervision, and Nous authentication passed; high-severity npm findings remain in agent-browser (2), web (4), and ui-tui (2).

## Backup and recovery evidence

- Created: 2026-08-12 11:30:06 UTC.
- Hermes path: `/opt/data/backups/hermes-backup-2026-08-12-113006-444478e8.zip`.
- Downloaded recovery copy: `/Users/jadslim/Downloads/hermes-backup-2026-08-12-113006-444478e8.zip`.
- Size: 155,009,457 bytes (approximately 147.8 MiB).
- SHA-256: `5b37f1586582a59610e957f5fa8182ffa666297e7926d911f442502e49b94921`.
- Integrity: PASS using both the host-side ZIP test and local `unzip -tq`.
- Contents verified: live `config.yaml`, `.env`, state databases, cron jobs and executions, `SOUL.md`, `MEMORY.md`, `USER.md`, and the Ottawa Painters Hermes skills.
- Known backup warning: the host skipped the root-owned duplicate snapshot `portal-recovery/snapshots/last-ready/config.yaml`. The live `config.yaml` and `portal-recovery/baseline/config.yaml` are present, so the downloaded archive remains the verified recovery source.

## Recovery procedure

1. Sign in to the Hermes dashboard and open **System**.
2. Under **Restore from backup upload**, choose the downloaded ZIP listed above.
3. Run **Restore upload** and wait for the restore action to finish.
4. Restart the Hermes gateway.
5. Run **Doctor** and **Security audit**, then confirm Slack and the scheduled Meta Ads job are healthy.

The server-side path can also be entered under **Restore from backups path** if that archive is still present. Prefer the downloaded copy when recovering from a server replacement.
