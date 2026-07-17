import { getTimeEntries, getEmployees, getProjects } from "@/lib/queries";
import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/kpi";
import { TimesheetsTable } from "@/components/timesheets-table";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function TimesheetsPage() {
  const [profile, entries, employees, projects] = await Promise.all([
    requireStaff(),
    getTimeEntries(new Date(Date.now() - 90 * DAY).toISOString()),
    getEmployees(),
    getProjects(),
  ]);

  return (
    <>
      <PageHeader
        title="Timesheets"
        subtitle="Review, edit, and approve crew hours · last 90 days"
      />
      <TimesheetsTable
        entries={entries}
        employees={employees}
        projects={projects}
        canDelete={profile.role === "admin"}
      />
    </>
  );
}
