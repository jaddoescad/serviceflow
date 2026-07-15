import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;
type Actor = { mode: string; userId: string | null; role: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Missing Supabase service environment" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await parseBody(req);
    const actor = await authorizeRequest(req, supabase);
    const action = String(body.action || "");

    if (action === "updateEntry") return json(await updateEntry(supabase, body, actor));
    if (action === "approve") return json(await setApproval(supabase, body, actor, true));
    if (action === "unapprove") return json(await setApproval(supabase, body, actor, false));
    if (action === "deleteEntry") return json(await deleteEntry(supabase, body, actor));

    return json({ error: `Unsupported action: ${action}` }, 400);
  } catch (error) {
    const err = error as { status?: number; message?: string };
    return json({ error: err?.message || "Request failed" }, Number(err?.status || 500));
  }
});

async function updateEntry(supabase: ServiceClient, body: Record<string, unknown>, actor: Actor) {
  const id = requiredText(body.id, "id");
  const { data: existing, error: loadError } = await supabase.from("time_entries").select("*").eq("id", id).maybeSingle();
  if (loadError) throw httpError(loadError.message, 500);
  if (!existing) throw httpError("Time entry not found", 404);

  const patch: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (body.startedAt !== undefined) {
    const startedAt = toIso(body.startedAt, "startedAt");
    if (startedAt !== existing.started_at) {
      patch.started_at = startedAt;
      patch.start_edited_at = new Date().toISOString();
      if (existing.original_started_at == null) patch.original_started_at = existing.started_at;
      changes.started_at = { from: existing.started_at, to: startedAt };
    }
  }

  if (body.endedAt !== undefined) {
    const endedAt = body.endedAt === null ? null : toIso(body.endedAt, "endedAt");
    if (endedAt !== existing.ended_at) {
      patch.ended_at = endedAt;
      patch.status = endedAt ? "complete" : "active";
      changes.ended_at = { from: existing.ended_at, to: endedAt };
    }
  }

  if (body.notes !== undefined) {
    const notes = toNullableText(body.notes);
    if (notes !== existing.notes) {
      patch.notes = notes;
      changes.notes = { from: existing.notes, to: notes };
    }
  }

  if (Object.keys(patch).length === 0) return { entry: existing };

  const finalStart = (patch.started_at as string) ?? existing.started_at;
  const finalEnd = "ended_at" in patch ? (patch.ended_at as string | null) : existing.ended_at;
  if (finalEnd && new Date(finalEnd).getTime() < new Date(finalStart).getTime()) {
    throw httpError("Clock-out must be after clock-in", 400);
  }

  const history = Array.isArray(existing.adjustment_history) ? existing.adjustment_history : [];
  history.push({ at: new Date().toISOString(), by: actor.userId, by_role: actor.role, source: "admin_dashboard", changes });
  patch.adjustment_history = history;

  const { data, error } = await supabase.from("time_entries").update(patch).eq("id", id).select("*").single();
  if (error) throw httpError(error.message, 500);
  return { entry: data };
}

async function setApproval(supabase: ServiceClient, body: Record<string, unknown>, actor: Actor, approve: boolean) {
  const id = requiredText(body.id, "id");
  const patch = approve
    ? { approved_at: new Date().toISOString(), approved_by: actor.userId }
    : { approved_at: null, approved_by: null };
  const { data, error } = await supabase.from("time_entries").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw httpError(error.message, 500);
  if (!data) throw httpError("Time entry not found", 404);
  return { entry: data };
}

async function deleteEntry(supabase: ServiceClient, body: Record<string, unknown>, actor: Actor) {
  if (actor.role !== "admin") throw httpError("Only admins can delete time entries", 403);
  const id = requiredText(body.id, "id");
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) throw httpError(error.message, 500);
  return { deleted: true, id };
}

async function parseBody(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch (_error) {
    return {} as Record<string, unknown>;
  }
}

async function authorizeRequest(req: Request, supabase: ServiceClient): Promise<Actor> {
  const configuredAdminToken = Deno.env.get("ASSIGNMENT_ADMIN_TOKEN");
  const suppliedAdminToken = req.headers.get("x-admin-token");
  if (configuredAdminToken && suppliedAdminToken && timingSafeEqual(suppliedAdminToken, configuredAdminToken)) {
    return { mode: "admin-token", userId: null, role: "admin" };
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw httpError("Missing authorization", 401);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw httpError("Invalid authorization", 401);

  const { data: profile, error: profileError } = await supabase
    .from("employee_profiles")
    .select("user_id,role,is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw httpError(profileError.message, 500);
  const role = String(profile?.role || "");
  if (!profile?.is_active || !["admin", "manager"].includes(role)) {
    throw httpError("Only active admins and managers can edit time entries", 403);
  }
  return { mode: "user", userId: user.id, role };
}

function toIso(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) throw httpError(`Invalid ${label}`, 400);
  return date.toISOString();
}

function requiredText(value: unknown, label: string) {
  const text = toNullableText(value);
  if (!text) throw httpError(`Missing ${label}`, 400);
  return text;
}

function toNullableText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function timingSafeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let mismatch = 0;
  for (let i = 0; i < aBytes.length; i += 1) mismatch |= aBytes[i] ^ bBytes[i];
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
