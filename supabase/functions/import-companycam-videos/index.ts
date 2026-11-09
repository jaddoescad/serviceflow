import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

// Read-only, administrative bridge for a single verified CompanyCam project.
Deno.serve(async (request) => {
  const credential = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!credential || request.method !== "POST") return json({ error: "Administrative access required" }, 403);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, credential);
  const { error } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) return json({ error: "Administrative access required" }, 403);
  const token = Deno.env.get("COMPANYCAM_API_KEY");
  if (!token) return json({ error: "CompanyCam credential is missing" }, 503);
  try {
    const input = await request.json();
    const projectId = String(input.projectId ?? "");
    const page = Number(input.page ?? 1);
    const inventory = input.kind === "video_inventory";
    if ((!inventory && !/^\d+$/.test(projectId)) || !Number.isSafeInteger(page) || page < 1 || page > 10000) return json({ error: "Invalid project or page" }, 400);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (!inventory) {
      const projectResponse = await fetch(`https://api.companycam.com/v2/projects/${projectId}`, { headers, signal: AbortSignal.timeout(30000) });
      if (!projectResponse.ok) return json({ error: `CompanyCam project returned ${projectResponse.status}` }, 502);
      const project = await projectResponse.json();
      if (String(project.company_id) !== "1383272") return json({ error: "CompanyCam company does not match" }, 409);
    }
    const kind = input.kind === "photos" ? "photos" : "videos";
    const url = new URL(kind === "photos" ? `https://api.companycam.com/v2/projects/${projectId}/photos` : "https://api.companycam.com/v2/videos");
    if (kind === "videos" && !inventory) url.searchParams.set("project_ids[]", projectId);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) return json({ error: `CompanyCam ${kind} returned ${response.status}` }, 502);
    const media = await response.json();
    if (!Array.isArray(media) || media.some((item) => (!inventory && String(item.project_id) !== projectId) || String(item.company_id) !== "1383272")) return json({ error: "Unexpected CompanyCam media response" }, 502);
    return json({ [kind]: media });
  } catch (error) {
    console.error("CompanyCam video lookup failed", error);
    return json({ error: "CompanyCam video lookup failed" }, 500);
  }
});
