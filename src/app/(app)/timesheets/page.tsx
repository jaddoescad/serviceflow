import { getTimesheetsPage } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/kpi";
import { TimesheetsTable } from "@/components/timesheets-table";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const filters = { search: (params.q ?? "").slice(0, 200), employee: UUID.test(params.employee ?? "") ? params.employee! : "all", project: UUID.test(params.project ?? "") ? params.project! : "all", status: ["active", "complete"].includes(params.status ?? "") ? params.status! : "all" };
  const requestedPage = Math.max(1, Math.min(1000000, Number.parseInt(params.page ?? "1", 10) || 1));
  const fetchStarted = performance.now();
  const [profile, result, options] = await Promise.all([
    requireStaff(),
    getTimesheetsPage(filters, requestedPage),
    createClient().then(client => client.rpc("get_timesheet_options")),
  ]);

  if (options.error) throw new Error(`timesheet filters: ${options.error.message}`);

  return (
    <>
      <span hidden data-perf-fetch-ms={Math.round(performance.now() - fetchStarted)} />
      <PageHeader
        title="Timesheets"
        subtitle="Review and edit crew hours · last 90 days"
      />
      <TimesheetsTable
        entries={result.rows}
        result={result}
        filters={filters}
        currentPage={Math.min(requestedPage, Math.max(1, Math.ceil(result.total / 50)))}
        employees={options.data.employees}
        projects={options.data.projects}
        canDelete={profile.role === "admin"}
      />
    </>
  );
}
