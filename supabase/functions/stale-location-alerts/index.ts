import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendPushBatch } from "../_shared/push.ts";

type ServiceClient = SupabaseClient;

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
    const [entries, statuses, existingAlerts, tokensByOrg] = await Promise.all([
      fetchActiveEntries(supabase),
      fetchStatuses(supabase),
      fetchUnresolvedAlerts(supabase),
      fetchManagerTokensByOrg(supabase),
    ]);

    const statusByUser = new Map(statuses.map((status) => [status.employee_id, status]));
    const alertByEntry = new Map(existingAlerts.map((alert) => [alert.time_entry_id, alert]));
    const staleEntries = entries.filter((entry) => {
      const status = statusByUser.get(entry.employee_id);
      // No status means this employee is not in the current rollout (or has
      // never successfully initialized tracking), so do not create noisy
      // alerts for non-pilot workers.
      if (!status) return false;
      // The native iOS app records location only while it is open, so a
      // quiet period is expected there and is not an interruption.
      if (status.metadata?.background_tracking === false) return false;
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
    let failed = 0;
    const failedTokens = new Set<string>();
    const notifiedEntryIds = new Set<string>();
    // Each alert goes only to the managers of the company the entry belongs to.
    const tokensFor = (entry: { org_id: string }) => tokensByOrg.get(entry.org_id) || [];
    const managerTokenCount = [...tokensByOrg.values()].reduce((total, list) => total + list.length, 0);
    if (notifyEntries.length && managerTokenCount) {
      const messages = notifyEntries.flatMap((entry) =>
        tokensFor(entry).map((tokenRow) => ({
          to: tokenRow.expo_push_token,
          sound: "default",
          title: `${entry.employee_name || "A crew member"}'s tracking was interrupted`,
          body: `No work-location update for ${staleWindowLabel(statusByUser.get(entry.employee_id)?.tracking_mode)} while clocked in to ${entry.job_name || "a job"}. Ask them to reopen ServiceFlow.`,
          data: { type: "tracking_interrupted", userId: entry.employee_id, timeEntryId: entry.id },
        })),
      );
      for (const batch of chunk(messages, BATCH_SIZE)) {
        const tickets = await sendPushBatch(batch);
        tickets.forEach((ticket, index) => {
          if (ticket.status === "ok") {
            sent += 1;
            notifiedEntryIds.add(batch[index].data.timeEntryId);
          } else {
            failed += 1;
            if (ticket.details?.error === "DeviceNotRegistered") failedTokens.add(batch[index].to);
          }
        });
      }
    }

    if (failedTokens.size) {
      const { error } = await supabase.from("push_tokens")
        .update({ is_active: false })
        .in("expo_push_token", [...failedTokens])
        .lte("last_registered_at", now.toISOString());
      if (error) throw new Error(error.message);
    }

    if (notifyEntries.length) {
      const alertRows = notifyEntries.map((entry) => {
        const status = statusByUser.get(entry.employee_id);
        return {
          employee_id: entry.employee_id,
          time_entry_id: entry.id,
          stale_since: new Date(now.getTime() - staleThresholdMs(status?.tracking_mode)).toISOString(),
          last_notified_at: notifiedEntryIds.has(entry.id) ? now.toISOString() : null,
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
      managerTokens: managerTokenCount,
      notificationsSent: sent,
      notificationsFailed: failed,
      resolved: alertsToResolve.length,
    });
  } catch (error) {
    return json({ error: (error as Error)?.message || "Stale-location alert check failed" }, 500);
  }
});

async function fetchActiveEntries(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from("time_entries")
    .select("id,employee_id,employee_name,job_name,started_at,org_id")
    .eq("status", "active")
    .is("ended_at", null);
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchStatuses(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from("employee_tracking_status")
    .select("employee_id,last_location_at,tracking_mode,task_status,platform,metadata");
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

/** Active push tokens of each company's owners, admins and managers. */
async function fetchManagerTokensByOrg(supabase: ServiceClient) {
  const { data: managers, error: managerError } = await supabase
    .from("org_members")
    .select("org_id,user_id,organization:organizations!inner(status)")
    .in("role", ["owner", "admin", "manager"])
    .eq("is_active", true)
    .eq("organization.status", "active");
  if (managerError) throw new Error(managerError.message);
  const managerIds = [...new Set((managers || []).map((manager) => manager.user_id))];
  if (!managerIds.length) return new Map<string, { expo_push_token: string }[]>();

  const { data, error } = await supabase
    .from("push_tokens")
    .select("employee_id,expo_push_token")
    .in("employee_id", managerIds)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const tokensByUser = new Map<string, string[]>();
  for (const row of data || []) {
    if (!row.expo_push_token) continue;
    tokensByUser.set(row.employee_id, [...(tokensByUser.get(row.employee_id) || []), row.expo_push_token]);
  }

  const byOrg = new Map<string, { expo_push_token: string }[]>();
  for (const manager of managers || []) {
    const list = byOrg.get(manager.org_id) || [];
    for (const token of tokensByUser.get(manager.user_id) || []) {
      if (!list.some((row) => row.expo_push_token === token)) list.push({ expo_push_token: token });
    }
    byOrg.set(manager.org_id, list);
  }
  return byOrg;
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
  if (mode === "painting") return "eight hours on site";
  if (mode === "stationary") return "two hours without moving";
  return "at least 15 minutes";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
