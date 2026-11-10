import { createClient } from "@/lib/supabase/server";
import type { DocumentAsset, DocumentDelivery, DocumentKind } from "@/lib/proposal-types";

type Row = Record<string, any>;

const DOCUMENT_TABLES: Record<DocumentKind, string> = {
  proposal: "quotes",
  change_order: "change_orders",
  invoice: "invoices",
};

/** What a document editor shows beside the lines: its company, attachments and latest delivery. */
export type DocumentExtras = {
  /** The company that owns the document; uploads are stored under it. */
  orgId: string;
  /** Fills the company into the send dialog's default messages. */
  company: { name: string; phone: string | null } | null;
  assets: DocumentAsset[];
  delivery: DocumentDelivery | null;
};

export async function getDocumentExtras(kind: DocumentKind, id: string): Promise<DocumentExtras | null> {
  const supabase = await createClient();
  const [document, assets, delivery] = await Promise.all([
    supabase.from(DOCUMENT_TABLES[kind]).select("org_id").eq("id", id).maybeSingle(),
    supabase
      .from("document_assets")
      .select("id,kind,name,storage_path,mime_type,byte_size")
      .eq("document_id", id)
      .order("position")
      .order("created_at"),
    supabase
      .from("outbound_messages")
      .select("channel,status,error,sent_at,created_at")
      .eq("document_kind", kind)
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (document.error) throw new Error(`document: ${document.error.message}`);
  if (assets.error) throw new Error(`document files: ${assets.error.message}`);
  if (delivery.error) throw new Error(`document delivery: ${delivery.error.message}`);
  if (!document.data) return null;
  const orgId = (document.data as Row).org_id as string;
  // Only prefills messages, so a failed read leaves the placeholders in.
  const { data: company } = await supabase.from("organizations").select("name,phone").eq("id", orgId).maybeSingle();
  const message = delivery.data as Row | null;
  return {
    orgId,
    company: company ? { name: company.name, phone: company.phone ?? null } : null,
    assets: (assets.data ?? []).map((row: Row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      path: row.storage_path,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size ?? 0),
    })),
    delivery: message
      ? {
          channel: message.channel,
          status: message.status,
          error: message.error,
          sentAt: message.sent_at,
          createdAt: message.created_at,
        }
      : null,
  };
}

