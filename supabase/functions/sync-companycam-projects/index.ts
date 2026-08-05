const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(JSON.stringify({
    synced: 0,
    disabled: true,
    message: "CompanyCam job creation is disabled. DripJobs is authoritative.",
  }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
