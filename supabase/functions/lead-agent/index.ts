import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { suggest } from "../booking/suggest.ts";

// The lead agent's MCP server: an outside AI agent (Grok Bot, Claude, ...)
// turns new leads, and missed calls, voicemails and texts from unknown
// numbers, into booked estimates. It sends
//   Authorization: Bearer sfa_...
// with a key a manager made in Settings › Integrations; the key decides the
// company. Streamable HTTP, stateless: each POST is one JSON-RPC message (or a
// batch) answered with JSON. The rules (texting hours, STOP, two unanswered
// texts, free times only, hand-offs) are enforced by the agent_* database
// functions, not here. Deploy with --no-verify-jwt.

type Json = Record<string, unknown>;
type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const INSTRUCTIONS = `You book painting estimates for new leads by text, for the company this key belongs to.
Two inboxes to work: list_new_leads (website, ads and other leads) and list_new_inquiries (missed calls, voicemails and texts from numbers that aren't customers yet).
Inquiries: read it with get_inquiry. If it's someone wanting painting work, text them back (send_text with the conversation_id): sorry we missed your call / thanks for your message, then ask what they need painted, their name and the address. Use a voicemail's words. Once you have a name and an address, create_lead, then carry on with its lead_id. If it's not a painting lead (a supplier, wrong number, spam, an existing customer or job), hand_off the conversation with the reason.
Leads: get_lead for one lead (its request, the texts and calls so far, anything booked).
If nobody has texted them yet, send_text a short, friendly first message: who you are with, what they asked for, and two specific times from find_times ("Tuesday at 10:30 AM or Wednesday at 1:00 PM?"). Answer their questions briefly.
When they pick a time, book_appointment with that time's person_id and starts_at exactly as find_times gave them, then send_text a one-line confirmation.
Call hand_off (and stop) for prices or quotes, complaints, anything you are unsure about, or when they ask for a person.
Never invent times: only offer times from find_times, and get fresh ones if a booking fails. If a tool says no (texting hours, opted out, waiting for a reply), respect it.`;

const TOOLS = [
  {
    name: "list_new_leads",
    description: "New leads with nobody booked yet (newest first): name, phone, address, what they asked for, texts sent, last reply.",
    inputSchema: {
      type: "object",
      properties: { since_hours: { type: "number", description: "How far back to look, in hours. Default 168 (a week)." } },
    },
  },
  {
    name: "get_lead",
    description: "One lead: contact details, their request and notes, every text and email so far (oldest first), and appointments booked.",
    inputSchema: { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"] },
  },
  {
    name: "list_new_inquiries",
    description: "Missed calls, voicemails (with transcripts) and texts from numbers that aren't customers yet, newest first, with the last few messages.",
    inputSchema: {
      type: "object",
      properties: { since_hours: { type: "number", description: "How far back to look, in hours. Default 168 (a week)." } },
    },
  },
  {
    name: "get_inquiry",
    description: "Every call, voicemail transcript and text with an unknown number, oldest first.",
    inputSchema: { type: "object", properties: { conversation_id: { type: "string" } }, required: ["conversation_id"] },
  },
  {
    name: "create_lead",
    description: "Turn an inquiry into a customer and a lead once you know their name and address (returns the lead_id to use from then on; finds their open lead if the number already has one).",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string" },
        name: { type: "string" },
        address: { type: "string", description: "Street address and city, needed for find_times." },
        email: { type: "string" },
        request: { type: "string", description: "What they want painted, in a sentence." },
      },
      required: ["conversation_id", "name", "address"],
    },
  },
  {
    name: "send_text",
    description: "Text a lead (lead_id) or an unknown number (conversation_id) from the company's number. Refused outside 8 AM–8 PM company time, if they opted out or wrote STOP, or when two texts are already waiting for a reply.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        conversation_id: { type: "string", description: "Instead of lead_id, for an inquiry." },
        message: { type: "string", description: "The text, up to 1000 characters." },
      },
      required: ["message"],
    },
  },
  {
    name: "find_times",
    description: "Open estimate times at the lead's address, best first (least driving, soonest), each with who would go. Offer only these.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        minutes: { type: "number", description: "Length of the visit. Default 60." },
        days: { type: "array", items: { type: "string" }, description: "Days the customer asked for, YYYY-MM-DD (optional)." },
        part_of_day: { type: "string", enum: ["any", "morning", "afternoon"] },
        person_id: { type: "string", description: "Only this person's times (optional)." },
      },
      required: ["lead_id"],
    },
  },
  {
    name: "book_appointment",
    description: "Book the estimate at a time from find_times. The customer gets the company's usual confirmation and reminders.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        person_id: { type: "string" },
        starts_at: { type: "string", description: "startsAt exactly as find_times returned it (ISO 8601)." },
        minutes: { type: "number", description: "Default 60." },
      },
      required: ["lead_id", "person_id", "starts_at"],
    },
  },
  {
    name: "hand_off",
    description: "Give a lead (lead_id) or an inquiry (conversation_id) to a person and stop: prices, complaints, unclear replies, a request for a human, or an inquiry that isn't a painting lead.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        conversation_id: { type: "string", description: "Instead of lead_id, for an inquiry." },
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
];

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST JSON-RPC to this endpoint." }), {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "application/json" },
    });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Missing environment" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const header = req.headers.get("Authorization") ?? "";
  const key = (header.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key") || "").trim();
  const org = key.startsWith("sfa_") ? await orgForKey(admin, key) : null;
  if (!org) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or turned-off key. Make one in ServiceFlow › Settings › Integrations." } }, 401);
  }

  const payload = await req.json().catch(() => undefined);
  if (payload === undefined) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Send JSON." } }, 400);
  const messages: RpcMessage[] = Array.isArray(payload) ? payload : [payload];
  const replies = (await Promise.all(messages.map((message) => answer(admin, org, message)))).filter((reply) => reply !== null);
  if (!replies.length) return new Response(null, { status: 202 });
  return json(Array.isArray(payload) ? replies : replies[0]);
});

async function orgForKey(admin: SupabaseClient, key: string): Promise<string | null> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await admin.rpc("agent_key_org", { requested_hash: hash });
  if (error) {
    console.error(JSON.stringify({ message: "agent key lookup failed", error: error.message }));
    return null;
  }
  return typeof data === "string" ? data : null;
}

/** One JSON-RPC message; null for a notification (no id). */
async function answer(admin: SupabaseClient, org: string, message: RpcMessage): Promise<Json | null> {
  const id = message?.id;
  if (id === undefined || id === null) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, text: string) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
  switch (message.method) {
    case "initialize": {
      const asked = String(message.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "serviceflow-lead-agent", title: "ServiceFlow lead agent", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(message.params?.name ?? "");
      const args = (message.params?.arguments ?? {}) as Json;
      try {
        const result = await callTool(admin, org, name, args);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (reason) {
        const text = reason instanceof Error ? reason.message : String(reason);
        return ok({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(-32601, `Unknown method ${message.method ?? ""}`.trim());
  }
}

async function callTool(admin: SupabaseClient, org: string, name: string, args: Json): Promise<unknown> {
  const lead = () => {
    const value = String(args.lead_id ?? "");
    if (!UUID.test(value)) throw new Error("lead_id must be a lead's id from list_new_leads or create_lead.");
    return value;
  };
  const conversation = () => {
    const value = String(args.conversation_id ?? "");
    if (!UUID.test(value)) throw new Error("conversation_id must be an id from list_new_inquiries.");
    return value;
  };
  const since = () => {
    const hours = typeof args.since_hours === "number" && args.since_hours > 0 ? Math.min(args.since_hours, 24 * 60) : 168;
    return new Date(Date.now() - hours * 3_600_000).toISOString();
  };
  switch (name) {
    case "list_new_leads":
      return await rpc(admin, "agent_new_leads", { requested_org: org, requested_since: since() });
    case "list_new_inquiries":
      return await rpc(admin, "agent_new_inquiries", { requested_org: org, requested_since: since() });
    case "get_inquiry":
      return await rpc(admin, "agent_get_inquiry", { requested_org: org, requested_conversation: conversation() });
    case "create_lead":
      return await rpc(admin, "agent_create_lead", {
        requested_org: org,
        requested_conversation: conversation(),
        requested_name: String(args.name ?? ""),
        requested_address: String(args.address ?? ""),
        requested_email: typeof args.email === "string" ? args.email : null,
        requested_request: typeof args.request === "string" ? args.request : null,
      });
    case "get_lead":
      return await rpc(admin, "agent_get_lead", { requested_org: org, requested_lead: lead() });
    case "send_text":
      return args.lead_id === undefined && args.conversation_id !== undefined
        ? await rpc(admin, "agent_text_inquiry", {
            requested_org: org,
            requested_conversation: conversation(),
            requested_body: String(args.message ?? ""),
          })
        : await rpc(admin, "agent_send_text", {
            requested_org: org,
            requested_lead: lead(),
            requested_body: String(args.message ?? ""),
          });
    case "find_times":
      return await findTimes(admin, org, lead(), args);
    case "book_appointment": {
      const person = String(args.person_id ?? "");
      if (!UUID.test(person)) throw new Error("person_id must be a personId from find_times.");
      const starts = new Date(String(args.starts_at ?? ""));
      if (Number.isNaN(starts.getTime())) throw new Error("starts_at must be a startsAt from find_times.");
      return await rpc(admin, "agent_book_estimate", {
        requested_org: org,
        requested_lead: lead(),
        requested_person: person,
        requested_starts_at: starts.toISOString(),
        requested_minutes: typeof args.minutes === "number" ? Math.round(args.minutes) : 60,
      });
    }
    case "hand_off":
      return args.lead_id === undefined && args.conversation_id !== undefined
        ? await rpc(admin, "agent_close_inquiry", {
            requested_org: org,
            requested_conversation: conversation(),
            requested_reason: String(args.reason ?? ""),
          })
        : await rpc(admin, "agent_hand_off", {
            requested_org: org,
            requested_lead: lead(),
            requested_reason: String(args.reason ?? ""),
          });
    default:
      throw new Error(`Unknown tool ${name}.`);
  }
}

type Window = {
  date: string;
  userId: string;
  name: string | null;
  starts: string[];
  suggested: string;
  before: { minutes: number } | null;
  after: { minutes: number } | null;
};

async function findTimes(admin: SupabaseClient, org: string, leadId: string, args: Json) {
  const detail = await rpc<{ address: string | null }>(admin, "agent_get_lead", { requested_org: org, requested_lead: leadId });
  if (!detail.address) throw new Error("This lead has no address yet. Ask the customer for it, or hand off.");
  const minutes = typeof args.minutes === "number" ? Math.round(args.minutes) : 60;
  const reply = (await suggest(admin, org, {
    address: detail.address,
    minutes,
    userId: typeof args.person_id === "string" && UUID.test(args.person_id) ? args.person_id : null,
    days: Array.isArray(args.days) ? args.days.filter((day) => typeof day === "string" && DAY.test(day)) : [],
    window: args.part_of_day === "morning" || args.part_of_day === "afternoon" ? args.part_of_day : "any",
  })) as { timezone: string; windows: Window[]; reason?: string };
  if (reply.reason === "no_hours") throw new Error("Nobody takes appointments yet. Hand the lead to a person.");
  const zone = reply.timezone;
  const label = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  // Customers pick a time, not a person: each time once, with whoever ranks best for it.
  const seen = new Set<string>();
  const unique = reply.windows.filter((window) => !seen.has(window.suggested) && Boolean(seen.add(window.suggested)));
  const options = unique.slice(0, 6).map((window) => {
    const drives = [window.before?.minutes, window.after?.minutes].filter((drive): drive is number => typeof drive === "number");
    return {
      personId: window.userId,
      person: window.name,
      startsAt: window.suggested,
      when: label(window.suggested),
      driveMinutes: drives.length ? Math.max(...drives) : null,
      otherStartsSamePerson: window.starts.filter((start) => start !== window.suggested).slice(0, 4).map((start) => ({ startsAt: start, when: label(start) })),
    };
  });
  return {
    address: detail.address,
    minutes,
    timezone: zone,
    options,
    note: options.length ? "Offer two of these. Book with the option's personId and startsAt." : "Nothing open in the next two weeks. Hand the lead to a person.",
  };
}

async function rpc<T = unknown>(admin: SupabaseClient, fn: string, args: Json): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
