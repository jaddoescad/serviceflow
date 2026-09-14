import { getProjects, getBudgets, getTimeEntries, getAssignments, getEmployeePayRates } from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { rollupProjects } from "@/lib/metrics";
import { PageHeader } from "@/components/kpi";
import { ProjectsTable } from "@/components/projects-table";
export const dynamic = "force-dynamic";
export default async function ProjectsPage() {
  const now = Date.now();
  const profile = await requireStaff();
  const [projects, budgets, entries, assignments, rates] = await Promise.all([
    getProjects(), getBudgets(), getTimeEntries(new Date(0).toISOString()), getAssignments(), getEmployeePayRates(),
  ]);
  const rows = rollupProjects(entries, projects, budgets, assignments, rates, now);
  return <><PageHeader title="Labour budgets" subtitle="Track labour budgets, clocked hours, and painter costs for each job" /><ProjectsTable rows={rows} now={now} canManage={["admin", "manager"].includes(profile.role)} /></>;
}
