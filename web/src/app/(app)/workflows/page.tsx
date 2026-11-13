import { AppointmentsCalendar } from "@/components/appointments-calendar";
import { LiveRefresh } from "@/components/live-refresh";
import { FilterPills } from "@/components/table-ui";
import { WorkflowBoard } from "@/components/workflow-board";
import { WorkflowSettingsForm } from "@/components/workflow-settings";
import { staffRead } from "@/lib/actions/rpc";
import { getAppointmentsCalendarData, type CalendarQuery } from "@/lib/appointments-calendar-data";
import { getHomeOrgId, requireStaff } from "@/lib/auth";
import type { WorkflowCardSummary, WorkflowSettings } from "@/lib/workflow-types";

export const dynamic = "force-dynamic";

const TITLE = "Appointment workflows";

/**
 * Sales › Appointment workflows: the board (default), ?tab=calendar for the
 * team's appointments and calendars, ?tab=settings for the prompt, skills
 * and calendars.
 */
export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<CalendarQuery & { tab?: string }> }) {
  const query = await searchParams;
  const tab = query.tab === "settings" || query.tab === "calendar" ? query.tab : "board";
  const tabs = (
    <FilterPills
      label="View"
      value={tab}
      options={[
        { value: "board", label: "Board", href: "/workflows" },
        { value: "calendar", label: "Calendar", href: "/workflows?tab=calendar" },
        { value: "settings", label: "Settings", href: "/workflows?tab=settings" },
      ]}
    />
  );

  if (tab === "calendar") {
    const [, data] = await Promise.all([requireStaff(), getAppointmentsCalendarData(query, "3day")]);
    return <AppointmentsCalendar {...data} newFor={null} basePath="/workflows?tab=calendar" title={TITLE} tabs={tabs} />;
  }

  const [, orgId] = await Promise.all([requireStaff(), getHomeOrgId()]);
  const [cards, settings] = await Promise.all([
    tab === "board" ? staffRead<WorkflowCardSummary[]>("workflow_board") : null,
    staffRead<WorkflowSettings>("get_workflow_settings"),
  ]);
  const connected = settings.people.filter((person) => person.connected).length;

  return (
    <div data-app-content="full-bleed" className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col bg-[var(--color-bg)] md:h-dvh">
      {orgId && tab === "board" ? <LiveRefresh orgId={orgId} tables={["leads"]} /> : null}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-[var(--gutter)] py-2.5">
        <h1 className="mr-auto text-base font-semibold text-[var(--color-heading)]">{TITLE}</h1>
        {tabs}
      </header>
      {tab === "board" ? (
        <WorkflowBoard cards={cards ?? []} calendarsConnected={connected} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-[var(--gutter)] py-6">
          <WorkflowSettingsForm settings={settings} />
        </div>
      )}
    </div>
  );
}
