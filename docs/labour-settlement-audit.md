# Labour settlement audit

Audited July 30, 2026 against Supabase project `bwbckdkouqghdadpkjvn`.
The audit was read-only. No financial, invoice, project, or timesheet rows were
inserted, updated, or deleted.

## Baseline

| Existing table | Rows | Current responsibility |
| --- | ---: | --- |
| `financial_transactions` | 1,135 | Imported bank and card activity |
| `labour_invoices` | 214 | Archived invoice/source documents |
| `labour_invoice_projects` | 228 | Invoice-level project links and dollar allocations |

Of the 190 archived records that are invoices with a known before-tax amount:

- 149 have at least one project link.
- 41 have no project link.
- 51 do not balance to their current project allocations.
- 1 has a null project allocation.
- 6 project links are explicitly marked for review.

Only one bank-to-invoice allocation exists. It is stored inside
`financial_transactions.source_data.settlements`, linking the July 16 Fennec
payment to invoice #1 for $3,690.

## Structural gaps

The current schema has:

- Bank transactions.
- Invoice documents.
- Invoice-to-project links.
- Employee profiles and project time entries.

It does not have:

- A stable subcontractor/supplier identity joining a company such as Fennec
  Contracting to a worker such as Bilal Akkacha.
- Normalized bank-payment-to-invoice allocations.
- Individual invoice entries/lines.
- Per-line job allocations.
- Explicit links between invoice entries and backend time entries.
- An auditable way to resolve a legitimate variance.
- Computed settlement views that distinguish partial, mismatch, and settled.

The existing `project_labour_expenses` table is not a replacement for these
relationships. It stores manually entered fixed-price job costs and currently
has no Bilal/Fennec rows.

## Bilal acceptance cases

### Fennec invoice #1

| Item | Result |
| --- | --- |
| Invoice total | $3,690.00 |
| Invoice header quantity | 123 hours at $30 |
| Sum of the listed shifts | 123h 30m |
| Listed-shift value | $3,705.00 |
| Bank payment | $3,690.00 on July 16 |
| Current payment allocation | $3,690.00 |

The backend time entries match the individually listed shifts for the seven
jobs. The present invoice-to-project allocations are forced to $3,690 by
assigning Bearbrook $592.50 even though its 20h 15m supports $607.50. This
hides the actual 30-minute/$15 invoice discrepancy.

Invoice #1 should therefore remain `mismatch` until the invoice is corrected
or an authorized variance resolution is recorded.

### Fennec invoice #2

| Job | Invoice hours | Invoice amount | Matching backend shift |
| --- | ---: | ---: | ---: |
| Sally Bidal | 10h 45m | $322.50 | 10.6847h |
| Phil Anido | 8h | $240.00 | 8.1088h |
| Anjou Delplancke | 7h | $210.00 | 6.2238h |
| Sue Deluney, July 28 | 8h 45m | $262.50 | 8.7931h |
| **Total** | **34h 30m** | **$1,035.00** | **33.8104h** |

The job allocations balance perfectly to $1,035. The matching backend shifts
are approximately 41 minutes shorter in total. Sue Deluney also has a separate
8.7605-hour shift on July 29 that is not included in invoice #2.

No bank payment is currently linked to invoice #2, so it cannot be settled.

## Proposed normalized model

The proposed migration creates:

1. `labour_contractors`
   - Supplier/company identity.
   - Optional link to an `employee_profiles` worker.

2. `labour_invoice_lines`
   - The entries printed on an invoice.
   - Service dates, hours, rate, amount, and source text.

3. `labour_invoice_line_allocations`
   - One invoice line split across one or more jobs.
   - Dollar and optional hour allocation per job.

4. `labour_invoice_line_time_entries`
   - Explicit many-to-many links between invoice lines and backend shifts.
   - Supports partial allocation of a shift.

5. `labour_payment_allocations`
   - Many-to-many bank-payment-to-invoice allocations.
   - Replaces `source_data.settlements` as the system of record.

6. `labour_reconciliation_resolutions`
   - Append-only explanations for accepted payment, job, or hour variances.

7. Reconciliation views
   - `labour_invoice_reconciliation`
   - `labour_payment_reconciliation`

## Settlement rules

An invoice is `settled` only when:

- A contractor is assigned.
- It has invoice lines.
- Every line is fully allocated to jobs.
- Payment allocations equal the invoice amount due.
- Lines containing hours are linked to time entries.
- Dollar and hour variances are zero within tolerance, or have an explicit
  resolution with a reason and note.

Status meanings:

| Status | Meaning |
| --- | --- |
| `needs_review` | Contractor or invoice-entry structure is missing |
| `partial` | Some valid links exist, but job or payment allocation is incomplete |
| `mismatch` | Linked amounts/hours disagree and have not been resolved |
| `settled` | Contractor, payment, invoice entries, jobs, and time are reconciled |

## Safe rollout

1. Review the proposed SQL without applying it.
2. Apply the schema to a development/staging project first.
3. Backfill the single legacy JSON payment allocation.
4. Backfill exact invoice lines and job allocations.
5. Keep invoice #1 in `mismatch`; do not manufacture a balancing line.
6. Keep invoice #2 `partial` until a bank payment is linked.
7. Build the read-only transaction settlement page against the views.
8. Add editing, dropdown allocation, splitting, and variance-resolution actions.

The schema migration is in
`docs/proposed-labour-settlement-migration.sql`. It has not been applied.
It is intentionally stored as a proposal in this repository rather than added
to the adjacent canonical migration history while that worktree contains
unrelated uncommitted migration files.
