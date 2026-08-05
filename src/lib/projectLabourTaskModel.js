const TASK_STATUSES = new Set(["pending", "in_progress", "completed", "skipped", "cancelled"]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeProjectLabourBudget(row) {
  if (!row) return null;
  const id = row.labour_budget_id || row.id || null;
  const projectId = row.companycam_project_id || null;
  if (!id || !projectId) return null;

  return {
    id: String(id),
    companycamProjectId: String(projectId),
    sourceQuoteId: row.source_quote_id ? String(row.source_quote_id) : null,
    sourceQuoteName: String(row.source_quote_name || "Labour plan"),
    instructions: row.instructions ? String(row.instructions) : null,
    totalBudgetedHours: Math.max(
      0,
      finiteNumber(row.total_budgeted_hours ?? row.budgeted_hours),
    ),
    revision: Math.max(1, Math.round(finiteNumber(row.budget_revision ?? row.revision, 1))),
    publishedAt: row.published_at || null,
  };
}

export function normalizeProjectLabourTask(row) {
  if (!row?.task_id) return null;
  const status = String(row.status || "pending");

  return {
    id: String(row.task_id),
    labourBudgetId: row.labour_budget_id ? String(row.labour_budget_id) : null,
    companycamProjectId: row.companycam_project_id
      ? String(row.companycam_project_id)
      : null,
    sourceKind: String(row.source_kind || "custom"),
    title: String(row.title || "Task"),
    notes: row.notes ? String(row.notes) : null,
    budgetedHours: Math.max(0, finiteNumber(row.task_budgeted_hours ?? row.budgeted_hours)),
    status: status === "cancelled" ? "skipped" : TASK_STATUSES.has(status) ? status : "pending",
    completedAt: row.completed_at || null,
    sortOrder: Math.round(finiteNumber(row.sort_order)),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : {},
  };
}

export function normalizeProjectLabourTaskRows(rows, fallbackBudget = null) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const budget = normalizeProjectLabourBudget(sourceRows[0]) || normalizeProjectLabourBudget(fallbackBudget);
  const tasks = sourceRows
    .map(normalizeProjectLabourTask)
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));

  return { budget, tasks };
}

export function projectLabourTaskSummary(plan) {
  const tasks = plan?.tasks || [];
  const budgetedHours = Math.max(
    0,
    finiteNumber(
      plan?.budget?.totalBudgetedHours,
      tasks.reduce((sum, task) => sum + task.budgetedHours, 0),
    ),
  );
  const completedCount = tasks.filter((task) => task.status === "completed").length;

  return {
    taskCount: tasks.length,
    completedCount,
    budgetedHours,
    completionPercent: tasks.length ? (completedCount / tasks.length) * 100 : 0,
  };
}

export function isSameLabourTaskProject(project, activeShift) {
  const projectId = String(
    project?.companycam_id || project?.companycam_project_id || project?.id || "",
  );
  const activeProjectId = String(
    activeShift?.project?.companycam_id ||
      activeShift?.project?.companycam_project_id ||
      activeShift?.project?.id ||
      "",
  );
  return Boolean(projectId && activeProjectId && projectId === activeProjectId);
}
