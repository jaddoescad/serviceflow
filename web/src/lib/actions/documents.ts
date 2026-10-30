"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import type { DocumentKind } from "@/lib/proposal-types";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./rpc";

const DOCUMENT_PATHS: Record<DocumentKind, string[]> = {
  proposal: ["/proposals", "/jobs", "/pipeline"],
  change_order: ["/jobs", "/change-orders", "/pipeline"],
  invoice: ["/jobs", "/invoices", "/pipeline"],
};

function revalidate(kind: DocumentKind) {
  for (const path of DOCUMENT_PATHS[kind]) revalidatePath(path, "layout");
}

/**
 * Marks the document sent and, for email or text, queues the message in the
 * same step. The customer's address and Quo are checked first, so an error
 * leaves the document as it was. Returns the token for the customer's link.
 */
export async function sendDocument(input: {
  kind: DocumentKind;
  id: string;
  channel: "email" | "sms" | "link";
  subject: string;
  body: string;
}): Promise<{ token?: string; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_document", {
    requested_kind: input.kind,
    requested_id: input.id,
    requested_channel: input.channel,
    requested_subject: input.channel === "email" ? input.subject : "",
    requested_body: input.channel === "link" ? "" : input.body,
  });
  if (error) return { error: error.message };
  revalidate(input.kind);
  return { token: data as string };
}

/** Records files already uploaded to the document-assets bucket, after any already attached. */
export async function addDocumentAssets(input: {
  kind: DocumentKind;
  documentId: string;
  assets: { kind: "photo" | "file"; name: string; path: string; mimeType: string; byteSize: number }[];
}): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("document_assets")
    .select("id", { count: "exact", head: true })
    .eq("document_id", input.documentId);
  if (countError) return { ok: false, error: countError.message };
  const { error } = await supabase.from("document_assets").insert(
    input.assets.map((asset, index) => ({
      document_kind: input.kind,
      document_id: input.documentId,
      kind: asset.kind,
      name: asset.name.slice(0, 200),
      storage_path: asset.path,
      mime_type: asset.mimeType || null,
      byte_size: asset.byteSize,
      position: (count ?? 0) + index,
    })),
  );
  if (error) return { ok: false, error: error.message };
  revalidate(input.kind);
  return { ok: true };
}

/** Detaches a photo or file and deletes its stored copy once no other document uses it. */
export async function removeDocumentAsset(kind: DocumentKind, id: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_assets").delete().eq("id", id).select("storage_path");
  if (error) return { ok: false, error: error.message };
  const paths = (data ?? []).map((row) => row.storage_path as string);
  // A copied proposal shares its attachments' stored files.
  const { count, error: sharedError } = paths.length
    ? await supabase.from("document_assets").select("id", { count: "exact", head: true }).in("storage_path", paths)
    : { count: 0, error: null };
  // The row is gone either way; a copy left behind is unreachable without it.
  if (paths.length && !sharedError && !count) await supabase.storage.from("document-assets").remove(paths);
  revalidate(kind);
  return { ok: true };
}
