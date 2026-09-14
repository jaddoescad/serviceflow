import { getProjects,getBudgets,getTimeEntries,getAssignments,getEmployeePayRates } from "@/lib/queries";
import { rollupProjects } from "@/lib/metrics";
import { ProjectsTable } from "@/components/projects-table";
export const dynamic="force-dynamic";
export default async function ProjectsPage(){
 const [projects,budgets,entries,assignments,rates]=await Promise.all([getProjects(),getBudgets(),getTimeEntries(new Date(0).toISOString()),getAssignments(),getEmployeePayRates()]);
 return <><h1 className="mb-5 text-2xl font-semibold">Labour budgets</h1><ProjectsTable rows={rollupProjects(entries,projects,budgets,assignments,rates)} /></>;
}
