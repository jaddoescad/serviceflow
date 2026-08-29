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

  const clockInNamesByProject = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.companycam_project_id) continue;
    const name = entry.user_name?.trim() || entry.user_email?.trim();
    if (!name) continue;
    const names = clockInNamesByProject.get(entry.companycam_project_id) ?? new Set<string>();
    names.add(name);
    clockInNamesByProject.set(entry.companycam_project_id, names);
  }

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
    const clockInNames = [...(clockInNamesByProject.get(row.projectId) ?? [])];

    return {
      ...row,
      labourInvoices,
      painters: [...new Set([...clockInNames, ...labourInvoices.painterNames])].sort(
        (left, right) => left.localeCompare(right),
      ),
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
