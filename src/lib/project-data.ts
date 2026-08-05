import { cache } from "react";
import {
  getEmployees,
  getEmployeePayRates,
  getLabourExpensesForProject,
  getLabourTasksForProject,
  getProjectAssignments,
  getProjectBudgetRows,
  getProjectById,
  getProjectTimeEntries,
} from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { projectDetails, projectTaskProgress, rollupProjects } from "@/lib/metrics";
import { getProjectLabourInvoiceSummary } from "@/lib/invoice-queries";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Loads one job's data (entries, budget, tasks) instead of the whole
 * company's history. cache() dedupes calls within a request.
 */
export const getProjectData = cache(async (projectId: string) => {
  const now = Date.now();
  const [
    profile,
    project,
    entries,
    payRates,
    budgets,
    assignments,
    labourExpenses,
    labourTasks,
    employees,
    invoiceSummary,
  ] = await Promise.all([
    requireStaff(),
    getProjectById(projectId),
    getProjectTimeEntries(projectId, new Date(now - 180 * DAY).toISOString()),
    getEmployeePayRates(),
    getProjectBudgetRows(projectId),
    getProjectAssignments(projectId),
    getLabourExpensesForProject(projectId),
    getLabourTasksForProject(projectId),
    getEmployees(),
    getProjectLabourInvoiceSummary(projectId),
  ]);

  if (!project) return null;

  const rows = rollupProjects(
    entries,
    [project],
    budgets,
    assignments,
    payRates,
    labourExpenses,
    now,
    new Map([[projectId, invoiceSummary]]),
  );
  const rollup = rows.find((row) => row.projectId === projectId);
  if (!rollup) return null;

  return {
    canManage: ["admin", "manager"].includes(profile.role),
    project: rollup,
    detail: projectDetails(entries, payRates, labourExpenses, now)[projectId],
    taskProgress: projectTaskProgress(labourTasks, employees)[projectId] ?? [],
  };
});

/** Just enough to paint the job header instantly: auth + one project row. */
export const getProjectShell = cache(async (projectId: string) => {
  const [, project] = await Promise.all([requireStaff(), getProjectById(projectId)]);
  if (!project) return null;
  return {
    name: project.name,
    address: project.formatted_address ?? null,
    isLead: project.is_lead,
  };
});
