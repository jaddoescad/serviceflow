# Subcontractor invoice and payment verification plan

Prepared July 30, 2026 for Ottawa Painters.

## Goal

For every subcontractor invoice, show:

1. What the original invoice says.
2. What the backend jobs and hours say.
3. What actually left the bank account.
4. Whether those numbers agree.
5. The evidence supporting each number.

The dashboard should provide accurate information and expose differences. It
should not manufacture adjustments, guess that two records match, or hide a
variance behind a `Paid` label.

## Sources of truth

### Original invoice

Keep and display the actual PDF or image. Record:

- Contractor/supplier.
- Invoice number and date.
- Due date.
- Before-tax amount.
- Tax.
- Total amount.
- Every printed entry, date, job, quantity, rate, and amount.
- Original file checksum so a later replacement can be detected.

Extracted values must always be shown beside the source document and remain
correctable by an authorized reviewer.

### Backend work

Display:

- Job.
- Worker.
- Clock-in and clock-out.
- Actual hours.
- Hourly rate, when applicable.
- Approved or pending status.
- Calculated wages.
- Any approved bonus.

The backend is evidence of work performed. It does not automatically replace
the amount printed on the invoice.

### Bank transaction

Use the imported, cleared bank row as evidence that money left the account:

- Account.
- Posted date.
- Bank description/reference.
- Amount.
- Running balance when available.
- Original statement/import file.

An email is not required. Do not show an email link unless the actual email or
attachment is archived and can be opened. A broken Gmail identifier is not
evidence.

## Records and relationships

Store these as separate records:

- Contractor.
- Invoice.
- Invoice entries.
- Job allocations.
- Timesheet links.
- Approved bonus payable.
- Bank payment.
- Payment allocations.
- Evidence files.
- Review/correction history.

An invoice may cover several jobs. One bank transaction may pay several
invoices or bonuses. One invoice may be paid by several bank transactions.
The relationships must therefore support splitting without changing the
original source amounts.

## Bonus handling

Do not mix an estimated bonus into an invoice or payment.

Use three clear stages:

1. `Estimated bonus`
   - Live dashboard calculation.
   - Informational only.
   - Not owed and not payable.

2. `Approved bonus`
   - Job is complete.
   - Final job value, labour cost, eligible hours, formula, and individual
     shares are saved.
   - Amount and approver are frozen.

3. `Paid bonus`
   - Approved bonus is linked to a cleared bank payment.
   - A payment can cover an invoice, a bonus, or both, but the allocation must
     show the exact split.

If the approved bonus changes, keep the original and create a correction. Do
not silently overwrite it.

## Matching rules

### Invoice totals

Calculate rather than manually type:

- Sum of invoice entries.
- Expected subtotal.
- Tax.
- Total.
- Difference from the printed invoice total.

Any difference remains visible until corrected or explicitly explained.

### Job and hour totals

For every invoice entry:

- Link the correct job.
- Link the relevant backend shift when the invoice is hourly.
- Compare invoiced hours with actual hours.
- Compare invoiced rate with the expected rate.
- Show missing, extra, duplicated, and unbilled hours.

The same backend hours cannot be used on two invoices.

### Payment totals

For every invoice:

- Amount due.
- Amount allocated from bank transactions.
- Remaining unpaid amount.
- Overpayment, if any.

For every bank payment:

- Total amount that left the account.
- Amount allocated to invoices.
- Amount allocated to bonuses.
- Unallocated amount.

Allocations cannot exceed either the bank payment or the invoice/bonus amount.

### Contractor identity

A bank payment must be assigned to the same contractor as the invoice or
bonus. If the bank data does not identify the recipient, display `Recipient
unknown` and require a manual confirmation with a note. Never infer the
recipient from amount alone.

## Clear statuses

### Invoice status

- `Needs information` — source document or important fields are missing.
- `Needs review` — totals, jobs, or hours disagree.
- `Unpaid` — verified invoice with no allocated bank payment.
- `Partially paid` — some payment is allocated, but a balance remains.
- `Paid — verification issue` — bank amount is sufficient, but another
  invoice/job/hour check fails.
- `Paid and verified` — invoice, jobs/hours, contractor, and bank allocation
  all pass.

### Bank payment status

- `Unidentified` — recipient or purpose is unknown.
- `Unmatched` — recipient is known but no invoice/bonus is linked.
- `Partially allocated` — part of the payment is explained.
- `Fully allocated` — every cent is assigned to verified invoices/bonuses.
- `Needs review` — payment is overallocated, reversed, duplicated, or conflicts
  with its linked records.

Avoid the vague word `Settled` unless the page also explains every check that
passed.

## Invoice/payment detail page

Clicking a subcontractor payment or invoice should open a full page with:

### Header

- Contractor.
- Invoice number.
- Invoice date.
- Invoice total.
- Amount paid.
- Amount remaining.
- Clear status.

### Evidence

- View/download original invoice.
- View original bank import/statement row.
- View bonus approval when applicable.
- Show file checksum and import date.
- Hide unavailable evidence links.

### Invoice entries

For each printed entry:

- Date and description.
- Invoiced hours/rate/amount.
- Assigned job.
- Backend hours/rate/wages.
- Difference.

### Payments

- Each linked bank transaction.
- Amount allocated to this invoice.
- Bonus portion, if any.
- Unallocated balance.

### Difference panel

Show independently:

- Invoice-entry difference.
- Job-allocation difference.
- Hour difference.
- Rate difference.
- Payment difference.
- Bonus difference.

Never collapse several differences into one unexplained warning.

### History

Show:

- Who linked or corrected a record.
- What changed.
- Old and new values.
- When it changed.
- Reason.

## Accuracy protections

The database, not only the dashboard, must reject:

- Allocating more money than a bank transaction contains.
- Paying an invoice beyond its balance without an explicit correction.
- Using the same timesheet hours twice.
- Allocating more hours than a shift contains.
- Linking a payment and invoice belonging to different contractors.
- Marking an invoice `Paid and verified` while any required check fails.

Approved invoices, bonuses, and payment allocations are corrected through
visible reversal/replacement records. They are not silently edited or deleted.

All currency calculations use exact decimal/cents values. Statuses and
differences are calculated from underlying records rather than manually typed.

## Current review baseline

The July 30 audit found:

- 128 outgoing transfers totaling $161,594.28 are currently categorized as
  `Subcontractors`, have no identified counterparty, and need review.
- These should be presented as unidentified/unverified transfers until their
  evidence confirms the recipient and purpose.
- Of 190 archived invoices with a known before-tax amount, 41 have no project
  link and 51 differ from their current project allocations.
- Only one bank-payment-to-invoice allocation is normalized.
- No invoice entries, invoice-to-timesheet links, or approved bonus payables
  have been normalized yet.

No existing transaction should be automatically reclassified merely because
it has a similar amount or date.

## Implementation phases

### Phase 1 — Make the numbers safe

1. Add database protections for payment, invoice, job, hour, and contractor
   allocations.
2. Add approved bonus records.
3. Add correction/reversal history.
4. Calculate the independent statuses and differences.
5. Test that deliberately invalid records are rejected.

**Completion test:** the database cannot accept an overallocated payment,
duplicated shift, mismatched contractor, or false `Paid and verified` status.

### Phase 2 — Build the evidence page

1. Replace the existing popup with a full invoice/payment page.
2. Display the actual invoice and bank source.
3. Add invoice-entry/job/hour comparisons.
4. Add payment and bonus allocation panels.
5. Remove broken email links.

**Completion test:** a reviewer can recreate every displayed total from visible
source records.

### Phase 3 — Pilot Fennec/Bilal

1. Enter invoice #1 exactly as printed.
2. Show its 123-hour header, 123.5 hours of listed shifts, and $15 difference.
3. Link its $3,690 bank payment.
4. Enter invoice #2 exactly as printed.
5. Compare its four entries with backend shifts.
6. Keep the July 29 Sue Deluney shift visible as unbilled.
7. Link invoice #2 only when a matching cleared payment exists.
8. Test a bonus separately from the base invoice.

**Completion test:** invoice #1 shows `Paid — verification issue`; invoice #2
shows `Unpaid` or `Partially paid` according to actual bank evidence.

### Phase 4 — Review unidentified payments

1. Work month by month from bank statements.
2. Identify each recipient using accessible bank/payment records or manual
   owner confirmation.
3. Link the actual invoice/bonus where available.
4. Leave unsupported rows unidentified.
5. Record every classification correction.

**Completion test:** statement opening balance plus all transactions equals the
closing balance, with every subcontractor amount either supported or visibly
unresolved.

### Phase 5 — Backfill all subcontractors

For each contractor:

1. Verify contractor identity.
2. Verify original invoices.
3. Enter invoice entries.
4. Link jobs and hours.
5. Record approved bonuses.
6. Link cleared bank payments.
7. Review every difference.

Process one contractor at a time and retain an exception list. Never insert a
fake balancing adjustment.

## Definition of success

The subcontractor information is reliable when:

- Every displayed invoice number can be traced to the original invoice.
- Every displayed payment can be traced to the imported bank statement.
- Every paid amount is allocated exactly once.
- Invoice, job, hour, rate, bonus, and payment differences are visible.
- No unavailable email link is presented as evidence.
- No unsupported transfer is presented as a confirmed subcontractor payment.
- No record can appear `Paid and verified` while a required check fails.
- Every correction has a visible history.

This plan is designed to prove what the records say and clearly expose what
remains unknown. It does not force uncertain information to balance.
