import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";
import { PipelineView } from "@/components/pipeline-board";
import { getReminderRules } from "@/lib/actions/reminders";
import { APPOINTMENT_KINDS } from "@/lib/appointment-types";
import { getHomeOrgId, requireStaff } from "@/lib/auth";
import { getCustomerListOptions } from "@/lib/contacts";
import { getPipelineBoard, getPipelineViews } from "@/lib/pipeline";
import { isPipelineKey } from "@/lib/pipeline-types";
import { getProjectLabels } from "@/lib/project-workspace";
import { sendsConfirmation } from "@/lib/reminder-types";

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
  const [profile, board, labels, savedViews, options, rules, orgId] = await Promise.all([
    requireStaff(),
    getPipelineBoard(pipeline),
    getProjectLabels(),
    getPipelineViews(pipeline),
    getCustomerListOptions(),
    // Deals book estimates from their cards.
    pipeline === "sales" ? getReminderRules() : [],
    getHomeOrgId(),
  ]);
  return (
    <>
      {orgId && <LiveRefresh orgId={orgId} tables={["leads", "contacts"]} />}
      <PipelineView
        key={pipeline}
        board={board}
        labels={labels}
        savedViews={savedViews}
        userId={profile.user_id}
        team={options.team}
        confirmationKinds={APPOINTMENT_KINDS.map(({ id }) => id).filter((kind) => sendsConfirmation(rules, "appointment", kind))}
        viewId={query.v ?? null}
        view={query.view === "list" ? "list" : "board"}
      />
    </>
  );
}
