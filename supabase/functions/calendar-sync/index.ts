import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { instant } from "../_shared/zoned.ts";

// Pushes ServiceFlow appointments and job schedules to the Google Calendars
// team members connect in Settings, and removes them when they are cancelled,
// reassigned or the person disconnects. For people who take appointments it
// also reads their busy times every 10 minutes, so booking skips them. Runs
// every minute from pg_cron with the same bearer secret as send-messages.
// Until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set, queued changes wait.

type CalendarEvent = {
  summary: string;
  location: string | null;
  description: string | null;
  projectId: string | null;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
};

type Item = {
  userId: string;
  sourceKind: "appointment" | "job";
  sourceId: string;
  refreshToken: string;
  calendarId: string;
  existingEventId: string | null;
  event: CalendarEvent | null;
};

type Outcome = { eventId: string | null; error?: string; connectionError?: boolean };

type BusyTarget = { userId: string; refreshToken: string; calendarId: string; timezone: string; until: string };

type GoogleEvent = {
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

const BATCH_SIZE = 50;
const API = "https://www.googleapis.com/calendar/v3/calendars";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("MESSAGES_CRON_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !cronSecret) {
    return json({ error: "Missing calendar-sync environment" }, 500);
  }
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token !== cronSecret) return json({ error: "Unauthorized" }, 401);

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return json({ skipped: "Google Calendar isn't set up yet." });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const appUrl = (Deno.env.get("APP_URL") ?? "https://serviceflow-admin.vercel.app").replace(/\/+$/, "");

  const { data, error } = await supabase.rpc("claim_calendar_sync", { batch_size: BATCH_SIZE });
  if (error) return json({ error: error.message }, 500);
  const items = (data ?? []) as Item[];

  // One access token per person per run.
  const accessTokens = new Map<string, Promise<string>>();
  const counts = { synced: 0, failed: 0 };
  for (const item of items) {
    let outcome: Outcome;
    try {
      if (!accessTokens.has(item.userId)) {
        accessTokens.set(item.userId, accessToken(item.refreshToken, clientId, clientSecret));
      }
      const access = await accessTokens.get(item.userId)!;
      outcome = await sync(item, access, appUrl);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      outcome = { eventId: item.existingEventId, error: message, connectionError: reason instanceof ConnectionError };
    }
    counts[outcome.error ? "failed" : "synced"] += 1;
    const { error: completeError } = await supabase.rpc("complete_calendar_sync", {
      requested_user: item.userId,
      requested_kind: item.sourceKind,
      requested_source: item.sourceId,
      requested_event_id: outcome.eventId,
      requested_calendar_id: item.calendarId,
      requested_error: outcome.error ?? null,
      requested_connection_error: outcome.connectionError ?? false,
    });
    if (completeError) {
      console.error(JSON.stringify({ message: "complete failed", source: item.sourceId, error: completeError.message }));
    }
  }

  const { data: busyData, error: busyError } = await supabase.rpc("claim_calendar_busy", { batch_size: 10 });
  if (busyError) console.error(JSON.stringify({ message: "busy claim failed", error: busyError.message }));
  const targets = (busyData ?? []) as BusyTarget[];
  for (const target of targets) {
    let saved: Record<string, unknown>;
    try {
      if (!accessTokens.has(target.userId)) {
        accessTokens.set(target.userId, accessToken(target.refreshToken, clientId, clientSecret));
      }
      saved = { requested_blocks: await readBusy(target, await accessTokens.get(target.userId)!) };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      // Anything else is tried again in 10 minutes, keeping the busy times it had.
      saved = { requested_blocks: null, requested_error: message, requested_connection_error: reason instanceof ConnectionError };
    }
    const { error: saveError } = await supabase.rpc("save_calendar_busy", { requested_user: target.userId, ...saved });
    if (saveError) console.error(JSON.stringify({ message: "busy save failed", user: target.userId, error: saveError.message }));
  }

  return json({ claimed: items.length, ...counts, busyRead: targets.length });
});

class ConnectionError extends Error {}

async function accessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    const message = "Google Calendar access was revoked. Reconnect it in Settings.";
    if (result?.error === "invalid_grant") throw new ConnectionError(message);
    throw new Error(result?.error_description ?? `Google token ${response.status}`);
  }
  return result.access_token as string;
}

async function sync(item: Item, access: string, appUrl: string): Promise<Outcome> {
  const calendar = `${API}/${encodeURIComponent(item.calendarId)}/events`;
  const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };

  if (!item.event) {
    if (item.existingEventId) {
      const response = await fetch(`${calendar}/${encodeURIComponent(item.existingEventId)}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok && response.status !== 404 && response.status !== 410) await fail(response);
    }
    return { eventId: null };
  }

  const link = item.event.projectId ? `${appUrl}/projects/${item.event.projectId}` : null;
  const body = JSON.stringify({
    summary: item.event.summary,
    location: item.event.location ?? undefined,
    description: [item.event.description, link].filter(Boolean).join("\n\n") || undefined,
    start: item.event.start,
    end: item.event.end,
    extendedProperties: { private: { serviceflowKind: item.sourceKind, serviceflowId: item.sourceId } },
  });

  if (item.existingEventId) {
    const response = await fetch(`${calendar}/${encodeURIComponent(item.existingEventId)}`, {
      method: "PUT",
      headers,
      body,
    });
    if (response.ok) return { eventId: ((await response.json()) as { id: string }).id };
    // Deleted in Google: put it back.
    if (response.status !== 404 && response.status !== 410) await fail(response);
  }
  const response = await fetch(calendar, { method: "POST", headers, body });
  if (!response.ok) await fail(response);
  return { eventId: ((await response.json()) as { id: string }).id };
}

/** Busy times from now until `until`: events shown as busy, other than ServiceFlow's own and ones declined. */
async function readBusy(target: BusyTarget, access: string): Promise<{ starts_at: string; ends_at: string }[]> {
  const blocks: { starts_at: string; ends_at: string }[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({
      timeMin: new Date().toISOString(),
      timeMax: new Date(target.until).toISOString(),
      singleEvents: "true",
      maxResults: "2500",
      fields: "nextPageToken,items(status,transparency,start,end,extendedProperties/private,attendees(self,responseStatus))",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${API}/${encodeURIComponent(target.calendarId)}/events?${params}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!response.ok) await fail(response);
    const result = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    for (const event of result.items ?? []) {
      if (event.status === "cancelled" || event.transparency === "transparent") continue;
      if (event.extendedProperties?.private?.serviceflowKind) continue;
      if (event.attendees?.some((attendee) => attendee.self && attendee.responseStatus === "declined")) continue;
      const start = moment(event.start, target.timezone);
      const end = moment(event.end, target.timezone);
      if (start !== null && end !== null && end > start) {
        blocks.push({ starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() });
      }
    }
    pageToken = result.nextPageToken ?? null;
    if (!pageToken) break;
  }
  return blocks;
}

/** A timed event's instant, or an all-day event's midnight in the company's zone. */
function moment(value: GoogleEvent["start"], timeZone: string): number | null {
  if (value?.dateTime) return Date.parse(value.dateTime);
  if (value?.date) return instant(value.date, 0, timeZone);
  return null;
}

async function fail(response: Response): Promise<never> {
  const result = await response.json().catch(() => ({}));
  const message = result?.error?.message ?? `Google Calendar ${response.status}`;
  if (response.status === 401) throw new ConnectionError(message);
  throw new Error(message);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
