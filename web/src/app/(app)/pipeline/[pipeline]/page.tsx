import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";
import { PipelineView } from "@/components/pipeline-board";
import { getBookingMessages } from "@/lib/actions/reminders";
import { getAppointmentTeam } from "@/lib/appointments";
import { getHomeOrgId, requireStaff } from "@/lib/auth";
import { getCustomerListOptions } from "@/lib/contacts";
import { getNewLeadIds, getPipelineBoard, getPipelineViews } from "@/lib/pipeline";
import { isPipelineKey } from "@/lib/pipeline-types";
import { getProjectLabels } from "@/lib/project-workspace";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ pipeline: string }>;
  searchParams: Promise<{ view?: string; v?: string }>;
}) {
  const [{ pipeline }, query] = await Promise.all([params, searchParams]);
  if (!isPipelineKey(pipeline)) notFound();
  const [profile, board, labels, savedViews, options, messages, orgId, newIds, bookingTeam] = await Promise.all([
    requireStaff(),
    getPipelineBoard(pipeline),
    getProjectLabels(),
    getPipelineViews(pipeline),
    getCustomerListOptions(),
    // Deals book estimates from their cards.
    pipeline === "sales" ? getBookingMessages() : { rules: [], companyName: "" },
    getHomeOrgId(),
    pipeline === "sales" ? getNewLeadIds() : [],
    pipeline === "sales" ? getAppointmentTeam() : [],
  ]);
  return (
    <>
      {orgId && <LiveRefresh orgId={orgId} tables={["leads", "contacts"]} />}
      <PipelineView
        key={pipeline}
        board={board}
        newIds={newIds}
        labels={labels}
        savedViews={savedViews}
        userId={profile.user_id}
        team={options.team}
        bookingTeam={bookingTeam}
        messages={messages}
        viewId={query.v ?? null}
        view={query.view === "list" ? "list" : "board"}
      />
    </>
  );
}
