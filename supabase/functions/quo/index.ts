import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  conversationPartner,
  importableCall,
  importableMessage,
  type ImportedCall,
  type QuoCall,
  type QuoConversation,
  type QuoMessage,
} from "./quo.ts";

// Connects a company's Quo line and imports its texts and calls. Managers call
// it from Settings with their own session: "lines" lists the numbers an API key
// can use, "connect" saves the key and line and adds ServiceFlow's message and
// call webhooks for that line to Quo, "sync" fetches what changed,
// "disconnect" removes the webhooks, and "call-audio" gets a fresh link to a
// call's recording or voicemail. Imports run in the background; pg_cron calls
// it with the messages cron secret while one is still running.

// Supabase's runtime keeps a request's background work alive after it answers.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const QUO = "https://api.quo.com/v1";
// Each run stops itself well inside the function's time limit; the next
// minute's call carries on from the saved cursor.
const RUN_MS = 90_000;
const MESSAGE_EVENTS = ["message.received", "message.delivered"];
const CALL_EVENTS = ["call.completed", "call.recording.completed"];

type Job = {
  orgId: string;
  apiKey: string;
  phoneNumberId: string;
  number: string;
  cursor: { pageToken: string | null; skip: number; retries?: number } | null;
  since: string | null;
};

// After this many hiccups in a row on the same conversation the import stops.
const MAX_RETRIES = 5;

class QuoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** A dropped connection or a busy Quo: the import tries again next minute. */
class RetryLater extends Error {}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const cronSecret = Deno.env.get("MESSAGES_CRON_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Missing quo environment" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (cronSecret && token === cronSecret) {
    EdgeRuntime.waitUntil(runImport(admin, null));
    return json({ ok: true });
  }

  // Anyone else must be a manager; they act on their own company.
  const user = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: orgId, error: orgError } = await user.rpc("quo_manager_org");
  if (orgError || typeof orgId !== "string") return json({ error: orgError?.message ?? "Not allowed" }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    switch (body?.action) {
      case "lines": {
        const apiKey = text(body.apiKey) ?? (await connection(admin, orgId)).apiKey;
        if (!apiKey) return json({ error: "Paste your Quo API key." }, 400);
        return json({ lines: await listLines(apiKey) });
      }
      case "connect": {
        const apiKey = text(body.apiKey) ?? (await connection(admin, orgId)).apiKey;
        const line = (apiKey ? await listLines(apiKey) : []).find((item) => item.id === body.phoneNumberId);
        if (!apiKey || !line) return json({ error: "Pick one of your Quo numbers." }, 400);

        const current = await connection(admin, orgId);
        if (current.apiKey) await removeWebhooks(current.apiKey, current.webhookIds);
        const url = `${supabaseUrl}/functions/v1/quo-webhook?token=${current.webhookToken}`;
        const hook = { url, resourceIds: [line.id], label: "ServiceFlow" };
        const messages = await quo<{ data: { id: string; key: string } }>(apiKey, "POST", "/webhooks/messages", {
          ...hook,
          events: MESSAGE_EVENTS,
        });
        const calls = await quo<{ data: { id: string; key: string } }>(apiKey, "POST", "/webhooks/calls", {
          ...hook,
          events: CALL_EVENTS,
        });
        await rpc(admin, "save_quo_connection", {
          requested_org: orgId,
          requested_connection: {
            apiKey,
            phoneNumberId: line.id,
            number: line.number,
            lineName: line.name,
            webhookId: messages.data.id,
            webhookSecret: messages.data.key,
            callWebhookId: calls.data.id,
            callWebhookSecret: calls.data.key,
          },
        });
        EdgeRuntime.waitUntil(runImport(admin, orgId));
        return json({ ok: true });
      }
      case "sync": {
        await rpc(admin, "start_quo_sync", { requested_org: orgId });
        EdgeRuntime.waitUntil(runImport(admin, orgId));
        return json({ ok: true });
      }
      case "disconnect": {
        const current = await connection(admin, orgId);
        if (current.apiKey) await removeWebhooks(current.apiKey, current.webhookIds);
        await rpc(admin, "clear_quo_connection", { requested_org: orgId });
        return json({ ok: true });
      }
      case "call-audio": {
        const apiKey = (await connection(admin, orgId)).apiKey;
        const callId = text(body.callId);
        if (!apiKey || !callId) return json({ error: "Connect Quo to play calls." }, 400);
        return json(await callAudio(admin, orgId, apiKey, callId));
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (reason) {
    const status = reason instanceof QuoError ? 400 : 500;
    return json({ error: reason instanceof Error ? reason.message : String(reason) }, status);
  }
});

// Importing -------------------------------------------------------------------------

/** Works through the line's conversations, newest first, saving the cursor
 * as it goes, until the import is done or this run's time is up. */
async function runImport(admin: SupabaseClient, orgId: string | null) {
  const { data, error } = await admin.rpc("claim_quo_sync", { requested_org: orgId });
  if (error || !data) return;
  const job = data as Job;
  const stopAt = Date.now() + RUN_MS;
  let cursor = job.cursor ?? { pageToken: null, skip: 0 };
  let done = 0;
  const save = (progress: Record<string, unknown>) => {
    const conversations = done;
    done = 0;
    return rpc(admin, "save_quo_sync_progress", {
      requested_org: job.orgId,
      requested_progress: { cursor, conversations, ...progress },
    });
  };

  try {
    while (true) {
      const params = new URLSearchParams({ maxResults: "100" });
      params.append("phoneNumbers", job.phoneNumberId);
      if (job.since) params.set("updatedAfter", job.since);
      if (cursor.pageToken) params.set("pageToken", cursor.pageToken);
      const page = await quo<{ data?: QuoConversation[]; nextPageToken?: string | null }>(
        job.apiKey,
        "GET",
        `/conversations?${params}`,
      );
      const conversations = page.data ?? [];
      for (let index = cursor.skip; index < conversations.length; index++) {
        if (Date.now() > stopAt) return await save({ status: "running", release: true });
        await importConversation(admin, job, conversations[index]);
        done += 1;
        cursor = { pageToken: cursor.pageToken, skip: index + 1 };
        if (done >= 10) await save({ status: "running" });
      }
      if (!page.nextPageToken) return await save({ status: "done" });
      cursor = { pageToken: page.nextPageToken, skip: 0 };
      if (Date.now() > stopAt) return await save({ status: "running", release: true });
    }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    const retries = (cursor.retries ?? 0) + 1;
    const retry = reason instanceof RetryLater && retries < MAX_RETRIES;
    console.error(JSON.stringify({ message: retry ? "quo import will retry" : "quo import failed", org: job.orgId, error: message }));
    if (retry) cursor = { ...cursor, retries };
    await save(retry ? { status: "running", release: true } : { status: "failed", error: message }).catch(() => undefined);
  }
}

/** One customer's texts on this line. Group texts aren't threaded per customer, so they're left in Quo. */
async function importConversation(admin: SupabaseClient, job: Job, conversation: QuoConversation) {
  if (conversation.phoneNumberId && conversation.phoneNumberId !== job.phoneNumberId) return;
  const participant = conversationPartner(conversation, job.number);
  if (!participant) return;

  const messages: QuoMessage[] = [];
  let pageToken: string | null = null;
  do {
    const params = new URLSearchParams({ phoneNumberId: job.phoneNumberId, maxResults: "100" });
    params.append("participants", participant);
    if (job.since) params.set("createdAfter", job.since);
    if (pageToken) params.set("pageToken", pageToken);
    const page: { data?: QuoMessage[]; nextPageToken?: string | null } = await quo(
      job.apiKey,
      "GET",
      `/messages?${params}`,
    );
    messages.push(...(page.data ?? []));
    pageToken = page.nextPageToken ?? null;
  } while (pageToken && messages.length < 5_000);

  const rows = messages.flatMap((message) => importableMessage(message) ?? []);
  const calls = await importableCalls(job, participant);
  if (!rows.length && !calls.length) return;
  await rpc(admin, "import_quo_conversation", {
    requested_org: job.orgId,
    requested_conversation: { participant, name: conversation.name, messages: rows, calls },
  });
}

/** The calls with this customer, with the voicemail on missed ones. Quo can
 * refuse calls to a key that isn't on the number; texts still import. */
async function importableCalls(job: Job, participant: string): Promise<ImportedCall[]> {
  const calls: QuoCall[] = [];
  try {
    let pageToken: string | null = null;
    do {
      const params = new URLSearchParams({ phoneNumberId: job.phoneNumberId, maxResults: "100" });
      params.append("participants", participant);
      if (job.since) params.set("createdAfter", job.since);
      if (pageToken) params.set("pageToken", pageToken);
      const page: { data?: QuoCall[]; nextPageToken?: string | null } = await quo(job.apiKey, "GET", `/calls?${params}`);
      calls.push(...(page.data ?? []));
      pageToken = page.nextPageToken ?? null;
    } while (pageToken && calls.length < 2_000);
  } catch (reason) {
    if (!(reason instanceof QuoError)) throw reason;
    return [];
  }
  const rows: ImportedCall[] = [];
  for (const call of calls) {
    const row = importableCall(call, job.number, participant);
    if (!row) continue;
    if (row.direction === "incoming" && !row.answered) {
      // Best effort: the call imports either way.
      const voicemail = await voicemailFor(job.apiKey, row.id).catch((reason) => {
        if (reason instanceof QuoError) return null;
        throw reason;
      });
      if (voicemail) row.voicemail = { duration: voicemail.duration, transcript: voicemail.transcript };
    }
    rows.push(row);
  }
  return rows;
}

// Playing calls ----------------------------------------------------------------------

type Voicemail = { duration: number | null; transcript: string | null; recordingUrl: string | null };

const notFound = (reason: unknown) => reason instanceof QuoError && reason.status === 404;

/** A missed call's voicemail, or null when there isn't one (yet). */
async function voicemailFor(apiKey: string, callId: string): Promise<Voicemail | null> {
  try {
    const result = await quo<{ data?: Voicemail | null }>(apiKey, "GET", `/call-voicemails/${encodeURIComponent(callId)}`);
    return result.data?.recordingUrl || result.data?.transcript ? result.data : null;
  } catch (reason) {
    if (notFound(reason)) return null;
    throw reason;
  }
}

/** Quo's links to call audio may not last, so each play asks for a fresh one.
 * A missed call plays its voicemail (and saves the transcript); others their recording. */
async function callAudio(admin: SupabaseClient, orgId: string, apiKey: string, callId: string) {
  const stored = (await rpc(admin, "quo_call", { requested_org: orgId, requested_id: callId })) as {
    direction: "inbound" | "outbound";
    call: { answered?: boolean } | null;
  } | null;
  if (!stored) return { url: null };
  if (stored.direction === "inbound" && !stored.call?.answered) {
    const voicemail = await voicemailFor(apiKey, callId);
    if (!voicemail) return { url: null };
    await rpc(admin, "quo_call", {
      requested_org: orgId,
      requested_id: callId,
      requested_voicemail: { duration: voicemail.duration, transcript: voicemail.transcript },
    });
    return { url: voicemail.recordingUrl, transcript: voicemail.transcript };
  }
  try {
    const recordings = await quo<{ data?: { url: string | null; status: string | null }[] }>(
      apiKey,
      "GET",
      `/call-recordings/${encodeURIComponent(callId)}`,
    );
    return { url: (recordings.data ?? []).find((recording) => recording.url)?.url ?? null };
  } catch (reason) {
    if (notFound(reason)) return { url: null };
    throw reason;
  }
}

// Quo --------------------------------------------------------------------------------

type Line = { id: string; name: string | null; number: string; formattedNumber: string | null };

async function listLines(apiKey: string): Promise<Line[]> {
  const result = await quo<{ data?: Line[] }>(apiKey, "GET", "/phone-numbers");
  return (result.data ?? []).map(({ id, name, number, formattedNumber }) => ({ id, name, number, formattedNumber }));
}

/** Quo may already have dropped them; that's fine. */
async function removeWebhooks(apiKey: string, webhookIds: string[]) {
  for (const id of webhookIds) {
    await quo(apiKey, "DELETE", `/webhooks/${encodeURIComponent(id)}`).catch(() => undefined);
  }
}

/** A Quo API call; rate limits and Quo outages are retried a few times. */
async function quo<T = unknown>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${QUO}${path}`, {
      method,
      headers: { Authorization: apiKey, Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    const busy = !response || response.status === 429 || response.status >= 500;
    if (busy && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if (!response) throw new RetryLater("Couldn't reach Quo.");
    const result = await response.json().catch(() => ({}));
    if (response.ok) return result as T;
    if (busy) throw new RetryLater(result?.message ?? `Quo returned ${response.status}.`);
    if (response.status === 401) throw new QuoError("Quo didn't accept this API key.", 401);
    throw new QuoError(result?.message ?? `Quo returned ${response.status}.`, response.status);
  }
}

// Supabase ----------------------------------------------------------------------------

type Connection = { apiKey: string | null; phoneNumberId: string | null; webhookIds: string[]; webhookToken: string };

async function connection(admin: SupabaseClient, orgId: string): Promise<Connection> {
  return (await rpc(admin, "quo_connection", { requested_org: orgId })) as Connection;
}

async function rpc(admin: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error, status } = await admin.rpc(fn, args);
  // Database errors carry a Postgres code; a dropped connection has none.
  if (error && (status === 0 || !error.code)) throw new RetryLater(`${fn}: ${error.message}`);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
