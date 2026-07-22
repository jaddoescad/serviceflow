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

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function ProjectsPage() {
  const now = Date.now();
  const [profile, entries, payRates, projects, budgets, assignments, labourExpenses] = await Promise.all([
    requireStaff(),
    getTimeEntries(new Date(now - 180 * DAY).toISOString()),
    getEmployeePayRates(),
    getProjects(),
    getBudgets(),
    getAssignments(),
    getProjectLabourExpenses(),
  ]);

  const rows = rollupProjects(
    entries,
    projects,
    budgets,
    assignments,
    payRates,
    labourExpenses,
    now,
  );

  return (
    <>
      <PageHeader
        title="Jobs & Labour"
        subtitle="See how the painter budget compares with the 35–38% labour allowance"
      />
      <ProjectsTable
        rows={rows}
        canManage={["admin", "manager"].includes(profile.role)}
      />
    </>
  );
}
