import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { suggest } from "./suggest.ts";

// Suggested times for the appointment dialog. A manager (Bearer JWT) sends
//   {"address", "minutes", "userId"?, "appointmentId"?, "days"?: ["2026-11-03"],
//    "window"?: "any" | "morning" | "afternoon"}
// with the days and part of the day the customer asked for, the person (or
// anyone who takes appointments) and the visit being moved. Open times are
// each person's hours minus their appointments, Google busy times, the break
// between visits and the drive to and from each one. The reply groups them
// into each person's free stretches, ranked against the request (see
// openWindows). `days` draws each day with open blocks: the visits in it with
// the drive between them, and blocks one appointment long. Drive times and distances come from Google's Routes API
// (GOOGLE_MAPS_API_KEY) and are cached; without it, the company's fallback
// drive time. Deploy with --no-verify-jwt.

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Missing booking environment" }, 500);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const user = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: org, error: orgError } = await user.rpc("booking_staff_org");
  if (orgError || typeof org !== "string") return json({ error: orgError?.message ?? "Not allowed" }, 403);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Send JSON." }, 400);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    return json(await suggest(admin, org, body));
  } catch (reason) {
    console.error(JSON.stringify({ message: "suggest failed", error: String(reason) }));
    return json({ error: "Times couldn't load. Try again." }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
