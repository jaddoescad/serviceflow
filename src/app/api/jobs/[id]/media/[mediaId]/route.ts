import { getSessionToken } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MEDIA_WORKER_URL = "https://project-media-worker.jadslim-fai.workers.dev";
const SAFE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

function mediaWorkerUrl(): string | null {
  try {
    const url = new URL(process.env.PROJECT_MEDIA_API_URL || DEFAULT_MEDIA_WORKER_URL);
    return url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

async function proxyMedia(
  request: Request,
  params: Promise<{ id: string; mediaId: string }>,
  headOnly: boolean,
) {
  const { id: encodedProjectId, mediaId: encodedMediaId } = await params;
  const projectId = decodeURIComponent(encodedProjectId);
  const mediaId = decodeURIComponent(encodedMediaId);
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(mediaId)) {
    return new Response("Not found", { status: 404 });
  }

  const token = await getSessionToken();
  if (!token) return new Response("Unauthorized", { status: 401 });

  // Bind the media UUID to this exact shared project (job or lead) before
  // asking Cloudflare for bytes.
  // Supabase RLS also confirms the signed-in user may see the row.
  const supabase = await createClient();
  const trash = new URL(request.url).searchParams.get('view') === 'trash';
  const preview = !trash && new URL(request.url).searchParams.get('preview') === '1';
  const { data: media, error } = trash ? await supabase.rpc('get_photo_trash',{
    requested_project_id:projectId,requested_media_id:mediaId,
  }).maybeSingle() : await supabase
    .from("job_media")
    .select("id")
    .eq("id", mediaId)
    .or(`job_id.eq.${projectId},lead_id.eq.${projectId}`)
    .maybeSingle();
  if (error || !media) return new Response("Not found", { status: 404 });

  const workerUrl = mediaWorkerUrl();
  if (!workerUrl) return new Response("Media service unavailable", { status: 503 });

  const range = request.headers.get("range");
  let upstream: Response;
  try { upstream = await fetch(`${workerUrl}/v1/media/${encodeURIComponent(mediaId)}${trash?'/trash':preview?'/thumbnail':''}`, {
    method: headOnly && !preview ? "HEAD" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(range && !preview ? { Range: range } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  }); } catch { return new Response('Media service unavailable. Try again.',{status:503}); }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(upstream.status === 404 ? "Not found" : "Media unavailable", {
      status: upstream.status === 401 || upstream.status === 403 ? 404 : upstream.status,
    });
  }

  const contentType = (upstream.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!SAFE_MEDIA_TYPES.has(contentType)) {
    await upstream.body?.cancel();
    return new Response("Unsupported media type", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["accept-ranges", "content-length", "content-range", "content-disposition", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  if(headOnly)await upstream.body?.cancel();
  return new Response(headOnly ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  return proxyMedia(request, params, false);
}

export function HEAD(
  request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  return proxyMedia(request, params, true);
}
