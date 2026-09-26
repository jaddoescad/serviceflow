// Deletes the signed-in person's ServiceFlow account (App Store guideline 5.1.1(v)).
//
// public.prepare_account_deletion removes their memberships, devices and
// location history and anonymizes their profile; the login is then soft-deleted
// so it can never sign in again. Time entries and uploaded photos stay with the
// company for payroll and project records, attributed to "Deleted user".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return json({ error: "Server not configured" }, 500);
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Sign in again to delete your account." }, 401);
  const userId = userData.user.id;

  const { data: prepared, error: prepareError } = await supabase.rpc("prepare_account_deletion", {
    requested_user: userId,
  });
  if (prepareError) {
    console.error("prepare_account_deletion failed", { code: prepareError.code, message: prepareError.message });
    return json({ error: "Your account couldn't be deleted. Try again." }, 500);
  }
  if (!prepared?.ok) {
    return json(
      {
        error: "last_admin",
        company: prepared?.company ?? null,
        message: `You're the last admin of ${prepared?.company ?? "your company"}. Make someone else an admin before deleting your account.`,
      },
      409,
    );
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId, true);
  if (deleteError) {
    console.error("deleteUser failed", { message: deleteError.message });
    return json({ error: "Your account couldn't be deleted. Try again." }, 500);
  }

  return json({ ok: true });
});
