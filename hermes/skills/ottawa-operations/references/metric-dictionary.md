# Metric dictionary

- **Contract amount:** `job_financial_summary.contract_amount_cents`, falling back to the canonical job contract amount.
- **Receivable:** the job financial summary for job-level reporting; `greatest(invoice_balances.calculated_balance_cents, 0)` for invoice/customer/cash reporting.
- **Total cost:** labour cost plus material cost from `job_financial_summary`.
- **Gross profit:** contract amount minus total cost. This is an operational gross-profit estimate, not tax-basis net income.
- **Labour usage:** `job_feed.used_minutes / budget_minutes`; flag at 90% or more while the job remains active.
- **Job readiness:** scheduled job with a budget, tasks, an active assignment, and a linked CompanyCam project. A linked project does not prove photo/checklist completion.
- **Follow-up candidate:** an open lead without a non-cancelled job whose database activity is older than the selected threshold. Gmail and Quo must be checked before recommending contact.
- **Overdue:** positive calculated receivable balance with `due_on < current_date`. Ignore inconsistent invoice status capitalization.
- **Accounting locked:** the canonical historical lock function says the job is before the 2026-06-01 cutoff, or the historical fallback rules apply. Never mutate locked accounting.

Every report includes `as_of`, `warnings`, and `provenance`. Preserve these qualifications when they materially affect the answer.

