import { getTimeEntries, getEmployees, getEmployeePayRates, getProjects, getBudgets, getAssignments, getProjectLabourExpenses } from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { projectDetails, rollupProjects } from "@/lib/metrics";
import { PageHeader } from "@/components/kpi";
import { ProjectsTable } from "@/components/projects-table";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function ProjectsPage() {
  const now = Date.now();
  const [profile, entries, employees, payRates, projects, budgets, assignments, labourExpenses] = await Promise.all([
    requireStaff(),
    getTimeEntries(new Date(now - 180 * DAY).toISOString()),
    getEmployees(),
    getEmployeePayRates(),
    getProjects(),
    getBudgets(),
    getAssignments(),
    getProjectLabourExpenses(),
  ]);

  const rows = rollupProjects(entries, projects, budgets, assignments, payRates, labourExpenses, now);
  const detailsByProject = projectDetails(entries, payRates, labourExpenses, now);

  const assignmentsByProject: Record<string, string[]> = {};
  for (const a of assignments) {
    (assignmentsByProject[a.companycam_project_id] ??= []).push(a.user_id);
  }

  const crew = employees
    .filter((e) => e.is_active)
    .map((e) => ({ userId: e.user_id, name: e.full_name ?? e.email ?? "Unknown" }));

  return (
    <>
      <PageHeader
        title="Jobs & Labour"
        subtitle="See how the painter budget compares with the 35–38% labour allowance"
      />
      <ProjectsTable
        rows={rows}
        detailsByProject={detailsByProject}
        crew={crew}
        assignmentsByProject={assignmentsByProject}
        canManage={["admin", "manager"].includes(profile.role)}
      />
    </>
  );
}
