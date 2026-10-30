import { getInvoices } from "@/lib/billing";
import type { DealOverview } from "@/lib/crm-types";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceProject } from "@/lib/project-workspace";
import type {
  DealExtras,
  PipelineBoard,
  PipelineCardLabel,
  PipelineKey,
  PipelineStage,
} from "@/lib/pipeline-types";
import { parseViewConfig, type SavedPipelineView } from "@/lib/pipeline-views";

/** Every column with its open cards, closed columns included. */
export async function getPipelineBoard(pipeline: PipelineKey): Promise<PipelineBoard> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_pipeline_board", {
    requested_pipeline: pipeline,
    include_closed: true,
  });
  if (error) throw new Error(`pipeline board: ${error.message}`);
  return data as PipelineBoard;
}

/** The signed-in manager's own saved views of this pipeline, by name. */
export async function getPipelineViews(pipeline: PipelineKey): Promise<SavedPipelineView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipeline_views")
    .select("id,name,config")
    .eq("pipeline", pipeline)
    .order("name");
  if (error) throw new Error(`pipeline views: ${error.message}`);
  return data.map((row) => ({ id: row.id, name: row.name, config: parseViewConfig(row.config) }));
}

export type DealRecord = {
  deal: DealOverview;
  extras: DealExtras;
  pipeline: PipelineKey;
  stages: PipelineStage[];
  labels: PipelineCardLabel[];
  updatedAt: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything the deal page shows for one deal or job; null when it is not
 * one the signed-in manager can open. Every query starts at once: the page
 * checks the manager alongside, and the database checks each read. */
export async function getDealRecord(id: string): Promise<DealRecord | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const supabase = await createClient();
  const [overview, extras, stageRows, project, placement] = await Promise.all([
    supabase.rpc("get_deal_overview", { requested_record: id }),
    getDealExtras(id),
    // The deal's pipeline isn't known yet; a company has a handful of stages.
    supabase.from("pipeline_stages").select("id,name,position,is_closed,record_status,drips_enabled").order("position"),
    getWorkspaceProject(id),
    supabase.from("pipeline_placements").select("moved_at").eq("record_id", id).maybeSingle(),
  ]);
  const deal = overview.error ? null : (overview.data as DealOverview | null);
  if (!deal) return null;
  if (stageRows.error) throw new Error(`pipeline stages: ${stageRows.error.message}`);
  const stageIds = new Set(deal.stages.map((stage) => stage.id));
  const updatedAt = [project?.updated_at, placement.data?.moved_at].reduce<string>(
    (latest, value) => (value && Date.parse(value) > Date.parse(latest) ? value : latest),
    deal.createdAt,
  );
  return {
    deal,
    extras,
    pipeline: deal.stage?.pipeline ?? (deal.kind === "job" ? "jobs" : "sales"),
    stages: stageRows.data
      .filter((row) => stageIds.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        position: row.position,
        isClosed: row.is_closed,
        recordStatus: row.record_status,
        dripsEnabled: row.drips_enabled,
      })),
    labels: (project?.labels ?? []).map(({ id: labelId, name, color }) => ({ id: labelId, name, color })),
    updatedAt,
  };
}

/** The job a deal became (or the job itself), its invoices, and the
 * documents filed on either the deal or the job. */
async function getDealExtras(recordId: string): Promise<DealExtras> {
  const supabase = await createClient();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id,lead_id,name,status,contract_amount_cents")
    .or(`id.eq.${recordId},lead_id.eq.${recordId}`)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`deal job: ${error.message}`);
  const job = jobs[0] ?? null;
  const projectIds = [...new Set([recordId, job?.id, job?.lead_id].filter((id): id is string => Boolean(id)))];
  const [documents, invoices] = await Promise.all([
    supabase
      .from("project_documents")
      .select("id,project_id,name,kind,created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(100),
    job ? getInvoices(job.id) : Promise.resolve([]),
  ]);
  if (documents.error) throw new Error(`deal documents: ${documents.error.message}`);
  return {
    job: job
      ? { id: job.id, name: job.name, status: job.status, valueCents: job.contract_amount_cents }
      : null,
    invoices,
    documents: documents.data.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      kind: row.kind === "page" ? "page" : "file",
      createdAt: row.created_at,
    })),
  };
}
