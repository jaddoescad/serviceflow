import { getProjects, getBudgets, getTimeEntries, getAssignments, getEmployeePayRates, getEmployees } from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { rollupProjects } from "@/lib/metrics";
import { PageHeader } from "@/components/kpi";
import { ProjectsTable } from "@/components/projects-table";
export const dynamic = "force-dynamic";
export default async function ProjectsPage() {
  const now = Date.now();
  const profile = await requireStaff();
  const [projects, budgets, entries, assignments, rates, employees] = await Promise.all([
    getProjects(), getBudgets(), getTimeEntries(new Date(0).toISOString()), getAssignments(), getEmployeePayRates(), getEmployees(),
  ]);
  const names = new Map(employees.map(employee => [employee.user_id, employee.full_name || employee.email || "Unnamed painter"]));
  const painters = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const members = painters.get(assignment.companycam_project_id) ?? new Set<string>();
    members.add(names.get(assignment.user_id) ?? "Unnamed painter");
    painters.set(assignment.companycam_project_id, members);
  }
  const rows = rollupProjects(entries, projects, budgets, assignments, rates, now).map(row => ({
    ...row, painters: [...(painters.get(row.projectId) ?? [])],
  }));
  return <><PageHeader title="Labour budgets" subtitle="Track labour budgets, clocked hours, and painter costs for each job" /><ProjectsTable rows={rows} now={now} canManage={["admin", "manager"].includes(profile.role)} /></>;
}
