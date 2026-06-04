import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

  const projects = await fetchCompanyCamProjects(companyCamToken);
  const projectsWithLabels = await attachProjectLabels(companyCamToken, projects);
  const syncedAt = new Date().toISOString();
  const rows = projectsWithLabels.map((project) => normalizeProject(project, syncedAt));

  let upserted = 0;
  for (const chunk of chunkRows(rows, 500)) {
    const { error } = await supabase
      .from("companycam_projects")
      .upsert(chunk, { onConflict: "companycam_id" });

    if (error) {
      return json({ error: error.message }, 500);
    }
    upserted += chunk.length;
  }

  return json({ synced: upserted, fetched: projects.length, lastSyncedAt: syncedAt });
});

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

function normalizeProject(project: Record<string, unknown>, syncedAt: string) {
  const idValue = project.id ?? project.project_id ?? project.uuid;
  const companycamId = String(idValue ?? "");
  if (!companycamId) throw new Error("CompanyCam project is missing an id");

  const address = asObject(project.address);
  const coordinates = asObject(project.coordinates);
  const latitude = toNumber(coordinates.latitude ?? coordinates.lat ?? project.latitude ?? project.lat);
  const longitude = toNumber(coordinates.longitude ?? coordinates.lng ?? coordinates.lon ?? project.longitude ?? project.lng ?? project.lon);
  const labels = Array.isArray(project.labels)
    ? project.labels
    : Array.isArray(project.project_labels)
      ? project.project_labels
      : [];

  return {
    companycam_id: companycamId,
    name: toText(project.name ?? project.title ?? `CompanyCam Project ${companycamId}`),
    labels,
    is_lead: hasLeadLabel(labels),
    street_address_1: toNullableText(address.street_address_1 ?? address.line_1 ?? address.address_1),
    street_address_2: toNullableText(address.street_address_2 ?? address.line_2 ?? address.address_2),
    city: toNullableText(address.city),
    state: toNullableText(address.state ?? address.region),
    postal_code: toNullableText(address.postal_code ?? address.zip ?? address.zip_code),
    country: toNullableText(address.country),
    formatted_address: toNullableText(project.formatted_address ?? project.address_string ?? formatAddress(address)),
    latitude,
    longitude,
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

function hasLeadLabel(labels: unknown[]) {
  return labels.some((label) => {
    const labelObject = asObject(label);
    const text = toNullableText(
      labelObject.value ??
      labelObject.display_value ??
      labelObject.name ??
      labelObject.title ??
      label,
    );

    if (!text) return false;

    const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return normalized === "lead" || normalized === "leads";
  });
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
