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
  ] = await Promise.all([
    requireStaff(),
    getTimeEntries(new Date(now - 180 * DAY).toISOString()),
    getEmployeePayRates(),
    getProjects(),
    getBudgets(),
    getAssignments(),
    getProjectLabourExpenses(),
    getProjectLabourInvoiceSummaries(),
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
  }));

  return (
    <>
      <PageHeader
        title="Jobs & Labour"
        subtitle="See how the painter budget compares with the 35–37% labour allowance"
      />
      <ProjectsTable
        rows={rows}
        now={now}
        canManage={["admin", "manager"].includes(profile.role)}
      />
    </>
  );
}
