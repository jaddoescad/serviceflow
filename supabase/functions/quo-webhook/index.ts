import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseQuoCall, parseQuoEvent, verifyQuoSignature } from "./quo.ts";

// Receives a company's Quo (OpenPhone) webhooks: texts customers send
// (message.received) land in the inbox, and delivery reports
// (message.delivered) mark texts sent from ServiceFlow delivered or record
// texts staff sent from the Quo app; calls (call.completed,
// call.recording.completed) join the customer's thread. ServiceFlow adds both
// webhooks to Quo when a company connects its line (the quo function); the URL
// carries the company's token and Quo's signature is checked with either
// webhook's key.

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Missing environment" }, 500);

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{24,64}$/.test(token)) return json({ error: "Unknown webhook" }, 404);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: hook, error: hookError } = await supabase.rpc("get_quo_webhook", { requested_token: token });
  if (hookError) return json({ error: hookError.message }, 500);
  if (!hook?.orgId) return json({ error: "Unknown webhook" }, 404);

  const raw = await req.text();
  const secrets: string[] = hook.secrets ?? [];
  if (secrets.length) {
    const checks = await Promise.all(secrets.map((secret) => verifyQuoSignature(raw, req.headers, secret)));
    if (!checks.some(Boolean)) return json({ error: "Invalid signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const call = parseQuoCall(payload);
  if (call) {
    const { data, error } = await supabase.rpc("receive_quo_call", { requested_org: hook.orgId, requested_call: call });
    if (error) {
      console.error(JSON.stringify({ message: "call failed", org: hook.orgId, error: error.message }));
      return json({ error: "Could not store the call" }, 500);
    }
    return json(data ?? {});
  }
  const message = parseQuoEvent(payload);
  // Contacts and other events are acknowledged so Quo stops retrying.
  if (!message) return json({ ignored: true });

  const { data, error } = await supabase.rpc("receive_inbound_message", {
    requested_org: hook.orgId,
    requested_message: message,
  });
  if (error) {
    console.error(JSON.stringify({ message: "receive failed", org: hook.orgId, error: error.message }));
    return json({ error: "Could not store the message" }, 500);
  }
  return json(data ?? {});
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
