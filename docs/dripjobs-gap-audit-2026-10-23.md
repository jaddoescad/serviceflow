# DripJobs → ServiceFlow gap audit

Reviewed October 23, 2026, America/Toronto.

## What was reviewed

Explored the signed-in DripJobs account in Chrome: contacts, chat, email inbox, tasks, sales pipeline and filters, deal detail, job schedule and scheduling dialog, drips and drip editor, booking forms and form configuration, products/services, crews, company settings, payments, integrations, notifications, and a customer proposal preview with tracking disabled. Compared those screens with the running ServiceFlow app at localhost:3100 and the current working-tree implementation, including today's uncommitted update.

This is a product/workflow audit. It does not certify production deployment, message delivery, payment processing, or synchronization. No records were saved, messages sent, integrations connected, or transactions performed. Priority is a judgment about daily usefulness. A control observed in DripJobs establishes that the product exposes the capability, not that the account's integration works end to end.

## Main finding

ServiceFlow already has the main sections. The largest gaps concern completing the workflow around those sections: receiving replies, reminding customers about actual dates, carrying over active work, presenting a complete proposal, and connecting calendars and lead sources.

Do not rebuild existing capabilities: sales/jobs boards **and list views**, custom stages, source/label/salesperson pipeline filters, proposals and templates, optional line items, deposits, customer signatures, change orders, invoices and manual payment records, work orders, calendars and a pending-schedule list, deal notes and outbound messages, per-deal drip pausing, metrics/reports, photos, painter tasks, and crew time tracking already have implementations. Existing implementations were not exhaustively transaction-tested in this audit.

## Existing features that need setup or a transition plan

| Finding | Evidence | Recommended next step |
| --- | --- | --- |
| Sales drips are not configured in the inspected ServiceFlow session | Every sales stage displayed zero steps; the selected stage said drips were off. DripJobs contains configured sequences with existing copy. | Recreate the approved operational follow-ups deliberately. Review enrollment and queued messages before enabling them so both systems do not contact the same customer. |
| ServiceFlow SMS is not connected in the inspected session | Settings explicitly said texts are skipped until Quo is connected. | Configure each company's own approved Quo sender, then test with an authorized test contact. This is setup, not a missing SMS sender. |
| Calendar continuity needs checking | The inspected ServiceFlow October appointment calendar was empty. DripJobs exposes scheduled estimates and an active Google Calendar connection. | Reconcile upcoming appointments, jobs, ownership and dates before relying on the new calendars. This observation does not establish that every appointment is absent. |
| Imported proposals still depend on DripJobs for editing | The proposal editor makes imported proposals read-only and says to edit them at their source. | Define how an active imported proposal gets a new native revision, preserving the original and customer acceptance history. Do not silently overwrite imported or signed records. |

## Highest-value gaps

| Priority | Gap | DripJobs evidence | ServiceFlow today | Smallest useful addition |
| --- | --- | --- | --- | --- |
| High | **Shared incoming SMS inbox** | Chat has customer conversations, incoming messages, unread counts and attachment controls. The same conversation is available in deal detail. | Deal communications use the outbound queue; no inbound SMS ingestion or shared inbox was found in the reviewed implementation. | Receive company-scoped replies, match them to customers, show unread conversations, and reply from the deal or inbox. |
| High | **Incoming email and reply routing** | Email offers a centralized inbox, contact matching and team replies/internal notes. Reply routing is currently off in this DripJobs account. | Outbound email supports a reply-to address, but ServiceFlow does not capture and display incoming replies. | Route replies into a customer thread while retaining a usable office reply-to path. |
| High | **Appointment/job reminders tied to dates** | Reminders supports email/SMS at configurable intervals before appointments/jobs. One-day appointment reminders were enabled. | Drips are delayed from stage entry. No customer reminder engine tied to appointment/job start times was found. Existing crew clock-in reminders serve a different purpose. | Start with a one-day appointment reminder; requeue correctly after rescheduling and cancel it when the appointment is cancelled. |
| High | **Scheduling/rescheduling confirmations** | The Schedule Job dialog includes Send Email and Send SMS controls; chat showed appointment rescheduling and job-start notices. | Job scheduling saves dates; the scheduling flow does not offer a corresponding customer notification. | Offer a confirmation when saving or changing dates, using the final saved schedule. |
| High | **Google Calendar connection** | Settings reports a connected calendar for appointments and the job schedule. Calendar settings also expose Google Event as an appointment type. | No Google Calendar connector or calendar-sync implementation was found. | Begin with a clearly defined write-to calendar and update/cancellation handling. Confirm sync direction before promising two-way parity. |
| High | **Sales/customer event notifications** | Configurable notifications include appointments, proposal viewed/accepted/rejected, invoice viewed/paid and chat received. | Crew operational push functions exist, but comparable CRM notification settings and event coverage were not found. | Notify the responsible person about incoming replies and accepted proposals first; make view notifications optional. |
| High | **A complete customer-facing proposal** | The inspected portal displays selected project photos, branded content, supporting documents/insurance, company information and a PDF download. | Public documents show company/customer text, line items, totals, terms and acceptance. They do not render the project's existing photos/documents or a branded content library. | Allow explicit selection of photos and supporting documents for each proposal, plus a logo and a reliable PDF/download path. Project files must not become public automatically. |
| High | **Richer estimate request form** | Booking forms support photo attachments, preferred appointment dates/time of day, custom questions, allowed weekdays, multiple forms and embed code. | The public request form contains name, email, phone, address and a free-text description. | Add project photos, preferred visit dates and a few configurable questions. Retain a simple default form. |

## Workflow depth and missing views

| Priority | Gap | Evidence and current limitation | Useful scope |
| --- | --- | --- | --- |
| Medium | **Reusable products/services catalog** | DripJobs has categorized products/services, pricing, taxable flags and duplicate actions. ServiceFlow has whole-proposal templates and calculator lines, but no independent item catalog. | Reuse individual scope descriptions and prices across proposals without maintaining many nearly identical templates. |
| Medium | **Multiple sequences per stage** | DripJobs shows two sequences under Warm Leads and allows changing a deal's sequence. ServiceFlow has one set of steps per stage. | Choose a follow-up sequence by customer situation or form, while retaining a default. |
| Medium | **Richer message personalization** | DripJobs exposes salesperson/project manager, appointment/job date, invoice and review placeholders. ServiceFlow advertises five placeholders: first name, name, company, company phone and proposal link. | Add dates, assigned-person details and the relevant document link before expanding the editor further. |
| Medium | **Drip previews and test sends** | The DripJobs editor has email/text previews and Send Test Email. ServiceFlow's editor has no equivalent. | Preview substituted values and send to a designated test recipient without enrolling a real customer. |
| Medium | **Delivery and engagement visibility** | DripJobs displays email open rates per drip and offers viewed-document notifications. ServiceFlow stores document viewed timestamps and outbound send states, but no comparable drip open-rate or provider-delivery dashboard was found. | Distinguish queued, provider-accepted, delivered and failed where the provider supports it. Preserve existing document view information. |
| Medium | **Customer communication preferences** | DripJobs contact filters distinguish blasts, drips, reminders, all email, invalid details and suppressed email. ServiceFlow supports unsubscribe and per-deal drip pause, but not a customer-facing preference center for those categories. | Show clear email/SMS preferences and make incoming opt-out events visible. This audit did not test provider STOP behavior. |
| Medium | **Named crews and timed job scheduling** | DripJobs has named/color-coded crews; the scheduling dialog assigns crew and project manager and includes start/end times. ServiceFlow assigns individual people and schedules jobs with dates. | Reusable crew selection and job start/end times, without changing individual time-entry tracking. |
| Medium | **Appointment types and filters** | DripJobs has estimates, walkthroughs, site visits, punch-outs, quality control and payment collection, with colors and event-type filtering. ServiceFlow appointments have a title but no event-type field. | A small configurable type list and filter; avoid separate pages for each type. |
| Medium | **Saved/date-based pipeline views** | DripJobs filters include presets, created date and changed date. ServiceFlow already has board/list, search, source, label and salesperson filters. | Add date ranges and reusable views such as “My recent leads.” Stale-deal queues are a useful inference, not a separately verified DripJobs feature. |
| Medium | **Contact segmentation and bulk tools** | DripJobs contacts expose type/source/salesperson/status filters, archived contacts, import/export and bulk actions. ServiceFlow's customer table provides search and pagination. | Add the few useful filters, CSV export and targeted bulk assignment. Do not duplicate pipeline filters unnecessarily. |
| Medium | **Packages, discounts and expiration** | The DripJobs proposal editor exposes packages, Apply Discount, an expiration date and Duplicate Proposal. ServiceFlow has optional lines and templates, but no explicit package/discount/expiry controls or duplicate-proposal action in the reviewed editor. | Treat these as separate increments. Add duplication and expiry first if those match the actual quoting workflow. |
| Medium | **French customer experience** | The inspected customer portal offers French and French (Canada) via translation; the editor has a language control. ServiceFlow public document/form strings are English. | Start with reviewed English/French interface text and company-approved bilingual templates. Do not assume automatic translation of contract terms is sufficient. |
| Medium | **One customer portal across documents** | DripJobs's customer preview links to My Proposals, My Invoices, Request Appointment and Email Settings. ServiceFlow has separate private links per document. | Give customers a clear way to find their current documents and requests with appropriate access checks. |
| Medium | **Document send-status clarity** | ServiceFlow's share dialog can mark a document sent and copy its link before a separate email/text action queues delivery. | Clearly separate link publication from actual sending so staff can see which customer has really been contacted. This is a code-observed workflow issue, not a delivery failure reproduced by sending a real message. |

## Integrations and optional extras

| Priority | Candidate | Assessment |
| --- | --- | --- |
| Medium | **General lead intake/webhooks or Zapier** | DripJobs exposes Zapier workflows for Facebook Lead Ads, Google Ads, Sheets and webhooks. ServiceFlow already receives DripJobs events and has a public request form, but no company-facing general automation setup was found. The useful gap is letting approved lead sources feed ServiceFlow directly when DripJobs is retired. Do not label all external intake as absent. |
| Optional | **Online deposits and invoice checkout** | DripJobs's Payments tab shows a connected card-payment provider and deposit/invoice controls. ServiceFlow supports recording payments and displaying balances but has no checkout in its public invoice component. This requires a separate ownership decision: Ottawa Painters accounting/payment tooling remains in its separate repository. An approved handoff can be more appropriate than building a second ledger here. |
| Optional | **Review requests and aftercare content** | DripJobs offers a review placeholder/link; existing chat shows post-job review and satisfaction follow-ups. ServiceFlow's current drips can already send a hardcoded review link. The gap is a reusable company setting, suitable placeholders and tested timing, not an entirely missing follow-up mechanism. |
| Optional | **Call history and transcripts** | DripJobs exposes a Quo integration described as call tracking/transcripts; it is not connected in the inspected DripJobs account. ServiceFlow's own company-scoped Quo sender is narrower. Consider only a separately approved ServiceFlow integration; do not pull Ottawa Painters' Quo/Hermes tooling into this repository. |
| Low | **Route optimization** | DripJobs exposes Routemize as an optional integration; it is not connected. This may help high-volume estimating routes, but is not needed to complete the current core workflows. |
| Low / eligibility unverified | **Customer financing** | DripJobs exposes Acorn Finance. Account, geographic and merchant eligibility were not verified. Treat this as a possible later integration, not a recommendation to copy it for Canadian customers. |

## Differences that should not automatically become backlog

- **Office tasks/to-dos, blasts and the global activity feed:** the current migration explicitly says these were not wanted and removes them. DripJobs has these surfaces, but that does not make their removal a mistake. Painter production tasks remain a separate existing feature.
- **Production rates:** ServiceFlow already has a calculator and rates interface. A separate DripJobs-style page would need a demonstrated workflow benefit.
- **QuickBooks and full material/subcontractor accounting:** DripJobs exposes these, but Ottawa Painters business accounting belongs in `ottawa-painters-admin` under the current ownership rule. ServiceFlow's job-cost table explicitly excludes materials and reports profit after labour. Do not copy historical accounting, supplier allocations or receipts into ServiceFlow to chase parity.
- **CompanyCam:** ServiceFlow already has imported photos and its own crew capture. The concrete gap is selecting existing media for customer proposals, not rebuilding photo storage or assuming no integration exists.
- **Academy or another broad AI assistant:** not a priority gap. Existing calculator AI and operational workflows should be evaluated on their actual usefulness before adding more AI UI.

## Suggested order

1. Finish the operational transition: approved drip copy/configuration, company messaging setup, upcoming appointments/job dates, and a native revision path for active imported proposals.
2. Close the customer communication loop: inbound SMS/email, responsible-person notifications, date-based reminders and scheduling confirmations.
3. Connect calendars and improve intake: Google Calendar, project-photo requests and preferred appointment dates.
4. Improve quoting: selected media/supporting documents, reusable scope items, then the specific quoting controls the team actually uses.
5. Add saved views, richer sequence selection and direct lead-source integrations after the main flow is reliable.

## Evidence pointers

DripJobs screens inspected (signed-in access required): [Chat](https://app.dripjobs.com/chat), [Email](https://app.dripjobs.com/email), [Reminders](https://app.dripjobs.com/reminders), [Drips](https://app.dripjobs.com/drips), [Booking Forms](https://app.dripjobs.com/bookingform), [Job Schedule](https://app.dripjobs.com/schedule), [Products & Services](https://app.dripjobs.com/products), [Crews](https://app.dripjobs.com/crews), [Contacts](https://app.dripjobs.com/contacts), [Settings](https://app.dripjobs.com/settings), [Automations](https://app.dripjobs.com/managezapier).

Primary ServiceFlow implementation reviewed:

- `web/src/components/nav.tsx`, `pipeline-board.tsx`, `deal-record.tsx`, `deal-tabs.tsx`
- `web/src/components/drips-editor.tsx`, `document-dialogs.tsx`, `proposal-editor.tsx`, `public-document.tsx`
- `web/src/components/job-schedule.tsx`, `contacts-table.tsx`, `job-costing-table.tsx`
- `web/src/components/settings/messaging-settings-form.tsx`, `settings-overview.tsx`
- `web/src/app/request/[slug]/request-form.tsx`
- `web/src/lib/{crm-types,messaging-types,proposal-types,appointment-types,billing-types,line-items}.ts`
- `supabase/functions/send-messages/index.ts`
- `supabase/migrations/20261024000000_remove_todos_activity_blasts.sql`

No customer contact details, private document links, credentials or integration tokens are included in this report.
