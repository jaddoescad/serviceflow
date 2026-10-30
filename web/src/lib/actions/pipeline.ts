"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import type { PipelineCard, PipelineKey } from "@/lib/pipeline-types";
import type { PipelineViewConfig } from "@/lib/pipeline-views";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A pipeline's archived cards, for when one of its "Archived" is opened. */
export async function getArchivedCards(pipeline: PipelineKey): Promise<{ cards?: PipelineCard[]; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_pipeline_board", {
    requested_pipeline: pipeline,
    include_closed: true,
    archived_cards: true,
  });
  if (error) return { error: "Could not load archived cards." };
  return { cards: (data as { cards: PipelineCard[] }).cards };
}

/** Edits a note on whichever record it was written on (a job shows its
 * deal's notes too). */
export async function updateDealNote(input: { id: string; body: string }): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { data: note, error: findError } = await supabase
    .from("project_notes")
    .select("project_id")
    .eq("id", input.id)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };
  if (!note) return { ok: false, error: "This note was deleted." };
  const { error } = await supabase.rpc("save_project_note", {
    requested_id: input.id,
    requested_project: note.project_id,
    requested_body: input.body,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function movePipelineCard(input: {
  recordId: string;
  stageId: string;
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_pipeline_card", {
    requested_record: input.recordId,
    requested_stage: input.stageId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pipeline", "layout");
  return { ok: true };
}

/** Archived deals stay in their column, faded; restoring puts them back. */
export async function setDealArchived(recordId: string, archived: boolean): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_deal_archived", {
    requested_record: recordId,
    requested_archived: archived,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pipeline", "layout");
  return { ok: true };
}

export async function createLead(input: {
  id: string;
  contactId: string;
  address: string;
  source: string;
}): Promise<{ id?: string; error?: string }> {
  await requireStaff();
  if (!input.contactId) return { error: "Choose a customer." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_lead", {
    requested_id: input.id,
    requested_contact: input.contactId,
    requested_address: input.address,
    requested_source: input.source,
  });
  if (error) return { error: error.message };
  revalidatePath("/pipeline", "layout");
  return { id: data as string };
}

/** Creates or updates one of the signed-in manager's saved views. */
export async function savePipelineView(input: {
  id: string;
  pipeline: PipelineKey;
  name: string;
  config: PipelineViewConfig;
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_pipeline_view", {
    requested_id: input.id,
    requested_pipeline: input.pipeline,
    requested_name: input.name,
    requested_config: input.config,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/pipeline/${input.pipeline}`);
  return { ok: true };
}

export async function deletePipelineView(input: { id: string; pipeline: PipelineKey }): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_pipeline_view", { requested_id: input.id });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/pipeline/${input.pipeline}`);
  return { ok: true };
}

export type BulkResult = { ok: boolean; count?: number; error?: string };

function bulkTargets(input: { recordIds?: string[]; contactIds?: string[] }) {
  const ids = (values?: string[]) => (values ?? []).filter((value) => UUID_PATTERN.test(value));
  return { requested_records: ids(input.recordIds), requested_contacts: ids(input.contactIds) };
}

/** Sets (or clears) the salesperson on chosen deals and jobs, and on the open
 * deals of chosen customers. `count` is how many deals or jobs it covered. */
export async function bulkAssignSalesperson(input: {
  recordIds?: string[];
  contactIds?: string[];
  salespersonId: string | null;
}): Promise<BulkResult> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_assign_salesperson", {
    ...bulkTargets(input),
    requested_salesperson: input.salespersonId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pipeline", "layout");
  revalidatePath("/contacts");
  return { ok: true, count: data as number };
}

/** Adds a label to chosen deals and jobs, and to the open deals of chosen customers. */
export async function bulkAddLabel(input: {
  recordIds?: string[];
  contactIds?: string[];
  labelId: string;
}): Promise<BulkResult> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_add_label", {
    ...bulkTargets(input),
    requested_label: input.labelId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pipeline", "layout");
  revalidatePath("/contacts");
  return { ok: true, count: data as number };
}
