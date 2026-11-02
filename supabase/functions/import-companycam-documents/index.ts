import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Administrative, one-way import. Never expose the Company's token to clients.
const API = "https://app.companycam.com/public_api/v1";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (request) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const credential = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!serviceKey || !credential) {
    return json({ error: "Administrative access required" }, 403);
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, credential);
  // Ask Auth to validate administrative credentials, including rotated keys.
  const { error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (authError) return json({ error: "Administrative access required" }, 403);
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  const token = Deno.env.get("COMPANYCAM_API_KEY");
  if (!token) return json({ error: "CompanyCam credential is missing" }, 503);
  try {
    const input = await request.json();
    const resource = input.kind === "photos" ? "photos" : input.kind === "projects" ? "projects" : "pages";
    const id = input.pageId ?? input.projectId;
    const path = id ? `/${resource}/${encodeURIComponent(String(id))}` : `/${resource}`;
    const url = new URL(API + path);
    if (resource === "pages") url.searchParams.set("include", "raw_content,tiptap_content");
    if (input.after) url.searchParams.set("after", String(input.after));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return json({ error: `CompanyCam returned ${response.status}` }, 502);
    const payload = await response.json();
    const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
    if (rows.some((row: { company_id: string }) => String(row?.company_id) !== "1383272")) {
      return json({ error: "CompanyCam company does not match the import company" }, 409);
    }
    return json({ [resource]: payload });
  } catch (error) {
    console.error("CompanyCam document import failed", error);
    return json({ error: "CompanyCam import failed" }, 500);
  }
});
