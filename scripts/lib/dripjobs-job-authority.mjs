export const ACCOUNTING_CUTOFF = "2026-06-01";

export function normalizedAuthorityValue(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[\s-]+/g, "_");
}

export function isCanonicalAuthorityJob(job) {
  return !["superseded", "excluded", "void"].includes(
    normalizedAuthorityValue(job.metadata?.accounting_status),
  );
}

export function jobAccountingLockReason(job, cutoff = ACCOUNTING_CUTOFF) {
  if (job.started_on && job.started_on < cutoff) return `started_on ${job.started_on} is before ${cutoff}`;
  if (!job.started_on && job.completed_on && job.completed_on < cutoff) {
    return `completed_on ${job.completed_on} proves a pre-cutoff job`;
  }
  const historicalStatus = ["completed", "cancelled", "archived"].includes(
    normalizedAuthorityValue(job.status),
  );
  if ((historicalStatus || job.archived_at) && !job.started_on && !job.completed_on) {
    return "completed or archived with no verified start/completion date";
  }
  return null;
}

export function currentAuthorityBudget(budgets) {
  return [...budgets]
    .filter(
      (budget) =>
        ["manual", "project_budget"].includes(budget.source) &&
        ["active", "closed"].includes(budget.status),
    )
    .sort((left, right) => {
      const updated = String(right.updated_at).localeCompare(String(left.updated_at));
      if (updated !== 0) return updated;
      const manual = Number(right.source === "manual") - Number(left.source === "manual");
      if (manual !== 0) return manual;
      return Number(right.version) - Number(left.version);
    })[0] ?? null;
}

export function productionMonthDecision(currentMonth, candidateMonth) {
  const current = currentMonth ? String(currentMonth).slice(0, 10) : null;
  const candidate = candidateMonth ? String(candidateMonth).slice(0, 10) : null;
  if (!candidate) return { apply: false, effectiveMonth: current, reason: "stage_not_eligible" };
  if (!current) return { apply: true, effectiveMonth: candidate, reason: "production_month_missing" };
  if (candidate > current) return { apply: true, effectiveMonth: candidate, reason: "later_workflow_transition" };
  if (candidate === current) return { apply: false, effectiveMonth: current, reason: "already_current" };
  return { apply: false, effectiveMonth: current, reason: "never_move_backward" };
}

export function amountAuthorityEquivalent(authority, row) {
  return (
    String(authority?.source_type ?? "") === "dripjobs_jobs_list_all_views_csv" &&
    String(authority?.proposal_id ?? "") === row.proposalId &&
    String(authority?.invoice_id ?? "") === String(row.invoiceId ?? "") &&
    Number(authority?.gross_amount_cents ?? -1) === row.grossCents &&
    Number(authority?.before_hst_cents ?? -1) === row.beforeHstCents
  );
}
