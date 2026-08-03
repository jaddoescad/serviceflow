import {
  getAssignments,
  getBudgets,
  getEmployeePayRates,
  getProjectLabourExpenses,
  getProjects,
  getTimeEntries,
} from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { rollupProjects } from "@/lib/metrics";
import { PageHeader } from "@/components/kpi";
import { ProjectsTable } from "@/components/projects-table";
import {
  emptyProjectLabourInvoiceSummary,
  getProjectLabourInvoiceSummaries,
} from "@/lib/invoice-queries";
import { getProjectMaterialSummaries } from "@/lib/materials";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function ProjectsPage() {
  const now = Date.now();
  const [
    profile,
    entries,
    payRates,
    projects,
    budgets,
    assignments,
    labourExpenses,
    invoiceSummaries,
    materialSummaries,
  ] = await Promise.all([
    requireStaff(),
    getTimeEntries(new Date(now - 180 * DAY).toISOString()),
    getEmployeePayRates(),
    getProjects(),
    getBudgets(),
    getAssignments(),
    getProjectLabourExpenses(),
    getProjectLabourInvoiceSummaries(),
    getProjectMaterialSummaries(),
  ]);

  const rows = rollupProjects(
    entries,
    projects,
    budgets,
    assignments,
    payRates,
    labourExpenses,
    now,
    invoiceSummaries,
  ).map((row) => ({
    ...row,
    labourInvoices:
      invoiceSummaries.get(row.projectId) ??
      emptyProjectLabourInvoiceSummary(),
    materials: materialSummaries.get(row.projectId) ?? {
      amountBeforeTax: 0,
      lineCount: 0,
    },
  }));

  return (
    <>
      <PageHeader
        title="Jobs & Costs"
        subtitle="Compare labour and allocated material costs with each job's before-HST value"
      />
      <ProjectsTable
        rows={rows}
        now={now}
        canManage={["admin", "manager"].includes(profile.role)}
      />
    </>
  );
}
