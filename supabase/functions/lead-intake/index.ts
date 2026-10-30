import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Leads posted by Zapier, Make, Facebook Lead Ads (through Zapier/Make) and
// Google Ads lead form webhooks. Each company has a secret token, passed as
// ?token=, a Bearer header or Google's google_key. ?source= (zapier,
// facebook, google) picks the default lead source. Accepts JSON or form posts,
// maps the usual field names, and hands the rest to receive_lead_intake,
// which matches the customer, adds the deal and logs the delivery.
// Deploy with --no-verify-jwt.

const MAX_BODY_BYTES = 64 * 1024;
const SOURCES = new Set(["zapier", "facebook", "google"]);

type Flat = Map<string, string>;

const ALIASES = {
  name: ["full_name", "name", "fullname", "contact_name", "customer_name", "your_name", "client_name"],
  firstName: ["first_name", "firstname", "fname", "given_name"],
  lastName: ["last_name", "lastname", "lname", "surname", "family_name"],
  email: ["email", "email_address", "user_email", "work_email", "e_mail", "contact_email", "your_email"],
  phone: [
    "phone", "phone_number", "phonenumber", "user_phone", "mobile", "mobile_phone", "mobile_number", "cell",
    "cell_phone", "telephone", "tel", "work_phone", "contact_phone", "your_phone",
  ],
  street: ["street_address", "address", "address_1", "address1", "address_line_1", "street", "user_address", "full_address", "formatted_address"],
  city: ["city", "town", "user_city"],
  province: ["province", "state", "region", "state_province"],
  postalCode: ["postal_code", "zip", "zip_code", "zipcode", "postcode", "post_code"],
  country: ["country"],
  notes: ["notes", "note", "message", "comments", "comment", "details", "description", "project_details", "additional_information", "inquiry"],
  service: ["service", "services", "service_type", "project_type", "job_type", "interested_in", "service_needed"],
  source: ["source", "lead_source"],
  externalId: ["lead_id", "leadgen_id", "external_id", "id"],
  form: ["form_name", "form_id"],
  campaign: ["campaign_name", "campaign_id", "ad_name", "adset_name"],
  isTest: ["is_test", "test"],
} as const;

// Ad-platform bookkeeping that isn't an answer to a form question.
const IGNORED = new Set([
  "token", "google_key", "key", "secret", "api_key", "api_version", "gcl_id", "gclid", "adgroup_id", "creative_id",
  "asset_id", "ad_id", "adset_id", "page_id", "page_name", "platform", "is_organic", "created_time", "created_at",
  "timestamp", "submitted_at", "lead_status", "user_column_data", "field_data", "retailer_item_id",
]);
const SECRET_KEYS = new Set(["token", "google_key", "key", "secret", "api_key"]);
const SOURCE_LABELS: Record<string, string> = { facebook: "Facebook", google: "Google Ads", zapier: "Webhook" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Lead intake is not configured" }, 500);

  const contentLength = Number(req.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Request body is too large" }, 413);
  }
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Request body is too large" }, 413);
  }
  const body = parseBody(rawBody, req.headers.get("Content-Type") || "");
  if (!body) return json({ ok: false, error: "Send the lead as JSON or a form post" }, 400);

  const url = new URL(req.url);
  const token = (
    url.searchParams.get("token") ||
    (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") ||
    text(body.google_key) ||
    text(body.token)
  ).trim();
  if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

  const flat = flatten(body);
  const requested = (url.searchParams.get("source") || "").toLowerCase();
  const source = SOURCES.has(requested)
    ? requested
    : Array.isArray(body.user_column_data)
      ? "google"
      : Array.isArray(body.field_data)
        ? "facebook"
        : "zapier";
  const lead = mapLead(flat, source);
  const isTest = ["true", "1", "yes"].includes(pick(flat, ALIASES.isTest).toLowerCase());
  const dedupeKey = lead.externalId ? `${source}:${lead.externalId}` : `sha:${await sha256(rawBody)}`;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("receive_lead_intake", {
    requested_token: token,
    requested_source: source,
    requested_lead: lead,
    requested_payload: withoutSecrets(body),
    requested_dedupe_key: dedupeKey,
    requested_is_test: isTest,
  });
  if (error) {
    console.error("Lead intake failed", { source, code: error.code || "unknown", message: error.message });
    return json({ ok: false, error: "Lead intake failed" }, 500);
  }
  const result = (data ?? {}) as { status?: string; leadId?: string; error?: string };
  switch (result.status) {
    case "created":
    case "duplicate":
    case "test":
      return json({ ok: true, status: result.status, leadId: result.leadId ?? null });
    case "unauthorized":
      return json({ ok: false, error: "Unauthorized" }, 401);
    case "rate_limited":
      return json({ ok: false, error: "Too many leads this hour" }, 429);
    case "rejected":
      return json({ ok: false, status: "rejected", error: result.error ?? "Lead rejected" }, 422);
    default:
      return json({ ok: false, error: "Lead intake failed" }, 500);
  }
});

function parseBody(raw: string, contentType: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const type = contentType.toLowerCase();
  if (type.includes("json") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") return parsed[0] as Record<string, unknown>;
    } catch {
      if (type.includes("json")) return null;
    }
  }
  if (type.includes("multipart/form-data")) return null; // Zapier and Make send JSON or urlencoded.
  const params = new URLSearchParams(trimmed);
  const result: Record<string, unknown> = {};
  for (const [key, value] of params) result[key] = key in result ? `${result[key]}, ${value}` : value;
  return Object.keys(result).length ? result : null;
}

const keyOf = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

/**
 * Every answer under a normalised key, first one wins: Google's
 * user_column_data (column_id), Facebook's field_data (name), then plain keys,
 * including one level of nesting such as { data: { email } }.
 */
function flatten(body: Record<string, unknown>): Flat {
  const flat: Flat = new Map();
  const put = (key: string, value: unknown) => {
    const name = keyOf(key);
    const clean = text(value);
    if (name && clean && !flat.has(name)) flat.set(name, clean.slice(0, 1000));
  };
  if (Array.isArray(body.user_column_data)) {
    for (const column of body.user_column_data as Record<string, unknown>[]) {
      put(text(column?.column_id) || text(column?.column_name), column?.string_value);
    }
  }
  if (Array.isArray(body.field_data)) {
    for (const field of body.field_data as Record<string, unknown>[]) put(text(field?.name), field?.values);
  }
  for (const [key, value] of Object.entries(body)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) put(inner, innerValue);
    } else put(key, value);
  }
  return flat;
}

function pick(flat: Flat, keys: readonly string[], used?: Set<string>): string {
  for (const key of keys) {
    const value = flat.get(key);
    if (value) {
      used?.add(key);
      return value;
    }
  }
  return "";
}

const label = (key: string) => {
  const words = key.replace(/_/g, " ").replace(/\?$/, "").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function mapLead(flat: Flat, source: string) {
  const used = new Set<string>();
  const first = pick(flat, ALIASES.firstName, used);
  const last = pick(flat, ALIASES.lastName, used);
  const name = pick(flat, ALIASES.name, used) || [first, last].filter(Boolean).join(" ");
  const street = pick(flat, ALIASES.street, used);
  const city = pick(flat, ALIASES.city, used);
  const province = pick(flat, ALIASES.province, used);
  const postalCode = pick(flat, ALIASES.postalCode, used);
  pick(flat, ALIASES.country, used);
  // A full address already names its city; otherwise build one.
  const address = street && (street.includes(",") || (!city && !province && !postalCode))
    ? street
    : [street, city, [province, postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const notes = pick(flat, ALIASES.notes, used);
  const service = pick(flat, ALIASES.service, used);
  const externalId = source === "zapier"
    ? pick(flat, ALIASES.externalId.filter((key) => key !== "id"), used)
    : pick(flat, ALIASES.externalId, used);
  const form = pick(flat, ALIASES.form, used);
  const campaign = pick(flat, ALIASES.campaign, used);
  const leadSource = pick(flat, ALIASES.source, used);
  for (const keys of [ALIASES.email, ALIASES.phone, ALIASES.isTest, ALIASES.form, ALIASES.campaign, ALIASES.externalId]) {
    for (const key of keys) used.add(key);
  }

  const answers = [...flat.entries()]
    .filter(([key]) => !used.has(key) && !IGNORED.has(key) && !/_id$/.test(key))
    .slice(0, 25)
    .map(([key, value]) => `${label(key)}: ${value.slice(0, 500)}`);
  const formName = flat.get("form_name") ?? "";
  const heading = `Lead form (${SOURCE_LABELS[source]}${formName ? ` · ${formName}` : ""})`;
  const body = [service ? `Service: ${service}` : "", ...answers, notes ? `Notes: ${notes}` : ""].filter(Boolean);

  return {
    name: name.slice(0, 120),
    email: pick(flat, ALIASES.email).slice(0, 200),
    phone: pick(flat, ALIASES.phone).slice(0, 40),
    address: address.slice(0, 300),
    city: city.slice(0, 120),
    province: province.slice(0, 80),
    postalCode: postalCode.slice(0, 20),
    source: leadSource.slice(0, 120),
    externalId: externalId.slice(0, 200),
    form: form.slice(0, 200),
    campaign: campaign.slice(0, 200),
    note: body.length ? [heading, ...body].join("\n").slice(0, 4000) : "",
  };
}

function withoutSecrets(body: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !SECRET_KEYS.has(keyOf(key))));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
