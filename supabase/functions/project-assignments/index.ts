type AccountActor = { id: string; role: string };
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key)
    return json({ error: "Missing Supabase service environment" }, 500);
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const actor = await authorize(req, supabase);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "createEmployee")
      return json(await createEmployee(supabase, body, actor));
    if (action === "setRole") return json(await setRole(supabase, body, actor));
    if (action === "setActive")
      return json(await setActive(supabase, body, actor));
    return json({ error: `Unsupported action: ${action}` }, 400);
  } catch (error) {
    const value = error as Error & { status?: number };
    return json(
      { error: value.message || "Employee request failed" },
      value.status || 500,
    );
  }
});

async function authorize(req: Request, supabase: SupabaseClient) {
  const token = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) throw httpError("Missing manager authorization", 401);
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user)
    throw httpError("Invalid manager authorization", 401);
  const { data: employee } = await supabase
    .from("employees")
    .select("id,role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!employee?.is_active || !["admin", "manager"].includes(employee.role))
    throw httpError("Manager access required", 403);
  return employee;
}

async function createEmployee(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  actor: { role: string },
) {
  const email = required(body.email, "email").toLowerCase();
  const fullName = required(body.fullName ?? body.full_name, "fullName");
  const role = roleValue(body.role);
  if (role === "admin" && actor.role !== "admin")
    throw httpError("Only admins can create admins", 403);
  const suppliedPassword = optional(body.password);
  const password = suppliedPassword || `OP-${crypto.randomUUID()}-aA1!`;
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
  if (authError || !authData.user)
    throw httpError(authError?.message || "User creation failed", 400);
  const { data: employee, error } = await supabase
    .from("employees")
    .upsert(
      {
        id: authData.user.id,
        email,
        full_name: fullName,
        role,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("id,email,full_name,role,is_active")
    .single();
  if (error) {
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
    throw httpError(error.message, 500);
  }
  if (role === "painter") {
    const { error: payRateError } = await supabase
      .from("employee_pay_rates")
      .insert({
        employee_id: employee.id,
        hourly_rate_cents: 3000,
        effective_from: authData.user.created_at.slice(0, 10),
      });
    if (payRateError) {
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
      throw httpError(payRateError.message, 500);
    }
  }
  return {
    employee: { ...employee, user_id: employee.id },
    temporaryPassword: suppliedPassword ? null : password,
  };
}

async function setRole(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  actor: AccountActor,
) {
  const id = required(body.userId ?? body.user_id, "userId");
  const role = roleValue(body.role);
  return changeAccount(supabase, actor.id, id, { requested_role: role });
}

async function setActive(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  actor: AccountActor,
) {
  const id = required(body.userId ?? body.user_id, "userId");
  const isActive = body.isActive ?? body.is_active;
  if (typeof isActive !== "boolean")
    throw httpError("Invalid account status", 400);
  return changeAccount(supabase, actor.id, id, { requested_active: isActive });
}

async function changeAccount(
  supabase: SupabaseClient,
  actor: string,
  target: string,
  change: { requested_role?: string; requested_active?: boolean },
) {
  const { data, error } = await supabase.rpc("manage_team_account", {
    requested_actor: actor,
    requested_user: target,
    ...change,
  });
  if (error)
    throw httpError(
      error.message,
      error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400,
    );
  return { employee: data };
}

function roleValue(value: unknown) {
  const role = String(value || "painter");
  if (!["admin", "manager", "painter"].includes(role))
    throw httpError("Invalid role", 400);
  return role;
}
function required(value: unknown, name: string) {
  const text = optional(value);
  if (!text) throw httpError(`Missing ${name}`, 400);
  return text;
}
function optional(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
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
