import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;

const COMPANYCAM_API_BASE = "https://api.companycam.com/v2";
const DEFAULT_PER_PAGE = 30;
const MAX_PER_PAGE = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const companyCamToken = Deno.env.get("COMPANYCAM_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!companyCamToken) return json({ error: "Missing COMPANYCAM_API_KEY secret" }, 500);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Missing Supabase service environment" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    await authorizeEmployee(req, supabase);

    const input = await readInput(req);
    const jobId = String(input.jobId ?? input.job_id ?? input.projectId ?? input.project_id ?? input.id ?? "").trim();
    if (!jobId) throw httpError("Missing jobId", 400);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,companycam_project_ids")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw httpError(jobError.message, 500);
    if (!job) throw httpError("Job not found", 404);
    const companyCamProjectIds = Array.isArray(job.companycam_project_ids)
      ? job.companycam_project_ids.map(String).filter(Boolean)
      : [];
    if (!companyCamProjectIds.length) {
      return json({ projectId: jobId, jobId, page: 1, perPage: 0, count: 0, photos: [] });
    }

    const page = clampNumber(input.page, 1, 1, 500);
    const perPage = clampNumber(input.perPage ?? input.per_page, DEFAULT_PER_PAGE, 1, MAX_PER_PAGE);

    const responses = await Promise.all(companyCamProjectIds.map(async (companyCamProjectId) => {
      const url = new URL(`${COMPANYCAM_API_BASE}/projects/${encodeURIComponent(companyCamProjectId)}/photos`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(perPage));
      const response = await fetch(url, { headers: { accept: "application/json", Authorization: `Bearer ${companyCamToken}` } });
      if (!response.ok) {
        console.error(`CompanyCam photos failed for linked project ${companyCamProjectId}: ${response.status}`);
        return { photos: [], nextCursor: null, prevCursor: null };
      }
      const payload = await response.json();
      return {
        photos: extractPhotos(payload).map(normalizePhoto).filter((photo) => photo.thumbnailUrl || photo.url),
        nextCursor: response.headers.get("X-Next-Cursor"),
        prevCursor: response.headers.get("X-Prev-Cursor"),
      };
    }));
    const photos = responses.flatMap((response) => response.photos);

    return json({
      projectId: jobId,
      jobId,
      companyCamProjectIds,
      page,
      perPage,
      count: photos.length,
      nextCursor: responses.some((response) => response.nextCursor) ? String(page + 1) : null,
      prevCursor: page > 1 ? String(page - 1) : null,
      photos,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    return json({ error: error?.message || "CompanyCam photos request failed" }, status);
  }
});

async function authorizeEmployee(req: Request, supabase: ServiceClient) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw httpError("Missing employee authorization", 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw httpError("Invalid employee authorization", 401);

  const { data: profile, error: profileError } = await supabase
    .from("employees")
    .select("id,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw httpError(profileError.message, 500);
  if (!profile?.is_active) throw httpError("Only active employees can view CompanyCam photos", 403);

  return { userId: user.id };
}

async function readInput(req: Request) {
  const url = new URL(req.url);
  const fromQuery = Object.fromEntries(url.searchParams.entries());

  if (req.method === "GET") return fromQuery;

  try {
    const body = await req.json();
    return { ...fromQuery, ...(body && typeof body === "object" ? body : {}) };
  } catch {
    return fromQuery;
  }
}

function extractPhotos(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];

  const body = payload as Record<string, unknown>;
  if (Array.isArray(body.photos)) return body.photos as Record<string, unknown>[];
  if (Array.isArray(body.data)) return body.data as Record<string, unknown>[];

  return [];
}

function normalizePhoto(photo: Record<string, unknown>) {
  const imageUrls = extractImageUrls(photo);
  const thumbnailUrl = pickImageUrl(imageUrls, ["thumbnail", "thumb", "small", "medium"]) ?? imageUrls[0]?.url ?? null;
  const url = pickImageUrl(imageUrls, ["original", "large", "full", "medium"]) ?? thumbnailUrl;
  const creator = asObject(photo.creator ?? photo.user ?? photo.created_by);

  return {
    id: toText(photo.id ?? photo.photo_id ?? photo.uuid),
    url,
    thumbnailUrl,
    capturedAt: toIsoDate(photo.captured_at ?? photo.taken_at ?? photo.created_at ?? photo.inserted_at),
    creatorName: toNullableText(creator.name ?? creator.full_name ?? creator.email ?? photo.creator_name),
    description: toNullableText(photo.description ?? photo.caption ?? photo.notes),
    raw: photo,
  };
}

function extractImageUrls(photo: Record<string, unknown>) {
  const urls: { type: string; url: string }[] = [];
  const directFields = [
    "url",
    "uri",
    "image_url",
    "photo_url",
    "thumbnail_url",
    "thumb_url",
    "original_url",
    "large_url",
    "medium_url",
    "small_url",
    "download_url",
  ];

  for (const field of directFields) {
    const value = toNullableText(photo[field]);
    if (value) urls.push({ type: field.replace("_url", ""), url: value });
  }

  const collections = [photo.uris, photo.urls, photo.image_uris, photo.image_urls, photo.variants, photo.images];
  for (const collection of collections) {
    appendUrlCollection(urls, collection);
  }

  return dedupeUrls(urls);
}

function appendUrlCollection(urls: { type: string; url: string }[], collection: unknown) {
  if (Array.isArray(collection)) {
    for (const item of collection) appendUrlItem(urls, item);
    return;
  }

  if (collection && typeof collection === "object") {
    for (const [type, item] of Object.entries(collection as Record<string, unknown>)) {
      if (typeof item === "string") {
        urls.push({ type, url: item });
      } else {
        appendUrlItem(urls, item, type);
      }
    }
  }
}

function appendUrlItem(urls: { type: string; url: string }[], item: unknown, fallbackType = "image") {
  if (!item || typeof item !== "object") return;
  const object = item as Record<string, unknown>;
  const url = toNullableText(object.url ?? object.uri ?? object.href ?? object.src);
  if (!url) return;
  urls.push({ type: toText(object.type ?? object.name ?? fallbackType), url });
}

function pickImageUrl(urls: { type: string; url: string }[], preferredTypes: string[]) {
  for (const type of preferredTypes) {
    const match = urls.find((item) => item.type.toLowerCase().includes(type));
    if (match?.url) return match.url;
  }
  return null;
}

function dedupeUrls(urls: { type: string; url: string }[]) {
  const seen = new Set<string>();
  return urls.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "";
}

function toNullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toIsoDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
