import {
  getAssignments,
  getBudgets,
  getEmployeePayRates,
  getJobMaterialSummaries,
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

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function ProjectsPage() {
  const now = Date.now();
  const profile = await requireStaff();
  const canManage = ["admin", "manager"].includes(profile.role);
  const [
    entries,
    payRates,
    projects,
    budgets,
    assignments,
    labourExpenses,
    invoiceSummaries,
    materialSummaries,
  ] = await Promise.all([
    getTimeEntries(new Date(now - 180 * DAY).toISOString()),
    getEmployeePayRates(),
    getProjects(),
    getBudgets(),
    getAssignments(),
    getProjectLabourExpenses(),
    getProjectLabourInvoiceSummaries(),
    getJobMaterialSummaries(),
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
  ).map((row) => {
    const labourInvoices =
      invoiceSummaries.get(row.projectId) ?? emptyProjectLabourInvoiceSummary();

    return {
      ...row,
      labourInvoices,
      painters: labourInvoices.painterNames,
      materials: materialSummaries.get(row.projectId) ?? {
        amountBeforeTax: 0,
        lineCount: 0,
      },
    };
  });

  return (
    <>
      <PageHeader
        title="Jobs & Costs"
        subtitle="Compare labour and allocated material costs with each job's before-HST value"
      />
      <ProjectsTable
        rows={rows}
        now={now}
        canManage={canManage}
      />
    </>
  );
}
