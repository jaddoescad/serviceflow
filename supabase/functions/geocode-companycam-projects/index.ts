import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const REQUEST_DELAY_MS = 1100;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Missing Supabase service environment" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const options = await parseOptions(req);
  const limit = clampNumber(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const includeLeads = Boolean(options.includeLeads);

  let query = supabase
    .from("companycam_projects")
    .select("companycam_id,name,formatted_address,street_address_1,street_address_2,city,state,postal_code,country")
    .eq("is_archived", false)
    .or("latitude.is.null,longitude.is.null")
    .order("companycam_updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (!includeLeads) query = query.eq("is_lead", false);

  const { data: projects, error } = await query;
  if (error) return json({ error: error.message }, 500);

  let geocoded = 0;
  let failed = 0;
  const results: Record<string, unknown>[] = [];

  for (const [index, project] of (projects || []).entries()) {
    const geocodeQuery = formatProjectAddress(project);

    if (!geocodeQuery) {
      failed += 1;
      await markGeocodeError(supabase, project.companycam_id, "Missing project address");
      results.push({ companycam_id: project.companycam_id, status: "skipped", error: "Missing project address" });
      continue;
    }

    const location = await geocodeAddress(geocodeQuery);

    if (location) {
      const { error: updateError } = await supabase
        .from("companycam_projects")
        .update({
          latitude: location.latitude,
          longitude: location.longitude,
          geocoded_at: new Date().toISOString(),
          geocode_source: location.source,
          geocode_query: geocodeQuery,
          geocode_error: null,
        })
        .eq("companycam_id", project.companycam_id);

      if (updateError) {
        failed += 1;
        results.push({ companycam_id: project.companycam_id, status: "failed", error: updateError.message });
      } else {
        geocoded += 1;
        results.push({ companycam_id: project.companycam_id, status: "geocoded" });
      }
    } else {
      failed += 1;
      await markGeocodeError(supabase, project.companycam_id, "No geocode match found");
      results.push({ companycam_id: project.companycam_id, status: "failed", error: "No geocode match found" });
    }

    if (index < (projects || []).length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  return json({
    scanned: projects?.length || 0,
    geocoded,
    failed,
    results,
  });
});

async function parseOptions(req: Request) {
  if (req.method !== "POST") return {};

  try {
    return await req.json();
  } catch (_error) {
    return {};
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function formatProjectAddress(project: Record<string, unknown>) {
  const direct = toNullableText(project.formatted_address);
  if (direct) return direct;

  const parts = [
    project.street_address_1,
    project.street_address_2,
    project.city,
    project.state,
    project.postal_code,
    project.country || "Canada",
  ].map(toNullableText).filter(Boolean);

  return parts.length ? parts.join(", ") : null;
}

async function geocodeAddress(query: string) {
  const email = Deno.env.get("GEOCODING_EMAIL") || "info@paintersottawa.com";
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("email", email);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "User-Agent": `OttawaPaintersApp/1.0 (${email})`,
      },
    });

    if (!response.ok) return null;

    const payload = await response.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    const latitude = Number(first?.lat);
    const longitude = Number(first?.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      latitude,
      longitude,
      source: "nominatim",
    };
  } catch (_error) {
    return null;
  }
}

async function markGeocodeError(supabase: ServiceClient, companycamId: string, error: string) {
  await supabase
    .from("companycam_projects")
    .update({
      geocoded_at: new Date().toISOString(),
      geocode_error: error,
    })
    .eq("companycam_id", companycamId);
}

function toNullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
