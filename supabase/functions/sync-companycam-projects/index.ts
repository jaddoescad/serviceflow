import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;

const COMPANYCAM_API_BASE = "https://api.companycam.com/v2";
const PAGE_SIZE = 50;
const MAX_PAGES = 50;

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
    await authorizeSyncRequest(req, supabase);

    const projects = await fetchCompanyCamProjects(companyCamToken);
    const projectsWithLabels = await attachProjectLabels(companyCamToken, projects);
    const syncedAt = new Date().toISOString();
    const existingProjects = await fetchExistingProjectMap(supabase, projectsWithLabels);
    const rows = projectsWithLabels.map((project) => normalizeProject(project, syncedAt, existingProjects));

    let upserted = 0;
    for (const chunk of chunkRows(rows, 500)) {
      const { error } = await supabase
        .from("companycam_projects")
        .upsert(chunk, { onConflict: "companycam_id" });

      if (error) {
        throw httpError(error.message, 500);
      }
      upserted += chunk.length;
    }

    return json({ synced: upserted, fetched: projects.length, lastSyncedAt: syncedAt });
  } catch (error) {
    const status = Number(error?.status || 500);
    return json({ error: error?.message || "CompanyCam sync failed" }, status);
  }
});

async function authorizeSyncRequest(req: Request, supabase: ServiceClient) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = Deno.env.get("COMPANYCAM_SYNC_CRON_SECRET");

  if (cronSecret && token && token === cronSecret) {
    return { userId: "companycam-sync-cron", role: "cron" };
  }

  return authorizeManagerToken(token, supabase);
}

async function authorizeManagerToken(token: string, supabase: ServiceClient) {
  if (!token) throw httpError("Missing manager authorization", 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw httpError("Invalid manager authorization", 401);

  const { data: profile, error: profileError } = await supabase
    .from("employee_profiles")
    .select("user_id,role,is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) throw httpError(profileError.message, 500);
  const role = String(profile?.role || "");
  if (!profile?.is_active || !["admin", "manager"].includes(role)) {
    throw httpError("Only active admins and managers can sync CompanyCam projects", 403);
  }

  return { userId: user.id, role };
}

async function fetchCompanyCamProjects(token: string) {
  const projects: Record<string, unknown>[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${COMPANYCAM_API_BASE}/projects`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PAGE_SIZE));

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`CompanyCam returned ${response.status}: ${message}`);
    }

    const payload = await response.json();
    const pageProjects = extractProjects(payload);
    projects.push(...pageProjects);

    if (pageProjects.length < PAGE_SIZE) break;
  }

  return projects;
}

async function attachProjectLabels(token: string, projects: Record<string, unknown>[]) {
  const labelledProjects: Record<string, unknown>[] = [];
  const concurrency = 8;

  for (let index = 0; index < projects.length; index += concurrency) {
    const chunk = projects.slice(index, index + concurrency);
    const labelledChunk = await Promise.all(
      chunk.map(async (project) => {
        const projectId = String(project.id ?? project.project_id ?? project.uuid ?? "").trim();
        if (!projectId) return project;

        const labels = await fetchProjectLabels(token, projectId);
        return {
          ...project,
          labels,
          project_labels: labels,
        };
      }),
    );

    labelledProjects.push(...labelledChunk);
  }

  return labelledProjects;
}

async function fetchExistingProjectMap(supabase: ServiceClient, projects: Record<string, unknown>[]) {
  const ids = projects
    .map((project) => String(project.id ?? project.project_id ?? project.uuid ?? "").trim())
    .filter(Boolean);
  const existingProjects = new Map<string, Record<string, unknown>>();

  for (const chunk of chunkRows(ids, 500)) {
    const { data, error } = await supabase
      .from("companycam_projects")
      .select("companycam_id,latitude,longitude,geocoded_at,geocode_source,geocode_query,geocode_error")
      .in("companycam_id", chunk);

    // Fail loudly: proceeding with an empty map would treat every project as
    // brand new and wipe existing geocoded coordinates on upsert.
    if (error) throw httpError(error.message, 500);

    for (const project of data || []) {
      existingProjects.set(String(project.companycam_id), project);
    }
  }

  return existingProjects;
}

async function fetchProjectLabels(token: string, projectId: string) {
  const labels: Record<string, unknown>[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${COMPANYCAM_API_BASE}/projects/${encodeURIComponent(projectId)}/labels`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PAGE_SIZE));

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 404) return labels;
    if (!response.ok) return labels;

    const payload = await response.json();
    const pageLabels = extractLabels(payload);
    labels.push(...pageLabels);

    if (pageLabels.length < PAGE_SIZE) break;
  }

  return labels;
}

function extractLabels(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];

  const body = payload as Record<string, unknown>;
  if (Array.isArray(body.labels)) return body.labels as Record<string, unknown>[];
  if (Array.isArray(body.data)) return body.data as Record<string, unknown>[];

  return [];
}

function extractProjects(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];

  const body = payload as Record<string, unknown>;
  if (Array.isArray(body.projects)) return body.projects as Record<string, unknown>[];
  if (Array.isArray(body.data)) return body.data as Record<string, unknown>[];

  return [];
}

function normalizeProject(
  project: Record<string, unknown>,
  syncedAt: string,
  existingProjects: Map<string, Record<string, unknown>>,
) {
  const idValue = project.id ?? project.project_id ?? project.uuid;
  const companycamId = String(idValue ?? "");
  if (!companycamId) throw new Error("CompanyCam project is missing an id");

  const address = asObject(project.address);
  const coordinates = asObject(project.coordinates);
  const rawLatitude = toNumber(coordinates.latitude ?? coordinates.lat ?? project.latitude ?? project.lat);
  const rawLongitude = toNumber(coordinates.longitude ?? coordinates.lng ?? coordinates.lon ?? project.longitude ?? project.lng ?? project.lon);
  const hasCompanyCamCoordinates = rawLatitude != null && rawLongitude != null;
  const existingProject = existingProjects.get(companycamId) || {};
  const latitude = hasCompanyCamCoordinates ? rawLatitude : toNumber(existingProject.latitude);
  const longitude = hasCompanyCamCoordinates ? rawLongitude : toNumber(existingProject.longitude);
  const labels = Array.isArray(project.labels)
    ? project.labels
    : Array.isArray(project.project_labels)
      ? project.project_labels
      : [];

  return {
    companycam_id: companycamId,
    name: toText(project.name ?? project.title ?? `CompanyCam Project ${companycamId}`),
    labels,
    is_lead: isLeadOnlyProject(labels),
    street_address_1: toNullableText(address.street_address_1 ?? address.line_1 ?? address.address_1),
    street_address_2: toNullableText(address.street_address_2 ?? address.line_2 ?? address.address_2),
    city: toNullableText(address.city),
    state: toNullableText(address.state ?? address.region),
    postal_code: toNullableText(address.postal_code ?? address.zip ?? address.zip_code),
    country: toNullableText(address.country),
    formatted_address: toNullableText(project.formatted_address ?? project.address_string ?? formatAddress(address)),
    latitude,
    longitude,
    geocoded_at: hasCompanyCamCoordinates ? syncedAt : existingProject.geocoded_at ?? null,
    geocode_source: hasCompanyCamCoordinates ? "companycam" : existingProject.geocode_source ?? null,
    geocode_query: hasCompanyCamCoordinates ? null : existingProject.geocode_query ?? null,
    geocode_error: hasCompanyCamCoordinates ? null : existingProject.geocode_error ?? null,
    is_archived: isArchivedProject(project),
    companycam_created_at: toIsoDate(project.created_at ?? project.inserted_at),
    companycam_updated_at: toIsoDate(project.updated_at ?? project.modified_at ?? project.last_activity_at),
    raw: project,
    last_synced_at: syncedAt,
    updated_at: syncedAt,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "Untitled Project";
}

function toNullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toIsoDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeLabelText(label: unknown) {
  const labelObject = asObject(label);
  const text = toNullableText(
    labelObject.value ??
    labelObject.display_value ??
    labelObject.name ??
    labelObject.title ??
    label,
  );

  return text?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || "";
}

function isLeadOnlyProject(labels: unknown[]) {
  const normalizedLabels = labels
    .map(normalizeLabelText)
    .filter(Boolean);

  return normalizedLabels.some((label) => label === "lead" || label === "leads") &&
    !normalizedLabels.some((label) => label !== "lead" && label !== "leads");
}

function isArchivedProject(project: Record<string, unknown>) {
  const status = toNullableText(project.status);
  return Boolean(project.archived ?? project.is_archived ?? false) || status?.toLowerCase() === "deleted";
}

function formatAddress(address: Record<string, unknown>) {
  const parts = [
    address.street_address_1,
    address.street_address_2,
    address.city,
    address.state,
    address.postal_code,
    address.country,
  ].map(toNullableText).filter(Boolean);

  return parts.length ? parts.join(", ") : null;
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
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
