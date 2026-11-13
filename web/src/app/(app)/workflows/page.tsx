import { LiveRefresh } from "@/components/live-refresh";
import { FilterPills } from "@/components/table-ui";
import { WorkflowBoard } from "@/components/workflow-board";
import { WorkflowSettingsForm } from "@/components/workflow-settings";
import { staffRead } from "@/lib/actions/rpc";
import { getHomeOrgId, requireStaff } from "@/lib/auth";
import type { WorkflowCardSummary, WorkflowSettings } from "@/lib/workflow-types";

export const dynamic = "force-dynamic";

/** Sales › Appointment workflows. ?tab=settings for the prompt, skills and calendars. */
export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const query = await searchParams;
  const tab = query.tab === "settings" ? "settings" : "board";
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
        <h1 className="mr-auto text-base font-semibold text-[var(--color-heading)]">Appointment workflows</h1>
        <FilterPills
          label="View"
          value={tab}
          options={[
            { value: "board", label: "Board", href: "/workflows" },
            { value: "settings", label: "Settings", href: "/workflows?tab=settings" },
          ]}
        />
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
