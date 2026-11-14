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
// Open times kept for the card to pick from; the AI is shown the closest few.
const MAX_OPTIONS = 24;
const AI_OPTIONS = 8;
const MAX_DAYS = 14;

/** A proposal sent or accepted this recently means they're past the estimate. */
const LIVE_PROPOSAL_DAYS = 120;

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;

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

/**
 * The times an approved text offered that are still free, so "Tuesday works"
 * books exactly what we offered. Checked against the calendars again, since a
 * day can fill up after the text went out.
 */
async function offeredStillOpen(card: WorkflowCardDetail, address: string | null): Promise<WorkflowTime[]> {
  const now = Date.now();
  const connected = new Set(card.people.filter((person) => person.connected).map((person) => person.id));
  const offered = (card.offered ?? []).filter((time) => connected.has(time.personId) && new Date(time.startsAt).getTime() > now);
  if (!offered.length || !address) return [];
  let windows: { userId: string; starts?: string[]; before: Window["before"]; after: Window["after"] }[];
  try {
    const reply = await callEdge<{ windows?: typeof windows }>("booking", {
      address,
      minutes: card.settings.minutes,
      days: [...new Set(offered.map((time) => dayOf(time.startsAt, card.timezone)))],
      window: "any",
    });
    windows = reply.windows ?? [];
  } catch {
    return [];
  }
  return offered.flatMap((time) => {
    const at = new Date(time.startsAt).getTime();
    const window = windows.find((open) => open.userId === time.personId && (open.starts ?? []).some((start) => new Date(start).getTime() === at));
    if (!window) return [];
    const near = window.before ?? window.after;
    return [
      {
        id: "",
        personId: time.personId,
        person: time.person ?? card.people.find((person) => person.id === time.personId)?.name ?? "",
        startsAt: time.startsAt,
        label: workflowTimeLabel(time.startsAt, card.timezone),
        near: near ? `${near.minutes} min from ${street(near.address)}` : null,
        offeredAt: time.sentAt,
      },
    ];
  });
}

/** Open times with the ones we already offered first, numbered t1, t2… */
async function loadTimes(card: WorkflowCardDetail, address: string | null, preference: Preference | null) {
  const [times, offered] = await Promise.all([openTimes(card, address, preference), offeredStillOpen(card, address)]);
  const same = (a: WorkflowTime, b: WorkflowTime) => a.personId === b.personId && new Date(a.startsAt).getTime() === new Date(b.startsAt).getTime();
  const merged = [...offered, ...times.options.filter((option) => !offered.some((time) => same(time, option)))]
    .slice(0, MAX_OPTIONS)
    .map((time, index) => ({ ...time, id: `t${index + 1}` }));
  return { ...times, options: merged, noTimes: merged.length ? null : times.noTimes };
}

/**
 * Hard rules the AI's suggestion can't break: no estimate times for someone
 * who already has an estimate coming, a job on the go, or a live proposal.
 * Returns why, for Needs you; null when booking an estimate is fine.
 */
function bookingBlock(card: WorkflowCardDetail): string | null {
  const now = Date.now();
  const upcoming = card.appointments.find((visit) => new Date(visit.startsAt).getTime() > now);
  if (upcoming) {
    return `They already have an estimate ${workflowTimeLabel(upcoming.startsAt, card.timezone)}${upcoming.with ? ` with ${upcoming.with}` : ""}.`;
  }
  const job = card.history?.jobs.find((item) => item.status === "active" || item.status === "scheduled");
  if (job) return `They have a job ${job.status === "scheduled" ? "scheduled" : "on the go"}${job.name ? ` (${job.name})` : ""}. Check before booking another estimate.`;
  const recent = now - LIVE_PROPOSAL_DAYS * 86_400_000;
  const proposal = card.history?.proposals.find((item) => {
    const at = item.status === "accepted" ? item.acceptedAt : item.status === "sent" ? item.sentAt : null;
    return at && new Date(at).getTime() > recent;
  });
  if (proposal) return `They have a proposal ${proposal.status}${proposal.amountCents ? ` (${money(proposal.amountCents)})` : ""}. Check before booking another estimate.`;
  return null;
}

/** A line of the manager's chat with the AI about a card. */
export type WorkflowChatLine = { from: "you" | "ai"; text: string };

type Raw = {
  answer: string;
  update_suggestion: boolean;
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
  required: ["answer", "update_suggestion", "action", "summary", "reason", "message", "time_ids", "book_time_id", "lead", "want_times"],
  properties: {
    answer: { type: "string" },
    update_suggestion: { type: "boolean" },
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

/** The AI's whole prompt, from Settings (plus the skills). Nothing of it lives in code. */
function instructions(card: WorkflowCardDetail) {
  const prompt = card.settings.prompt.trim();
  if (!prompt) throw new Error("The AI has no prompt yet. Write it in Appointment workflows › Settings.");
  const skills = card.settings.skills
    .filter((skill) => skill.prompt.trim())
    .map((skill) => `### ${skill.title.trim() || "Skill"}\n${skill.prompt.trim()}`)
    .join("\n\n");
  return skills ? `${prompt}\n\nSkills:\n${skills}` : prompt;
}

async function ask(card: WorkflowCardDetail, options: WorkflowTime[], noTimes: string | null, chat: WorkflowChatLine[] | null): Promise<Raw> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("The AI isn't set up yet (OPENAI_API_KEY).");
  const context = {
    now: card.now,
    timezone: card.timezone,
    came_in_as: card.kind === "lead" ? `Lead (${card.source ?? "form"})` : card.kind.replace("_", " "),
    trigger: describeTrigger(card),
    lead_exists: Boolean(card.leadId),
    lead_status: card.leadStatus,
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
    // Real appointments on any of their deals; the only proof an estimate is scheduled.
    appointments_booked: card.appointments.map((visit) => ({
      when: workflowTimeLabel(visit.startsAt, card.timezone),
      with: visit.with,
      upcoming: new Date(visit.startsAt).getTime() > Date.now(),
    })),
    history: describeHistory(card),
    times_we_offered: (card.offered ?? []).map((time) => ({
      when: workflowTimeLabel(time.startsAt, card.timezone),
      with: time.person,
      texted: workflowTimeLabel(time.sentAt, card.timezone),
      still_open_as: options.find((option) => option.offeredAt && option.personId === time.personId && new Date(option.startsAt).getTime() === new Date(time.startsAt).getTime())?.id ?? null,
    })),
    open_times: options.slice(0, AI_OPTIONS).map(({ id, label, person, near, offeredAt }) => ({
      id,
      when: label,
      with: person,
      near,
      ...(offeredAt ? { we_offered_it: true } : {}),
    })),
    no_times_because: noTimes,
    // Only while the manager is chatting, so a fresh run after a new message
    // isn't swayed by a draft nobody approved.
    current_suggestion: chat && card.suggestion
      ? {
          status: "Draft only: not approved, nothing was sent or booked.",
          action: card.suggestion.action,
          summary: card.suggestion.summary,
          reason: card.suggestion.reason,
          // Times written out: {{t1}} ids are new on every call.
          message: card.suggestion.message.replace(/\{\{(t\d+)\}\}/g, (whole, timeId: string) => card.suggestion!.times.find((time) => time.id === timeId)?.label ?? whole),
          times: card.suggestion.times.map(({ label, person }) => ({ when: label, with: person })),
          book: card.suggestion.book?.label ?? null,
        }
      : null,
    manager_chat: chat?.map((line) => ({ from: line.from === "you" ? "manager" : "you", text: line.text })) ?? null,
  };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-6.1-sol",
      reasoning_effort: process.env.OPENAI_REASONING_EFFORT ?? "low",
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

/**
 * What just happened on the card, so the AI follows the right playbook in
 * Settings: a new lead form, a missed call, a voicemail, a call we answered,
 * a text or an email. Plain facts; the playbooks decide what to do with them.
 */
function describeTrigger(card: WorkflowCardDetail) {
  const created = new Date(card.createdAt).getTime();
  const inbound = card.messages.filter((message) => message.direction === "inbound");
  const last = inbound.at(-1);
  const isLeadForm = card.kind === "lead" && !inbound.some((message) => new Date(message.at).getTime() >= created);
  const typeOf = (message: (typeof inbound)[number]) =>
    message.channel === "call"
      ? message.text?.startsWith("Voicemail:")
        ? "voicemail"
        : message.call?.answered
          ? "answered_call"
          : "missed_call"
      : message.channel === "email"
        ? "email"
        : "text";
  const type = isLeadForm || !last ? (card.kind === "lead" ? "lead_form" : card.kind) : typeOf(last);
  const at = isLeadForm || !last ? card.createdAt : last.at;
  // Missed calls back to back, with nothing from us in between.
  let missedInARow = 0;
  for (const message of [...card.messages].reverse()) {
    if (message.direction === "outbound") break;
    if (message.channel === "call" && typeOf(message) === "missed_call") missedInARow += 1;
    else break;
  }
  const before = card.messages.filter((message) => new Date(message.at).getTime() < new Date(at).getTime());
  const history = card.history;
  return {
    type,
    at: workflowTimeLabel(at, card.timezone),
    missed_calls_in_a_row: missedInARow,
    // Nothing from them or us before this, and no other deals, proposals or jobs.
    first_contact:
      !before.length &&
      !(history?.deals.some((deal) => !deal.thisCard) || history?.proposals.length || history?.jobs.length || history?.pastVisits.length),
    we_texted_since: card.messages.some((message) => message.direction === "outbound" && new Date(message.at).getTime() > new Date(at).getTime()),
  };
}

/** Their deals, proposals, jobs and past visits, in words the AI reads easily. */
function describeHistory(card: WorkflowCardDetail) {
  const history = card.history;
  if (!history) return null;
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: card.timezone, year: "numeric", month: "short", day: "numeric" }) : null);
  return {
    deals: history.deals.map((deal) => ({ status: deal.status, started: day(deal.createdAt), address: deal.address, this_card: deal.thisCard })),
    proposals: history.proposals.map((proposal) => ({
      name: proposal.name,
      status: proposal.status,
      amount: proposal.amountCents ? money(proposal.amountCents) : null,
      sent: day(proposal.sentAt),
      accepted: day(proposal.acceptedAt),
      declined: day(proposal.declinedAt),
    })),
    jobs: history.jobs.map((job) => ({
      name: job.name,
      status: job.status,
      amount: job.amountCents ? money(job.amountCents) : null,
      scheduled: job.scheduledOn,
      completed: job.completedOn,
      address: job.address,
    })),
    past_visits: history.pastVisits.map((visit) => ({ when: day(visit.startsAt), status: visit.status })),
  };
}

const clean = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

/**
 * The AI's next step for a card, not yet saved. With `chat`, it is answering
 * the manager, and only changes the suggestion when they asked it to.
 */
async function decide(id: string, chat: WorkflowChatLine[] | null) {
    const card = await getWorkflowCard(id);
    let times = await loadTimes(card, card.address, null);
    let raw = await ask(card, times.options, times.noTimes, chat);
    // Once more with the address they gave, or the days they asked for.
    const found = !card.address ? clean(raw.lead.address) : null;
    const wanted = raw.want_times && (raw.want_times.days.length || raw.want_times.part_of_day !== "any");
    if ((found && (raw.action === "text" || raw.action === "book")) || wanted) {
      times = await loadTimes(
        card,
        card.address ?? found,
        wanted ? { days: raw.want_times!.days, partOfDay: raw.want_times!.part_of_day } : null,
      );
      if (times.options.length) raw = await ask(card, times.options, times.noTimes, chat);
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
    // The hard rules. A manager telling it what to do in the chat overrides them.
    const block = chat ? null : bookingBlock(card);
    if (block && (suggestion.action === "book" || (suggestion.action === "text" && suggestion.times.length))) {
      suggestion = { ...suggestion, action: "needs_you", summary: "Wanted to book an estimate; check first", reason: block };
    }
    return { answer: raw.answer.trim().slice(0, 2000), update: chat ? raw.update_suggestion : true, suggestion };
}

async function saveSuggestion(id: string, suggestion: WorkflowSuggestion): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_workflow_suggestion", { requested_card: id, requested_suggestion: suggestion });
  revalidatePath("/workflows");
  return error?.message ?? null;
}

/** Ask the AI for the next step on a card and save it. */
export async function suggestNext(id: string): Promise<ActionResult & { suggestion?: WorkflowSuggestion }> {
  await requireStaff();
  try {
    const { suggestion } = await decide(id, null);
    const error = await saveSuggestion(id, suggestion);
    return error ? { ok: false, error } : { ok: true, suggestion };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : "The AI couldn't suggest anything." };
  }
}

/**
 * The manager's chat with the AI about a card. It answers questions from what
 * is on the card, and an instruction replaces the saved suggestion (returned,
 * to approve as usual). Nothing here reaches the customer.
 */
export async function chatWorkflowAI(
  id: string,
  lines: WorkflowChatLine[],
): Promise<ActionResult & { answer?: string; suggestion?: WorkflowSuggestion }> {
  await requireStaff();
  const chat = lines
    .filter((line) => (line.from === "you" || line.from === "ai") && typeof line.text === "string" && line.text.trim())
    .slice(-12)
    .map((line) => ({ from: line.from, text: line.text.trim().slice(0, 1000) }));
  if (!chat.length || chat[chat.length - 1].from !== "you") return { ok: false, error: "Ask the AI something." };
  try {
    const { answer, update, suggestion } = await decide(id, chat);
    if (!update) return { ok: true, answer };
    const error = await saveSuggestion(id, suggestion);
    return error ? { ok: false, error } : { ok: true, answer, suggestion };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : "The AI couldn't answer." };
  }
}

/**
 * One day's openings for a card, for picking a time by hand: each connected
 * salesperson's visits, drives and open blocks on `date` (YYYY-MM-DD, up to
 * four weeks out). Empty when nobody has room that day.
 */
export async function getWorkflowDay(id: string, date: string, address: string | null): Promise<ActionResult & { days?: DrawnDay[] }> {
  await requireStaff();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a day." };
  try {
    const card = await staffRead<WorkflowCardDetail>("workflow_card", { requested_card: id });
    const where = card.address ?? clean(address);
    if (!where) return { ok: false, error: "Add their address first: the drive depends on it." };
    const allowed = new Set(card.people.filter((person) => person.connected).map((person) => person.id));
    const reply = await callEdge<{ days?: DrawnDay[] }>("booking", { address: where, minutes: card.settings.minutes, days: [date], window: "any" });
    return { ok: true, days: (reply.days ?? []).filter((day) => day.date === date && allowed.has(day.userId)) };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : "That day couldn't load." };
  }
}

const leadArgs = (lead: WorkflowLeadFields) => ({
  requested_name: clean(lead.name),
  requested_address: clean(lead.address),
  requested_email: clean(lead.email),
  requested_request: clean(lead.request),
});

/**
 * Send the approved text (making them a lead first when their name and
 * address are known), and remember the times it offered so their reply can
 * be booked as exactly that time.
 */
export async function approveText(
  id: string,
  message: string,
  lead: WorkflowLeadFields,
  offered: Pick<WorkflowTime, "personId" | "person" | "startsAt">[] = [],
): Promise<ActionResult> {
  const sent = await staffWrite("workflow_send_text", { requested_card: id, requested_body: message, ...leadArgs(lead) }, PATHS);
  if (!sent.ok) return sent;
  const times = offered.slice(0, 6).map(({ personId, person, startsAt }) => ({ personId, person, startsAt }));
  // The text went out either way; a miss here only loses the shortcut.
  if (times.length) await staffWrite("workflow_save_offered", { requested_card: id, requested_offered: times }, PATHS).catch(() => null);
  return sent;
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

/** Debug: wipe the owner's test thread (its texts and card) so the next text starts fresh. */
export async function resetWorkflowTestCard(id: string): Promise<ActionResult> {
  return staffWrite("workflow_debug_reset", { requested_card: id }, PATHS);
}

export async function saveWorkflowSettings(prompt: string, skills: WorkflowSkill[], minutes: number): Promise<ActionResult> {
  return staffWrite(
    "save_workflow_settings",
    { requested_prompt: prompt, requested_skills: skills, requested_minutes: minutes },
    PATHS,
  );
}
