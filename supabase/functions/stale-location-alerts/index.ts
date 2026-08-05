import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const TRAVEL_STALE_AFTER_MS = 15 * 60 * 1000;
const STATIONARY_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const PAINTING_STALE_AFTER_MS = 8 * 60 * 60 * 1000;
const REPEAT_AFTER_MS = 60 * 60 * 1000;
const BATCH_SIZE = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("LOCATION_TRACKING_ALERT_CRON_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !cronSecret) {
    return json({ error: "Missing stale-location alert environment" }, 500);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token !== cronSecret) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const now = new Date();
    const [entries, statuses, existingAlerts, managerTokens] = await Promise.all([
      fetchActiveEntries(supabase),
      fetchStatuses(supabase),
      fetchUnresolvedAlerts(supabase),
      fetchManagerTokens(supabase),
    ]);

    const statusByUser = new Map(statuses.map((status) => [status.employee_id, status]));
    const alertByEntry = new Map(existingAlerts.map((alert) => [alert.time_entry_id, alert]));
    const staleEntries = entries.filter((entry) => {
      const status = statusByUser.get(entry.employee_id);
      // No status means this employee is not in the current rollout (or has
      // never successfully initialized tracking), so do not create noisy
      // alerts for non-pilot workers.
      if (!status) return false;
      const staleAfterMs = staleThresholdMs(status?.tracking_mode);
      const cutoff = now.getTime() - staleAfterMs;
      if (new Date(entry.started_at).getTime() > cutoff) return false;
      const lastLocationAt = new Date(status?.last_location_at || 0).getTime();
      return !lastLocationAt || lastLocationAt < cutoff;
    });
    const staleIds = new Set(staleEntries.map((entry) => entry.id));

    const alertsToResolve = existingAlerts.filter((alert) => !staleIds.has(alert.time_entry_id));
    if (alertsToResolve.length) {
      await supabase
        .from("location_alerts")
        .update({ resolved_at: now.toISOString() })
        .in("id", alertsToResolve.map((alert) => alert.id));
    }

    const notifyEntries = staleEntries.filter((entry) => {
      const alert = alertByEntry.get(entry.id);
      if (!alert?.last_notified_at) return true;
      return now.getTime() - new Date(alert.last_notified_at).getTime() >= REPEAT_AFTER_MS;
    });

    let sent = 0;
    if (notifyEntries.length && managerTokens.length) {
      const messages = notifyEntries.flatMap((entry) =>
        managerTokens.map((tokenRow) => ({
          to: tokenRow.expo_push_token,
          sound: "default",
          title: `${entry.employee_name || "Painter"} tracking was interrupted`,
          body: `No work-location update for ${staleWindowLabel(statusByUser.get(entry.employee_id)?.tracking_mode)} while clocked in to ${entry.job_name || "a job"}. Ask them to reopen ServiceFlow.`,
          data: { type: "tracking_interrupted", userId: entry.employee_id, timeEntryId: entry.id },
        })),
      );
      for (const batch of chunk(messages, BATCH_SIZE)) {
        sent += await sendPushBatch(batch);
      }
    }

    if (notifyEntries.length) {
      const alertRows = notifyEntries.map((entry) => {
        const status = statusByUser.get(entry.employee_id);
        return {
          employee_id: entry.employee_id,
          time_entry_id: entry.id,
          stale_since: new Date(now.getTime() - staleThresholdMs(status?.tracking_mode)).toISOString(),
          last_notified_at: managerTokens.length ? now.toISOString() : null,
          resolved_at: null,
        };
      });
      const { error } = await supabase
        .from("location_alerts")
        .upsert(alertRows, { onConflict: "time_entry_id" });
      if (error) throw new Error(error.message);
    }

    return json({
      activeEntries: entries.length,
      staleEntries: staleEntries.length,
      managerTokens: managerTokens.length,
      notificationsSent: sent,
      resolved: alertsToResolve.length,
    });
  } catch (error) {
    return json({ error: error?.message || "Stale-location alert check failed" }, 500);
  }
});

async function fetchActiveEntries(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from("time_entries")
    .select("id,employee_id,employee_name,job_name,started_at")
    .eq("status", "active")
    .is("ended_at", null);
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchStatuses(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from("employee_tracking_status")
    .select("employee_id,last_location_at,tracking_mode,task_status,platform");
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchUnresolvedAlerts(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from("location_alerts")
    .select("id,employee_id,time_entry_id,last_notified_at")
    .is("resolved_at", null);
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchManagerTokens(supabase: ServiceClient) {
  const { data: managers, error: managerError } = await supabase
    .from("employees")
    .select("id")
    .in("role", ["admin", "manager"])
    .eq("is_active", true);
  if (managerError) throw new Error(managerError.message);
  const managerIds = (managers || []).map((manager) => manager.id);
  if (!managerIds.length) return [];

  const { data, error } = await supabase
    .from("push_tokens")
    .select("employee_id,expo_push_token")
    .in("employee_id", managerIds)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  return (data || []).filter((row) => {
    if (!row.expo_push_token || seen.has(row.expo_push_token)) return false;
    seen.add(row.expo_push_token);
    return true;
  });
}

async function sendPushBatch(messages: Record<string, unknown>[]) {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Expo push returned ${response.status}`);
  return Array.isArray(payload?.data)
    ? payload.data.filter((ticket: Record<string, unknown>) => ticket?.status === "ok").length
    : 0;
}

function chunk<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

function staleThresholdMs(mode: unknown) {
  if (mode === "painting") return PAINTING_STALE_AFTER_MS;
  if (mode === "stationary") return STATIONARY_STALE_AFTER_MS;
  return TRAVEL_STALE_AFTER_MS;
}

function staleWindowLabel(mode: unknown) {
  if (mode === "painting") return "eight hours in painting mode";
  if (mode === "stationary") return "two hours in stationary mode";
  return "at least 15 minutes";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
