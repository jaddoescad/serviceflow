"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  workflowTimeLabel,
  type WorkflowCardDetail,
  type WorkflowLeadFields,
  type WorkflowSkill,
  type WorkflowStage,
  type WorkflowSuggestion,
  type WorkflowTime,
} from "@/lib/workflow-types";
import type { DrawnDay } from "@/lib/booking-types";
import { callEdge } from "./edge";
import { staffRead, staffWrite, type ActionResult } from "./rpc";

// Appointment workflows. Nothing here acts on its own: suggestNext asks the AI
// for the next step on a card and saves it; a manager approves it with
// approveText / approveBooking, which go through the lead agent's rules in the
// database (texting hours, STOP, two unanswered texts, a time still free).

const PATHS = ["/workflows"];
const MAX_OPTIONS = 8;
const MAX_DAYS = 8;

/** Calls shorter than this have nothing worth transcribing. */
const MIN_CALL_SECONDS = 15;

/**
 * A card with everything about its contact. Answered calls whose summary and
 * transcript haven't been fetched from Quo yet are fetched first (Quo writes
 * them a minute or two after the call), so the card and the AI can read them.
 */
export async function getWorkflowCard(id: string): Promise<WorkflowCardDetail> {
  const read = () => staffRead<WorkflowCardDetail>("workflow_card", { requested_card: id });
  const card = await read();
  const callIds = card.messages
    .filter((message) => message.callId && message.call?.answered && !message.call.notes && (message.call.seconds ?? 0) >= MIN_CALL_SECONDS)
    .map((message) => message.callId!)
    .slice(-5);
  if (!callIds.length) return card;
  const fetched = await callEdge<{ saved?: number }>("quo", { action: "call-notes", callIds }).catch(() => null);
  return fetched?.saved ? read() : card;
}

type Window = {
  userId: string;
  name: string | null;
  suggested: string;
  before: { address: string; minutes: number } | null;
  after: { address: string; minutes: number } | null;
};

type Preference = { days: string[]; partOfDay: "any" | "morning" | "afternoon" };


/** YYYY-MM-DD in the company's time zone. */
const dayOf = (iso: string, zone: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: zone });

const street = (address: string) => address.split(",")[0].trim();

/** Open times, only for people whose calendar is connected (their busy times are known). */
async function openTimes(
  card: WorkflowCardDetail,
  address: string | null,
  preference: Preference | null,
): Promise<{ options: WorkflowTime[]; noTimes: string | null; days: DrawnDay[] }> {
  const connected = card.people.filter((person) => person.connected);
  if (!card.people.length) return { options: [], days: [], noTimes: "Nobody takes appointments yet." };
  if (!connected.length) return { options: [], days: [], noTimes: "No salesperson has connected their calendar." };
  if (!address) return { options: [], days: [], noTimes: "No address yet." };
  let windows: Window[];
  let days: DrawnDay[];
  try {
    const reply = await callEdge<{ windows?: Window[]; days?: DrawnDay[] }>("booking", {
      address,
      minutes: card.settings.minutes,
      days: preference?.days ?? [],
      window: preference?.partOfDay ?? "any",
    });
    windows = reply.windows ?? [];
    days = reply.days ?? [];
  } catch {
    return { options: [], days: [], noTimes: "Open times couldn't load." };
  }
  const allowed = new Set(connected.map((person) => person.id));
  const seen = new Set<string>();
  const options: WorkflowTime[] = [];
  for (const window of windows) {
    const key = `${window.userId}:${window.suggested}`;
    if (!allowed.has(window.userId) || seen.has(key)) continue;
    seen.add(key);
    const near = window.before ?? window.after;
    options.push({
      id: `t${options.length + 1}`,
      personId: window.userId,
      person: window.name ?? "",
      startsAt: window.suggested,
      label: workflowTimeLabel(window.suggested, card.timezone),
      near: near ? `${near.minutes} min from ${street(near.address)}` : null,
    });
    if (options.length >= MAX_OPTIONS) break;
  }
  // The offered times' days first, so each can be drawn.
  const offered = new Set(options.map((option) => `${option.personId}:${dayOf(option.startsAt, card.timezone)}`));
  const drawn = days
    .filter((day) => allowed.has(day.userId))
    .sort((a, b) => Number(offered.has(`${b.userId}:${b.date}`)) - Number(offered.has(`${a.userId}:${a.date}`)))
    .slice(0, MAX_DAYS);
  return { options, days: drawn, noTimes: options.length ? null : "No open times in the next three weeks." };
}

type Raw = {
  action: WorkflowSuggestion["action"];
  summary: string;
  reason: string;
  message: string;
  time_ids: string[];
  book_time_id: string | null;
  lead: WorkflowLeadFields;
  want_times: { days: string[]; part_of_day: Preference["partOfDay"] } | null;
};

const nullableString = { type: ["string", "null"] };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "summary", "reason", "message", "time_ids", "book_time_id", "lead", "want_times"],
  properties: {
    action: { type: "string", enum: ["text", "book", "wait", "needs_you", "close"] },
    summary: { type: "string" },
    reason: { type: "string" },
    message: { type: "string" },
    time_ids: { type: "array", items: { type: "string" } },
    book_time_id: nullableString,
    lead: {
      type: "object",
      additionalProperties: false,
      required: ["name", "address", "email", "request"],
      properties: { name: nullableString, address: nullableString, email: nullableString, request: nullableString },
    },
    want_times: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["days", "part_of_day"],
          properties: {
            days: { type: "array", items: { type: "string" } },
            part_of_day: { type: "string", enum: ["any", "morning", "afternoon"] },
          },
        },
      ],
    },
  },
};

function instructions(card: WorkflowCardDetail) {
  const skills = card.settings.skills
    .filter((skill) => skill.prompt.trim())
    .map((skill) => `### ${skill.title.trim() || "Skill"}\n${skill.prompt.trim()}`)
    .join("\n\n");
  return `You help a painting company's office book on-site estimates. Something came in: a lead form, a missed call, a voicemail, or a text. Suggest the ONE next step. A manager reviews it and approves it; nothing is sent without them.

Your only job is getting an estimate booked. Pick one action:
- "text": a text to send them. Reply to a missed call or voicemail, ask what they need painted, their name and the address, answer a simple question about booking, or offer times. To offer times, offer two from open_times: put their ids in time_ids, and in the message write each one as its id in double braces, like "Would {{t1}} or {{t3}} work for a free estimate?". Never write the day or time out yourself; the braces become "Tuesday, Nov 17 at 10:30 AM".
- "book": they agreed to one of open_times. Put its id in book_time_id and write nothing in message. For someone with no lead yet, fill lead.name and lead.address.
- "wait": nothing to send right now, because the next move was agreed and it isn't a text from us: they said they will email photos or details, they will call back, or on a call we said we would check and get back to them. Say what we are waiting for in reason.
- "needs_you": anything outside booking an estimate: prices or quotes, questions about a job or an appointment they already have, rescheduling or cancelling, complaints, asking for a person, anything you're unsure of, or when times are needed but there are none. Say why in reason, in a few words for the manager.
- "close": not a painting lead (a supplier, spam, a wrong number, a robocall), or they wrote STOP or said they're not interested. Say why in reason.

Rules:
- Calls we answered or made may have call_summary and call_transcript: read them. What was agreed on a call counts like a text. A call with neither means you don't know what was said: if it matters for the next step, choose "needs_you" and say so.
- Never invent times, prices or promises. Only offer times from open_times. If they asked for a day or part of the day that open_times doesn't have, still pick your best action and set want_times (days as YYYY-MM-DD in the company's time zone, part_of_day).
- Texts are short, warm and plain: no emojis, no links, under 320 characters. Don't repeat what we already said.
- lead: what they've told us so far (name, street address with city, email, what they want painted); null when unknown.
- summary: one short line for the board card, like "Missed call, no voicemail" or "Kitchen and hallway; offered Tue or Wed".
- reason: one short line on why this step.
${card.settings.prompt.trim() ? `\nThe company's instructions:\n${card.settings.prompt.trim()}\n` : ""}${skills ? `\nSkills:\n${skills}\n` : ""}`;
}

async function ask(card: WorkflowCardDetail, options: WorkflowTime[], noTimes: string | null): Promise<Raw> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("The AI isn't set up yet (OPENAI_API_KEY).");
  const context = {
    now: card.now,
    timezone: card.timezone,
    came_in_as: card.kind === "lead" ? `Lead (${card.source ?? "form"})` : card.kind.replace("_", " "),
    lead_exists: Boolean(card.leadId),
    customer: { name: card.name, phone: card.phone, email: card.email, address: card.address },
    opted_out_of_texts: card.optedOut,
    notes: card.notes,
    conversation: card.messages.map((message) => ({
      from: message.direction === "inbound" ? "them" : "us",
      type: message.channel,
      at: message.at,
      text: message.text,
      call_summary: message.call?.summary,
      call_next_steps: message.call?.nextSteps,
      call_transcript: message.call?.transcript?.slice(0, 6000),
    })),
    booked: card.appointments,
    open_times: options.map(({ id, label, person, near }) => ({ id, when: label, with: person, near })),
    no_times_because: noTimes,
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      messages: [
        { role: "system", content: instructions(card) },
        { role: "user", content: JSON.stringify(context) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "next_step", strict: true, schema: SCHEMA } },
    }),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
    | null;
  if (!response.ok) throw new Error(json?.error?.message ?? `The AI failed (${response.status}).`);
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("The AI gave no answer.");
  return JSON.parse(content) as Raw;
}

const clean = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

/** Ask the AI for the next step on a card and save it. */
export async function suggestNext(id: string): Promise<ActionResult & { suggestion?: WorkflowSuggestion }> {
  await requireStaff();
  try {
    const card = await getWorkflowCard(id);
    let times = await openTimes(card, card.address, null);
    let raw = await ask(card, times.options, times.noTimes);
    // Once more with the address they gave, or the days they asked for.
    const found = !card.address ? clean(raw.lead.address) : null;
    const wanted = raw.want_times && (raw.want_times.days.length || raw.want_times.part_of_day !== "any");
    if ((found && (raw.action === "text" || raw.action === "book")) || wanted) {
      times = await openTimes(
        card,
        card.address ?? found,
        wanted ? { days: raw.want_times!.days, partOfDay: raw.want_times!.part_of_day } : null,
      );
      if (times.options.length) raw = await ask(card, times.options, times.noTimes);
    }

    const byId = new Map(times.options.map((time) => [time.id, time]));
    const lead = { name: clean(raw.lead.name), address: clean(raw.lead.address), email: clean(raw.lead.email), request: clean(raw.lead.request) };
    // Every {{t1}} in the text is a real open time; a made-up one becomes plain words.
    const offered = new Set<string>();
    const message =
      raw.action === "text"
        ? raw.message
            .trim()
            .slice(0, 1000)
            .replace(/\{\{\s*(t\d+)\s*\}\}/g, (_, timeId: string) => {
              if (!byId.has(timeId)) return "a time that works for you";
              offered.add(timeId);
              return `{{${timeId}}}`;
            })
        : "";
    let suggestion: WorkflowSuggestion = {
      action: raw.action,
      summary: raw.summary.trim().slice(0, 160),
      reason: raw.reason.trim().slice(0, 300),
      message,
      times: [...offered].flatMap((timeId) => byId.get(timeId) ?? []),
      book: raw.book_time_id ? byId.get(raw.book_time_id) ?? null : null,
      lead,
      options: times.options,
      noTimes: times.noTimes,
      days: times.days,
    };
    if (suggestion.action === "book" && !suggestion.book) {
      suggestion = { ...suggestion, action: "needs_you", reason: "They picked a time, but it isn't open any more." };
    }
    if (suggestion.action === "text" && !suggestion.message) {
      suggestion = { ...suggestion, action: "needs_you", reason: "The AI didn't write a text." };
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_workflow_suggestion", {
      requested_card: id,
      requested_suggestion: suggestion,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/workflows");
    return { ok: true, suggestion };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : "The AI couldn't suggest anything." };
  }
}

const leadArgs = (lead: WorkflowLeadFields) => ({
  requested_name: clean(lead.name),
  requested_address: clean(lead.address),
  requested_email: clean(lead.email),
  requested_request: clean(lead.request),
});

/** Send the approved text (making them a lead first when their name and address are known). */
export async function approveText(id: string, message: string, lead: WorkflowLeadFields): Promise<ActionResult> {
  return staffWrite("workflow_send_text", { requested_card: id, requested_body: message, ...leadArgs(lead) }, PATHS);
}

/** Book the approved time. */
export async function approveBooking(
  id: string,
  time: Pick<WorkflowTime, "personId" | "startsAt">,
  lead: WorkflowLeadFields,
): Promise<ActionResult> {
  return staffWrite(
    "workflow_book",
    { requested_card: id, requested_person: time.personId, requested_starts_at: time.startsAt, ...leadArgs(lead) },
    [...PATHS, "/appointments", "/pipeline/sales"],
  );
}

export async function moveWorkflowCard(id: string, stage: WorkflowStage, reason?: string): Promise<ActionResult> {
  return staffWrite("workflow_move", { requested_card: id, requested_stage: stage, requested_reason: reason ?? null }, PATHS);
}

export async function saveWorkflowSettings(prompt: string, skills: WorkflowSkill[], minutes: number): Promise<ActionResult> {
  return staffWrite(
    "save_workflow_settings",
    { requested_prompt: prompt, requested_skills: skills, requested_minutes: minutes },
    PATHS,
  );
}
