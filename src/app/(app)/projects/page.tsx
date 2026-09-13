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
  ] = await Promise.all([
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
  ).map((row) => {
    const labourInvoices =
      invoiceSummaries.get(row.projectId) ?? emptyProjectLabourInvoiceSummary();

    return {
      ...row,
      labourInvoices,
      painters: labourInvoices.painterNames,
    };
  });

  return (
    <>
      <PageHeader
        title="Labour budgets"
        subtitle="Track labour budgets, clocked hours, and labour invoices for each job"
      />
      <ProjectsTable
        rows={rows}
        now={now}
        canManage={canManage}
      />
    </>
  );
}
