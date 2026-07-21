import {
  getAssignments,
  getBudgets,
  getDefaultCalculatorProjectIds,
  getEmployeePayRates,
  getEmployees,
  getProjectLabourExpenses,
  getProjectLabourTaskEntries,
  getProjectLabourTasks,
  getProjects,
  getTimeEntries,
} from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { projectDetails, projectTaskProgress, rollupProjects } from "@/lib/metrics";
import { PageHeader } from "@/components/kpi";
import { ProjectsTable } from "@/components/projects-table";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function ProjectsPage() {
  const now = Date.now();
  const [profile, entries, payRates, projects, budgets, assignments, labourExpenses, defaultCalculatorProjectIds, labourTasks, labourTaskEntries, employees] = await Promise.all([
    requireStaff(),
    getTimeEntries(new Date(now - 180 * DAY).toISOString()),
    getEmployeePayRates(),
    getProjects(),
    getBudgets(),
    getAssignments(),
    getProjectLabourExpenses(),
    getDefaultCalculatorProjectIds(),
    getProjectLabourTasks(),
    getProjectLabourTaskEntries(),
    getEmployees(),
  ]);

  const rows = rollupProjects(
    entries,
    projects,
    budgets,
    assignments,
    payRates,
    labourExpenses,
    now,
    defaultCalculatorProjectIds,
  );
  const detailsByProject = projectDetails(entries, payRates, labourExpenses, now);
  const taskProgressByProject = projectTaskProgress(labourTasks, labourTaskEntries, employees, now);

  return (
    <>
      <PageHeader
        title="Jobs & Labour"
        subtitle="See how the painter budget compares with the 35–38% labour allowance"
      />
      <ProjectsTable
        rows={rows}
        detailsByProject={detailsByProject}
        taskProgressByProject={taskProgressByProject}
        canManage={["admin", "manager"].includes(profile.role)}
      />
    </>
  );
}
