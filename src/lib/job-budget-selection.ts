export type OperationalJobBudget = {
  job_id: string;
  source: string;
  status: string;
  version: number;
  updated_at: string;
  amount_including_tax_cents?: number | string | null;
  metadata?: Record<string, any> | null;
};

const OPERATIONAL_BUDGET_SOURCES = new Set(["manual", "project_budget"]);
const CURRENT_BUDGET_STATUSES = new Set(["active", "closed"]);
const DRIPJOBS_JOB_AMOUNT_AUTHORITY_SOURCES = new Set([
  "dripjobs_jobs_list_all_views_csv",
  "dripjobs_invoice_list_csv",
]);

/** Select the current high-level job budget, excluding published task budgets. */
export function selectCurrentOperationalBudgets<
  T extends OperationalJobBudget,
>(budgets: readonly T[]): Map<string, T> {
  const sorted = [...budgets]
    .filter(
      (budget) =>
        OPERATIONAL_BUDGET_SOURCES.has(budget.source) &&
        CURRENT_BUDGET_STATUSES.has(budget.status),
    )
    .sort((left, right) => {
      const updated = right.updated_at.localeCompare(left.updated_at);
      if (updated !== 0) return updated;
      const source = Number(right.source === "manual") - Number(left.source === "manual");
      if (source !== 0) return source;
      return Number(right.version) - Number(left.version);
    });

  const current = new Map<string, T>();
  for (const budget of sorted) {
    if (!current.has(budget.job_id)) current.set(budget.job_id, budget);
  }
  return current;
}

/** Only validated DripJobs list imports may define automated job amounts. */
export function isDripJobsJobAmountBudget(
  budget: OperationalJobBudget | null | undefined,
): boolean {
  const authority = budget?.metadata?.job_amount_authority;

  return (
    DRIPJOBS_JOB_AMOUNT_AUTHORITY_SOURCES.has(
      authority?.source_type,
    ) &&
    typeof authority?.source_sha256 === "string" &&
    authority.source_sha256.length > 0 &&
    Number(budget?.amount_including_tax_cents ?? 0) > 0
  );
}
