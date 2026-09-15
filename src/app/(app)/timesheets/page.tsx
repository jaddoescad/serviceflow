import { getTimesheetsPage, getEmployees, getProjects } from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/kpi";
import { TimesheetsTable } from "@/components/timesheets-table";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const filters = { search: (params.q ?? "").slice(0, 200), employee: UUID.test(params.employee ?? "") ? params.employee! : "all", project: UUID.test(params.project ?? "") ? params.project! : "all", status: ["active", "complete"].includes(params.status ?? "") ? params.status! : "all" };
  const requestedPage = Math.max(1, Math.min(1000000, Number.parseInt(params.page ?? "1", 10) || 1));
  const [profile, result, employees, projects] = await Promise.all([
    requireStaff(),
    getTimesheetsPage(filters, requestedPage),
    getEmployees(),
    getProjects(),
  ]);

  return (
    <>
      <PageHeader
        title="Timesheets"
        subtitle="Review and edit crew hours · last 90 days"
      />
      <TimesheetsTable
        entries={result.rows}
        result={result}
        filters={filters}
        currentPage={Math.min(requestedPage, Math.max(1, Math.ceil(result.total / 50)))}
        employees={employees.map(({ user_id, full_name, email }) => ({ user_id, full_name, email }))}
        projects={projects.map(({ companycam_id, name }) => ({ companycam_id, name }))}
        canDelete={profile.role === "admin"}
      />
    </>
  );
}
