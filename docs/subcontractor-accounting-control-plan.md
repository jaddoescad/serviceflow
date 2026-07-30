# Subcontractor accounting control plan

Prepared July 30, 2026 for Ottawa Painters.

## Objective

Create a defensible audit trail for every subcontractor dollar from the original
source document through job costing, approval, bank payment, tax reporting, and
month-end close.

The system must never infer `Paid` or `Settled` from a manually selected status.
Those states must be computed from verified evidence and balanced allocations.

## Current risk baseline

The July 30 read-only audit found:

- 128 outgoing transfers totaling $161,594.28 are categorized as
  `Subcontractors`, have no identified counterparty, and still need review.
- Historical e-transfers have already demonstrated classification risk:
  33 transactions originally treated as subcontractor costs were later
  reclassified as advertising, colour consultation, sales commissions, and
  customer refunds.
- 214 labour documents are archived.
- Of 190 invoices with a known before-tax amount, 41 have no project link and
  51 do not balance to their current project allocations.
- Only one bank-payment-to-invoice allocation has been normalized.
- There are currently no normalized invoice lines, invoice-line-to-timesheet
  links, stored bonus liabilities, or variance resolutions.
- Painter bonuses are currently live calculations. They are not approved,
  immutable amounts payable and are not linked to bank payments.

The 128 unidentified transfers must be treated as `Unclassified outgoing
transfer`, not confirmed subcontractor expense, until supporting evidence
identifies the recipient and business purpose.

## Accounting objects

### 1. Contractor master

Maintain one record for each legal payee:

- Legal and trade names.
- Individual, sole proprietor, partnership, or corporation.
- Business address and contact information.
- Canadian residency status.
- Business number and GST/HST registration number, when applicable.
- Payment email/account and verified bank recipient names.
- Signed contract and effective dates.
- Worker-classification assessment and approval.
- Insurance and clearance documents when required by the company's accountant
  or legal adviser.
- Active/inactive status and duplicate-identity controls.

Do not merge two contractors solely because their names are similar. Do not
allow one payment email to silently identify a different legal entity.

### 2. Immutable evidence

Keep the original, unedited version of:

- Invoice PDF or image.
- Source email and attachments.
- Contract or work order.
- Bank statement/import row.
- Interac or payment confirmation.
- Timesheet and approval history.
- Project/job record.
- Bonus calculation and approval.
- Credit note, correction, or dispute correspondence.

Each file needs a SHA-256 checksum, original filename, MIME type, source,
received timestamp, storage version, and retention date. Replacing or deleting
an original must be prohibited. A corrected document becomes a new version.

### 3. Invoice and invoice entries

Store the invoice header separately from its entries:

- Supplier, invoice number, invoice date, due date, and currency.
- Before-tax amount, tax, total, and amount due.
- GST/HST treatment and supplier registration number where applicable.
- Each date/job/service entry, quantity, rate, and amount.
- Credits, holdbacks, reimbursements, and bonuses as distinct entry types.
- Original text alongside normalized values.

Duplicate detection must use supplier, invoice number, amount, date, source
document checksum, and payment history.

### 4. Job and timesheet evidence

Every labour invoice entry should allocate to one or more jobs and, when billed
by time, to specific backend time entries.

The database must reject:

- Job allocations exceeding the invoice entry.
- A timesheet being claimed twice.
- Allocated hours exceeding the actual shift.
- A worker's time being linked to a different contractor without an explicit
  reviewed relationship.
- A settled invoice with unallocated entries.

An invoice can legitimately differ from backend hours, but the difference must
remain visible and require an approved resolution with a reason and evidence.

### 5. Bonuses

A live estimate is not an accounting liability.

Use this bonus lifecycle:

1. `Estimated` — calculated from the live job budget; not payable.
2. `Calculated` — job is closed and approved hours/costs are frozen.
3. `Approved` — named approver accepts the formula and amount.
4. `Payable` — an immutable bonus payable is created for each recipient.
5. `Partially paid` or `Paid` — derived from bank allocations.
6. `Settled` — payment cleared, evidence is complete, and the accounting period
   is not disputed.

Store the calculation inputs, formula version, job value, labour budget,
eligible hours, each worker's share, rounding allocation, approver, and
approval time. A changed job value or timesheet creates a reversal and a new
bonus version; it must not overwrite the approved bonus.

For a subcontractor, record a bonus separately from base invoiced labour while
still linking it to the contractor, job, payment, and applicable tax/reporting
treatment. The accountant should decide whether the contractor must issue an
adjusted invoice or whether another supporting document is sufficient.

### 6. Payments and allocations

A bank transaction can pay multiple invoices, and an invoice can be paid by
multiple transactions.

Enforce these invariants in the database:

- Total allocations cannot exceed the absolute bank transaction amount.
- Total invoice payments cannot exceed amount due without a credit/refund
  workflow.
- Payment and invoice currencies must agree.
- Payment recipient and invoice contractor must agree.
- A payment reversal must reverse its allocations.
- Bank fees are separate expenses and never part of the supplier payment.
- Advances remain contractor advances until applied to an invoice.
- No bank transaction or allocation is deleted after review; corrections use
  reversing entries.

### 7. Independent reconciliation checks

Do not compress everything into one ambiguous status. Show separate checks:

- Contractor identified.
- Original invoice retained and checksum verified.
- Invoice fields verified.
- Tax treatment verified.
- Entries balance to invoice total.
- Entries fully allocated to jobs.
- Hours reconciled.
- Bonus approved.
- Payment fully allocated.
- Bank payment cleared.
- Recipient confirmed.
- Reporting information complete.
- Reviewer approval complete.
- Accounting period open or locked.

`Settled` is displayed only when every required check passes. Any override must
name the reviewer, reason, evidence, timestamp, and affected amount.

## Classification policy

Incoming bank categories are suggestions, never evidence.

Use separate categories for:

- Direct subcontractor labour.
- Subcontractor bonus.
- Materials reimbursement.
- Contractor advance or deposit.
- Sales commission.
- Colour consultation or other professional service.
- Advertising and marketing.
- Customer refund.
- Owner/shareholder transaction.
- Credit-card or account transfer.
- Tax payment.
- Bank fee.
- Uncategorized/needs review.

An outgoing e-transfer stays `Unclassified outgoing transfer` until at least
one strong source identifies the recipient and purpose. Suggested matches may
use amount/date/email/name, but only a human confirmation or exact linked
document changes the accounting category.

Classification corrections must preserve the original category, rule/version,
evidence, confirmer, and timestamp.

## Review and approval controls

Use two levels:

- Preparer: links documents, invoices, jobs, timesheets, bonuses, and payments.
- Approver: confirms the classification, variance, and settlement.

The same user should not approve their own manual variance or payment match
when the amount is over the accountant-approved threshold.

Create an append-only audit event for every:

- Import.
- Match suggestion.
- Manual link.
- Classification change.
- Amount or tax correction.
- Approval or rejection.
- Bonus calculation and approval.
- Payment allocation or reversal.
- Period close or reopen.

## Rollout plan

### Phase 1 — Harden the database

1. Add aggregate allocation constraints for payments, invoice entries, and
   timesheets.
2. Add normalized evidence/document links.
3. Add immutable bonus payable/version tables.
4. Add append-only accounting events and correction/reversal workflows.
5. Replace the single status with independent reconciliation checks.
6. Add accounting period close/reopen controls.
7. Add automated negative tests proving invalid records are rejected.

**Gate:** no backfill or settlement marking until all invalid-allocation tests
pass.

### Phase 2 — Establish contractor identities

1. Deduplicate the 28 imported supplier identities.
2. Collect legal, tax, residency, contract, and payment-recipient details.
3. Complete a worker-classification review for every individual.
4. Flag missing or expired evidence.

**Gate:** no unidentified or unreviewed contractor can become settled.

### Phase 3 — Triage bank classifications

1. Move the 128 unidentified transfers into an unclassified review queue.
2. Match Interac/payment emails to bank rows by confirmation code, amount,
   recipient, and date.
3. Link exact invoices and supporting emails.
4. Ask the owner only about unresolved rows, grouped by likely recipient.
5. Record every confirmed correction through the audit event system.

Process the largest amounts first, but reconcile complete monthly statement
periods rather than stopping after large transactions.

**Gate:** opening balance + all transactions = statement closing balance for
every account and month.

### Phase 4 — Pilot with Fennec/Bilal

1. Backfill invoice #1 exactly as printed.
2. Keep its 30-minute/$15 discrepancy visible as `Mismatch`.
3. Backfill invoice #2 and its four jobs.
4. Keep the July 29 Sue Deluney shift as unbilled.
5. Link any later payment only when the exact bank row and confirmation exist.
6. Test bonus approval and payment separately from invoiced base labour.

**Gate:** an independent reviewer can recreate every number without relying on
dashboard assumptions.

### Phase 5 — Backfill all subcontractors

For every invoice:

1. Verify the original document checksum.
2. Verify supplier identity and duplicate status.
3. Enter/verify all invoice entries and tax.
4. Allocate entries to jobs.
5. Link time entries where applicable.
6. Create approved bonus payables separately.
7. Allocate exact bank payments.
8. Resolve discrepancies with evidence or leave them open.

Never manufacture an adjustment merely to force a balance.

### Phase 6 — Settlement page and review queues

Build:

- One full page per contractor payment.
- Evidence viewer for invoice, email, payment confirmation, and bank source.
- Invoice/job/hour/bonus allocation controls.
- Separate unpaid, partially paid, paid-not-verified, mismatch, and settled
  queues.
- Missing-document and duplicate warnings.
- Reviewer/approver history.
- Period close dashboard.

### Phase 7 — Accountant sign-off and monthly operation

Before locking each month:

- Reconcile every bank and credit-card statement.
- Review all unclassified and needs-review rows.
- Reconcile accounts payable and contractor advances.
- Review GST/HST treatment and input tax credit evidence.
- Reconcile job-cost and bonus liabilities.
- Produce contractor payment totals excluding GST/HST.
- Review required T5018/T4A/T4A-NR reporting with the accountant.
- Export a complete evidence package and exception report.
- Lock the period.

## Definition of complete

The subcontractor ledger is ready for reliance when:

- Every bank account ties exactly to its statement.
- Every subcontractor payment has a known legal recipient.
- Every payment is allocated without overpayment.
- Every invoice has its original source and balanced entries.
- Every entry is assigned to jobs and applicable hours.
- Every bonus is approved, versioned, and separately traceable.
- Every discrepancy is unresolved and visible, or resolved with evidence.
- No transaction is silently overwritten or deleted.
- All required tax/reporting fields are present.
- The accountant has signed off on opening balances, tax mappings, worker
  classification, and reporting treatment.

Absolute certainty cannot be created from incomplete external records. The
system can, however, prove which evidence exists, prevent invalid accounting
relationships, and make every unknown or exception impossible to hide.
