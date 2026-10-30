import { notFound } from "next/navigation";
import { PipelineView } from "@/components/pipeline-board";
import { requireStaff } from "@/lib/auth";
import { getCustomerListOptions } from "@/lib/contacts";
import { getPipelineBoard, getPipelineViews } from "@/lib/pipeline";
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
  const [profile, board, labels, savedViews, options] = await Promise.all([
    requireStaff(),
    getPipelineBoard(pipeline),
    getProjectLabels(),
    getPipelineViews(pipeline),
    getCustomerListOptions(),
  ]);
  return (
    <PipelineView
      key={pipeline}
      board={board}
      labels={labels}
      savedViews={savedViews}
      userId={profile.user_id}
      team={options.team}
      viewId={query.v ?? null}
      view={query.view === "list" ? "list" : "board"}
    />
  );
}
