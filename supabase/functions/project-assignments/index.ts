import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
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

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing Supabase service environment" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = req.method === "GET" ? { action: "list" } : await parseBody(req);
    const actor = await authorizeRequest(req, supabase);
    const action = String(body.action || "list");

    if (action === "list") {
      return json(await listAssignmentContext(supabase));
    }

    if (action === "createEmployee") {
      return json(await createEmployee(supabase, body, actor));
    }

    if (action === "assign") {
      return json(await assignProject(supabase, body, actor));
    }

    if (action === "remove") {
      return json(await removeAssignment(supabase, body, actor));
    }

    if (action === "setRole") {
      return json(await setEmployeeRole(supabase, body, actor));
    }

    if (action === "setActive") {
      return json(await setEmployeeActive(supabase, body, actor));
    }

    return json({ error: `Unsupported action: ${action}` }, 400);
  } catch (error) {
    const status = Number(error?.status || 500);
    return json({ error: error?.message || "Assignment request failed" }, status);
  }
});

async function parseBody(req: Request) {
  try {
    return await req.json();
  } catch (_error) {
    return {};
  }
}

async function authorizeRequest(req: Request, supabase: ServiceClient) {
  const configuredAdminToken = Deno.env.get("ASSIGNMENT_ADMIN_TOKEN");
  const suppliedAdminToken = req.headers.get("x-admin-token");

  if (configuredAdminToken && suppliedAdminToken && timingSafeEqual(suppliedAdminToken, configuredAdminToken)) {
    return { mode: "admin-token", userId: null, role: "admin" };
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
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
    throw httpError("Only active admins and managers can manage project assignments", 403);
  }

  return { mode: "user", userId: user.id, role };
}

async function listAssignmentContext(supabase: ServiceClient) {
  const [employeesResult, projectsResult, assignmentsResult] = await Promise.all([
    supabase
      .from("employee_profiles")
      .select("user_id,email,full_name,role,is_active")
      .order("full_name", { ascending: true, nullsFirst: false }),
    supabase
      .from("companycam_projects")
      .select("companycam_id,name,formatted_address,city,state,postal_code,companycam_updated_at")
      .eq("is_deleted", false)
      .eq("is_archived", false)
      .eq("is_lead", false)
      .order("companycam_updated_at", { ascending: false, nullsFirst: false })
      .limit(500),
    supabase
      .from("project_assignments")
      .select("id,companycam_project_id,user_id,status,inserted_at,updated_at")
      .eq("status", "active")
      .order("updated_at", { ascending: false }),
  ]);

  if (employeesResult.error) throw httpError(employeesResult.error.message, 500);
  if (projectsResult.error) throw httpError(projectsResult.error.message, 500);
  if (assignmentsResult.error) throw httpError(assignmentsResult.error.message, 500);

  return {
    employees: employeesResult.data || [],
    projects: projectsResult.data || [],
    assignments: assignmentsResult.data || [],
  };
}

async function createEmployee(
  supabase: ServiceClient,
  body: Record<string, unknown>,
  actor: { role: string },
) {
  const email = requiredText(body.email, "email").toLowerCase();
  const fullName = requiredText(body.fullName ?? body.full_name, "fullName");
  const role = normalizeRole(body.role, actor.role);
  const suppliedPassword = toNullableText(body.password);
  const password = suppliedPassword || generatePassword();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError) throw httpError(authError.message, 400);
  const user = authData.user;
  if (!user) throw httpError("Supabase did not return a created user", 500);

  const { data: profile, error: profileError } = await supabase
    .from("employee_profiles")
    .upsert(
      {
        user_id: user.id,
        email,
        full_name: fullName,
        role,
        is_active: true,
      },
      { onConflict: "user_id" },
    )
    .select("user_id,email,full_name,role,is_active")
    .single();

  if (profileError) {
    // The auth user was created but the profile row failed to persist. Roll the
    // auth user back (best-effort) so we don't leave an orphaned login behind.
    await supabase.auth.admin.deleteUser(user.id).catch(() => {});
    throw httpError(profileError.message, 500);
  }

  return {
    employee: profile,
    temporaryPassword: suppliedPassword ? null : password,
  };
}

async function assignProject(
  supabase: ServiceClient,
  body: Record<string, unknown>,
  actor: { userId: string | null },
) {
  const userId = requiredText(body.userId ?? body.user_id, "userId");
  const projectId = requiredText(body.projectId ?? body.companycamProjectId ?? body.companycam_project_id, "projectId");

  await ensureAssignableEmployee(supabase, userId);
  await ensureAssignableProject(supabase, projectId);

  const { data, error } = await supabase
    .from("project_assignments")
    .upsert(
      {
        companycam_project_id: projectId,
        user_id: userId,
        assigned_by: actor.userId,
        status: "active",
      },
      { onConflict: "companycam_project_id,user_id" },
    )
    .select("id,companycam_project_id,user_id,status,inserted_at,updated_at")
    .single();

  if (error) throw httpError(error.message, 500);
  return { assignment: data };
}

async function removeAssignment(
  supabase: ServiceClient,
  body: Record<string, unknown>,
  actor: { userId: string | null },
) {
  const userId = requiredText(body.userId ?? body.user_id, "userId");
  const projectId = requiredText(body.projectId ?? body.companycamProjectId ?? body.companycam_project_id, "projectId");

  const { data, error } = await supabase
    .from("project_assignments")
    .update({
      status: "removed",
      assigned_by: actor.userId,
    })
    .eq("companycam_project_id", projectId)
    .eq("user_id", userId)
    .select("id,companycam_project_id,user_id,status,inserted_at,updated_at")
    .maybeSingle();

  if (error) throw httpError(error.message, 500);
  if (!data) throw httpError("Assignment not found", 404);
  return { assignment: data };
}

async function setEmployeeRole(
  supabase: ServiceClient,
  body: Record<string, unknown>,
  actor: { userId: string | null; role: string },
) {
  if (actor.role !== "admin") throw httpError("Only admins can change roles", 403);
  const userId = requiredText(body.userId ?? body.user_id, "userId");
  const role = toNullableText(body.role);
  if (!role || !["admin", "manager", "painter"].includes(role)) throw httpError("Invalid role", 400);
  if (actor.userId && userId === actor.userId && role !== "admin") {
    throw httpError("You can't remove your own admin role", 400);
  }

  const { data, error } = await supabase
    .from("employee_profiles")
    .update({ role })
    .eq("user_id", userId)
    .select("user_id,email,full_name,role,is_active")
    .maybeSingle();

  if (error) throw httpError(error.message, 500);
  if (!data) throw httpError("Employee not found", 404);
  return { employee: data };
}

async function setEmployeeActive(
  supabase: ServiceClient,
  body: Record<string, unknown>,
  actor: { userId: string | null; role: string },
) {
  if (actor.role !== "admin") throw httpError("Only admins can activate or deactivate employees", 403);
  const userId = requiredText(body.userId ?? body.user_id, "userId");
  const isActive = body.isActive === true || body.is_active === true;
  if (actor.userId && userId === actor.userId && !isActive) {
    throw httpError("You can't deactivate yourself", 400);
  }

  const { data, error } = await supabase
    .from("employee_profiles")
    .update({ is_active: isActive })
    .eq("user_id", userId)
    .select("user_id,email,full_name,role,is_active")
    .maybeSingle();

  if (error) throw httpError(error.message, 500);
  if (!data) throw httpError("Employee not found", 404);
  return { employee: data };
}

async function ensureAssignableEmployee(supabase: ServiceClient, userId: string) {
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("user_id,is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw httpError(error.message, 500);
  if (!data?.is_active) throw httpError("Employee is not active or does not exist", 404);
}

async function ensureAssignableProject(supabase: ServiceClient, projectId: string) {
  const { data, error } = await supabase
    .from("companycam_projects")
    .select("companycam_id,is_archived,is_deleted,is_lead")
    .eq("companycam_id", projectId)
    .maybeSingle();

  if (error) throw httpError(error.message, 500);
  if (!data) throw httpError("Project does not exist", 404);
  if (data.is_deleted) throw httpError("Deleted projects cannot be assigned", 400);
  if (data.is_archived) throw httpError("Archived projects cannot be assigned", 400);
  if (data.is_lead) throw httpError("Lead projects cannot be assigned", 400);
}

function normalizeRole(value: unknown, actorRole: string) {
  const role = toNullableText(value) || "painter";
  if (!["admin", "manager", "painter"].includes(role)) throw httpError("Invalid employee role", 400);
  if (actorRole !== "admin" && role !== "painter") {
    throw httpError("Only admins can create admin or manager users", 403);
  }
  return role;
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

function generatePassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 24);
}

function timingSafeEqual(a: string, b: string) {
  // Compare in constant time to avoid leaking the admin token via response
  // timing. Length differences short-circuit (the length itself is not secret),
  // but for equal-length inputs every byte is always compared.
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let mismatch = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    mismatch |= aBytes[index] ^ bBytes[index];
  }
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
