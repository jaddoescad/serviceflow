export type OperationalJobBudget = {
  job_id: string;
  source: string;
  status: string;
  version: number;
  updated_at: string;
};

const OPERATIONAL_BUDGET_SOURCES = new Set(["manual", "project_budget"]);
const CURRENT_BUDGET_STATUSES = new Set(["active", "closed"]);

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
