import { createClient } from "@/lib/supabase/server";
import { PROJECT_DOCUMENTS_BUCKET } from "@/lib/project-document-types";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Open (or with ?download=1, download) a project document via a short-lived signed URL. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id, documentId } = await params;
  const projectId = decodeURIComponent(id);
  const docId = decodeURIComponent(documentId);
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(docId)) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data: document, error } = await supabase
    .from("project_documents")
    .select("name,kind,storage_path")
    .eq("id", docId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !document) return new Response("Not found", { status: 404 });
  if (document.kind === "page" || !document.storage_path) {
    return Response.redirect(
      new URL(`/jobs/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}`, request.url),
      302,
    );
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const { data: signed, error: signError } = await supabase.storage
    .from(PROJECT_DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, 60, download ? { download: document.name } : undefined);
  if (signError || !signed) return new Response("Document unavailable", { status: 503 });

  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, "Cache-Control": "no-store" },
  });
}
