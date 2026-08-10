import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;
type TimeEntry = {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  job_name: string | null;
  started_at: string;
  ended_at: string | null;
  status: string | null;
  original_started_at: string | null;
  adjustment_history: unknown;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hermes-time-entry-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// SHA-256 fingerprint of the dedicated 256-bit Hermes credential. The credential
// itself is stored only on the Hermes server and is not present in source control.
const hermesTokenSha256 = "c08f7622874a39026eddde86a38ab505cbbcbb16be0118dab6f61392329bb388";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    await authorize(req);
    const body = await parseBody(req);
    if (String(body.action || "") !== "setClockIn") throw httpError("Unsupported action", 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw httpError("Missing Supabase service environment", 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return json(await setClockIn(supabase, body));
  } catch (error) {
    const err = error as { status?: number; message?: string };
    return json({ error: err?.message || "Request failed" }, Number(err?.status || 500));
  }
});

async function setClockIn(supabase: ServiceClient, body: Record<string, unknown>) {
  const employeeQuery = requiredText(body.employee, "employee");
  const projectQuery = optionalText(body.project);
  const rangeStart = toIso(body.rangeStart, "rangeStart");
  const rangeEnd = toIso(body.rangeEnd, "rangeEnd");
  const requestedAt = toIso(body.startedAt, "startedAt");
  const apply = body.apply === true;

  if (new Date(rangeEnd).getTime() <= new Date(rangeStart).getTime()) {
    throw httpError("Invalid workday range", 400);
  }
  if (new Date(requestedAt).getTime() < new Date(rangeStart).getTime() ||
      new Date(requestedAt).getTime() >= new Date(rangeEnd).getTime()) {
    throw httpError("Clock-in falls outside the selected workday", 400);
  }

  const { data, error } = await supabase
    .from("time_entries")
    .select("id,employee_id,employee_name,job_name,started_at,ended_at,status,original_started_at,adjustment_history")
    .gte("started_at", rangeStart)
    .lt("started_at", rangeEnd)
    .neq("status", "deleted")
    .order("started_at", { ascending: true })
    .limit(500);
  if (error) throw httpError(error.message, 500);

  const entry = selectEntry((data || []) as TimeEntry[], employeeQuery, projectQuery);
  if (entry.ended_at && new Date(requestedAt).getTime() > new Date(entry.ended_at).getTime()) {
    throw httpError("Clock-in cannot be after the recorded clock-out", 400);
  }

  const result = {
    entryId: entry.id,
    employeeName: entry.employee_name,
    projectName: entry.job_name,
    previousStartedAt: entry.started_at,
    requestedStartedAt: requestedAt,
    status: entry.started_at === requestedAt ? "unchanged" : apply ? "updated" : "dry_run",
  };
  if (!apply || entry.started_at === requestedAt) return result;

  const changedAt = new Date().toISOString();
  const history = Array.isArray(entry.adjustment_history) ? [...entry.adjustment_history] : [];
  history.push({
    at: changedAt,
    by: null,
    by_role: "admin",
    source: "hermes_slack",
    changes: { started_at: { from: entry.started_at, to: requestedAt } },
  });

  const { data: updated, error: updateError } = await supabase
    .from("time_entries")
    .update({
      original_started_at: entry.original_started_at ?? entry.started_at,
      started_at: requestedAt,
      start_edited_at: changedAt,
      adjustment_history: history,
    })
    .eq("id", entry.id)
    .eq("started_at", entry.started_at)
    .select("id")
    .maybeSingle();
  if (updateError) throw httpError(updateError.message, 500);
  if (!updated) throw httpError("The time entry changed before the update completed. Inspect it before trying again.", 409);
  return result;
}

function selectEntry(entries: TimeEntry[], employeeQuery: string, projectQuery: string | null) {
  const employee = normalize(employeeQuery);
  const exact = entries.filter((entry) => normalize(entry.employee_name) === employee);
  const employeeMatches = exact.length > 0
    ? exact
    : entries.filter((entry) => normalize(entry.employee_name).includes(employee));
  if (employeeMatches.length === 0) throw httpError(`No clock-in found for "${employeeQuery}" on that date.`, 404);

  const employeeIds = new Set(employeeMatches.map((entry) => entry.employee_id || normalize(entry.employee_name)));
  if (employeeIds.size > 1) {
    const names = [...new Set(employeeMatches.map((entry) => entry.employee_name))].join(", ");
    throw httpError(`More than one employee matched "${employeeQuery}": ${names}. Use a more specific name.`, 409);
  }

  let matches = employeeMatches;
  if (projectQuery) {
    const project = normalize(projectQuery);
    const exactProject = matches.filter((entry) => normalize(entry.job_name) === project);
    matches = exactProject.length > 0
      ? exactProject
      : matches.filter((entry) => normalize(entry.job_name).includes(project));
    if (matches.length === 0) {
      throw httpError(`No clock-in for "${employeeQuery}" matched project "${projectQuery}" on that date.`, 404);
    }
  }
  return matches[0];
}

async function authorize(req: Request) {
  const supplied = req.headers.get("x-hermes-time-entry-token");
  const suppliedSha256 = supplied ? await sha256Hex(supplied) : "";
  if (!supplied || !timingSafeEqual(suppliedSha256, hermesTokenSha256)) {
    throw httpError("Invalid Hermes time-entry authorization", 401);
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function parseBody(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch (_error) {
    throw httpError("Invalid JSON body", 400);
  }
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ");
}

function toIso(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) throw httpError(`Invalid ${label}`, 400);
  return date.toISOString();
}

function requiredText(value: unknown, label: string) {
  const text = optionalText(value);
  if (!text) throw httpError(`Missing ${label}`, 400);
  return text;
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function timingSafeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let mismatch = 0;
  for (let index = 0; index < aBytes.length; index += 1) mismatch |= aBytes[index] ^ bBytes[index];
  return mismatch === 0;
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
