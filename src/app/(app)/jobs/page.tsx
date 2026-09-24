import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rollupProjects, type JobWorkSummary } from "@/lib/metrics";
import type { Project, ProjectBudget } from "@/lib/types";
import { PageHeader } from "@/components/kpi";
import { ProjectsTable } from "@/components/projects-table";
export const dynamic = "force-dynamic";
export default async function LabourPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const query = (params.q ?? "").slice(0, 200);
  const requestedPage = Math.max(1, Math.min(1000000, Number.parseInt(params.page ?? "1", 10) || 1));
  const [profile, result] = await Promise.all([
    requireStaff(), createClient().then(client => client.rpc("get_labour_budgets_page", { search_text: query, page_number: requestedPage })),
  ]);
  if (result.error) throw new Error(`labour budgets: ${result.error.message}`);
  type BudgetRow = JobWorkSummary & { address: string | null; startedOn: string | null; productionMonth: string | null; budgetedHours: number | null; hourlyRate: number | null; amount: number | null; closedAt: string | null };
  const data = result.data as { rows: BudgetRow[]; total: number; calculatedAt: string; totals: { overCount: number; readyToCloseCount: number } };
  const projects = data.rows.map(row => ({ companycam_id: row.projectId, name: row.name, formatted_address: row.address, started_on: row.startedOn, production_month: row.productionMonth })) as Project[];
  const budgets = data.rows.map(row => ({ companycam_project_id: row.projectId, budgeted_hours: row.budgetedHours, hourly_rate: row.hourlyRate, amount_including_tax: row.amount, labour_closed_at: row.closedAt })) as ProjectBudget[];
  const rollups = new Map(rollupProjects([], projects, budgets, [], [], Date.parse(data.calculatedAt), data.rows).map(row => [row.projectId, row]));
  const rows = data.rows.map(row => rollups.get(row.projectId)!);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(data.total / 50)));
  return <><PageHeader title="Labour budgets" subtitle="Track labour budgets, clocked hours, and painter costs for each job" /><ProjectsTable rows={rows} totals={data.totals} total={data.total} currentPage={page} query={query} canManage={["admin", "manager"].includes(profile.role)} /></>;
}
