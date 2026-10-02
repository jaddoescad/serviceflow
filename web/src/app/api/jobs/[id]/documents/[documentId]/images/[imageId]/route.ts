import { createClient } from "@/lib/supabase/server";
import { PROJECT_DOCUMENTS_BUCKET, pageImagePath } from "@/lib/project-document-types";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An image placed inside a page, served through a short-lived signed URL. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string; imageId: string }> },
) {
  const { id, documentId, imageId } = await params;
  const ids = [id, documentId, imageId].map((value) => decodeURIComponent(value));
  if (!ids.every((value) => UUID_PATTERN.test(value))) {
    return new Response("Not found", { status: 404 });
  }
  const [projectId, docId, image] = ids;

  const supabase = await createClient();
  const { data: document, error } = await supabase
    .from("project_documents")
    .select("id")
    .eq("id", docId)
    .eq("project_id", projectId)
    .eq("kind", "page")
    .maybeSingle();
  if (error || !document) return new Response("Not found", { status: 404 });

  const { data: signed, error: signError } = await supabase.storage
    .from(PROJECT_DOCUMENTS_BUCKET)
    .createSignedUrl(pageImagePath(projectId, docId, image), 300);
  if (signError || !signed) return new Response("Not found", { status: 404 });

  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, "Cache-Control": "private, max-age=240" },
  });
}
