#!/usr/bin/env node

/**
 * Read-only Quo history export for an existing lead roster.
 *
 * Fetches every paginated SMS message and call from the allowlisted Sales and
 * Production lines, then fetches call transcripts and inbound voicemail
 * transcripts when Quo makes them available. The API key is read server-side
 * from process.env or .env and is never written to the output or logs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOWED_QUO_PHONE_NUMBERS } from "./lib/ottawa-quo-scope.mjs";

const DEFAULT_INPUT = path.resolve(
  "outputs/01a05ea0-adc7-7ca1-8629-115f4a1925e5/August_2026_DripJobs_History.json",
);
const DEFAULT_OUTPUT = path.resolve(
  "outputs/01a05ea0-adc7-7ca1-8629-115f4a1925e5/August_2026_Quo_History.json",
);
const DEFAULT_BASE_URL = "https://api.quo.com/v1";
const REQUEST_INTERVAL_MS = 150;
const MAX_ATTEMPTS = 5;
const PAGE_LIMIT = 100;

function readArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    limit: null,
    sourceRowNumber: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--input") args.input = path.resolve(value);
    else if (key === "--output") args.output = path.resolve(value);
    else if (key === "--limit") args.limit = Number(value);
    else if (key === "--source-row-number") args.sourceRowNumber = Number(value);
    else if (key === "--help" || key === "-h") {
      console.log(
        "Usage: node scripts/extract-quo-contact-history.mjs " +
          "[--input /abs/leads.json] [--output /abs/history.json] " +
          "[--limit N] [--source-row-number N]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
    index += 1;
  }
  if (args.limit != null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (
    args.sourceRowNumber != null &&
    (!Number.isInteger(args.sourceRowNumber) || args.sourceRowNumber < 1)
  ) {
    throw new Error("--source-row-number must be a positive integer");
  }
  return args;
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

async function loadLocalEnv() {
  const result = {};
  for (const filename of [".env", ".env.local"]) {
    let text;
    try {
      text = await fs.readFile(path.resolve(filename), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      result[match[1]] = parseEnvValue(match[2]);
    }
  }
  return result;
}

function clean(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toE164(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0")) {
    return `+${digits}`;
  }
  throw new Error("A lead has a missing or invalid phone number");
}

function tryE164(value) {
  try {
    return toE164(value);
  } catch {
    return "";
  }
}

function bodyRows(body) {
  if (Array.isArray(body)) return body;
  for (const key of ["data", "items", "messages", "calls", "results"]) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function nextPageToken(body) {
  return clean(
    body?.nextPageToken ??
      body?.next_page_token ??
      body?.pagination?.nextPageToken ??
      body?.pagination?.next,
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return Math.min(8_000, 500 * 2 ** attempt);
}

function createApiClient({ apiKey, baseUrl }) {
  let nextRequestAt = 0;
  let gate = Promise.resolve();

  const acquireSlot = () => {
    const current = gate.then(async () => {
      const waitFor = Math.max(0, nextRequestAt - Date.now());
      if (waitFor) await sleep(waitFor);
      nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
    });
    gate = current.catch(() => {});
    return current;
  };

  const get = async (url, { optionalStatuses = [] } = {}) => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await acquireSlot();
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: apiKey, Accept: "application/json" },
        redirect: "error",
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return { ok: true, status: response.status, body };
      if (optionalStatuses.includes(response.status)) {
        return { ok: false, status: response.status, body: null };
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt + 1 < MAX_ATTEMPTS) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
      }
      throw new Error(`Quo GET ${url.pathname} failed with HTTP ${response.status}`);
    }
    throw new Error(`Quo GET ${url.pathname} exhausted retries`);
  };

  const paginated = async (resource, phoneNumberId, participant) => {
    const rows = [];
    const seenTokens = new Set();
    let pageToken = "";
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const url = new URL(`${baseUrl}/${resource}`);
      url.searchParams.set("phoneNumberId", phoneNumberId);
      url.searchParams.append("participants", participant);
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await get(url);
      rows.push(...bodyRows(response.body));
      const next = nextPageToken(response.body);
      if (!next) return rows;
      if (seenTokens.has(next)) {
        throw new Error(`Quo ${resource} pagination repeated a token`);
      }
      seenTokens.add(next);
      pageToken = next;
    }
    throw new Error(`Quo ${resource} pagination exceeded ${PAGE_LIMIT} pages`);
  };

  const optionalCallData = async (resource, callId) => {
    const url = new URL(`${baseUrl}/${resource}/${encodeURIComponent(callId)}`);
    const response = await get(url, { optionalStatuses: [400, 403, 404] });
    return {
      available: response.ok && response.body?.data != null,
      statusCode: response.status,
      data: response.ok ? response.body?.data ?? null : null,
    };
  };

  const listContacts = async () => {
    const rows = [];
    const seenTokens = new Set();
    let pageToken = "";
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const url = new URL(`${baseUrl}/contacts`);
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await get(url);
      rows.push(...bodyRows(response.body));
      const next = nextPageToken(response.body);
      if (!next) return rows;
      if (seenTokens.has(next)) throw new Error("Quo contacts pagination repeated a token");
      seenTokens.add(next);
      pageToken = next;
    }
    throw new Error(`Quo contacts pagination exceeded ${PAGE_LIMIT} pages`);
  };

  return { paginated, optionalCallData, listContacts };
}

function deduplicate(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row?.id ?? row?.messageId ?? row?.callId ?? JSON.stringify(row));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function secondsLabel(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function transcriptDialogue(data, participant) {
  const customerDigits = participant.replace(/\D/g, "").slice(-10);
  return (Array.isArray(data?.dialogue) ? data.dialogue : [])
    .map((entry) => {
      const identifier = clean(entry.identifier);
      const identifierDigits = identifier.replace(/\D/g, "").slice(-10);
      return {
        start: Number.isFinite(Number(entry.start)) ? Number(entry.start) : null,
        end: Number.isFinite(Number(entry.end)) ? Number(entry.end) : null,
        identifier,
        userId: clean(entry.userId),
        speaker:
          identifierDigits && identifierDigits === customerDigits
            ? "Customer"
            : "Ottawa Painters",
        content: clean(entry.content),
      };
    })
    .filter((entry) => entry.content);
}

function messageRecord(message, line) {
  const media = (Array.isArray(message.media) ? message.media : [])
    .map((item) => ({ type: clean(item?.type), url: clean(item?.url) }))
    .filter((item) => item.type || item.url);
  return {
    id: clean(message.id ?? message.messageId),
    kind: "text",
    occurredAt: clean(
      message.createdAt ?? message.created_at ?? message.sentAt ?? message.timestamp,
    ),
    lineId: line.id,
    line: line.name,
    direction: clean(message.direction),
    status: clean(message.status),
    from: clean(message.from),
    to: Array.isArray(message.to) ? message.to.map(clean).filter(Boolean) : [clean(message.to)].filter(Boolean),
    text: clean(message.text ?? message.content ?? message.body ?? message.message),
    media,
  };
}

async function callRecord(call, line, participant, api) {
  const id = clean(call.id ?? call.callId);
  if (!id) throw new Error("Quo returned a call without an ID");
  const transcript = await api.optionalCallData("call-transcripts", id);
  const shouldFetchVoicemail = clean(call.direction).toLowerCase() === "incoming";
  const voicemail = shouldFetchVoicemail
    ? await api.optionalCallData("call-voicemails", id)
    : { available: false, statusCode: null, data: null };
  return {
    id,
    kind: "call",
    occurredAt: clean(call.createdAt ?? call.created_at ?? call.answeredAt),
    answeredAt: clean(call.answeredAt),
    completedAt: clean(call.completedAt),
    lineId: line.id,
    line: line.name,
    direction: clean(call.direction),
    status: clean(call.status),
    callRoute: clean(call.callRoute),
    durationSeconds: Number.isFinite(Number(call.duration)) ? Number(call.duration) : null,
    durationLabel: secondsLabel(call.duration),
    participant,
    transcriptStatus: transcript.available
      ? clean(transcript.data?.status) || "available"
      : transcript.statusCode === 404
        ? "not available"
        : transcript.statusCode === 403
          ? "not permitted by plan or line settings"
          : transcript.statusCode === 400
            ? "not available for this call"
            : "not available",
    transcript: transcript.available ? transcriptDialogue(transcript.data, participant) : [],
    voicemailStatus: voicemail.available
      ? clean(voicemail.data?.status) || "available"
      : voicemail.statusCode === 404
        ? "not available"
        : voicemail.statusCode === 403
          ? "not permitted by plan or line settings"
          : voicemail.statusCode === 400
            ? "not available for this call"
            : "not checked for outgoing call",
    voicemailTranscript: voicemail.available ? clean(voicemail.data?.transcript) : "",
  };
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

function chronological(a, b) {
  const left = Date.parse(a.occurredAt);
  const right = Date.parse(b.occurredAt);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return String(a.id).localeCompare(String(b.id));
}

function normalizeIdentity(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function contactIdentity(contact) {
  const fields = contact?.defaultFields ?? {};
  return {
    name: normalizeIdentity([fields.firstName, fields.lastName].filter(Boolean).join(" ")),
    emails: (Array.isArray(fields.emails) ? fields.emails : [])
      .map((item) => String(item?.value ?? "").trim().toLowerCase())
      .filter(Boolean),
    phones: (Array.isArray(fields.phoneNumbers) ? fields.phoneNumbers : [])
      .map((item) => tryE164(item?.value))
      .filter(Boolean),
  };
}

function resolveParticipantFromContacts(record, contacts) {
  const partialDigits = String(record.phone ?? "").replace(/\D/g, "");
  const email = String(record.email ?? "").trim().toLowerCase();
  const name = normalizeIdentity(record.name);
  const emailCandidates = [];
  const suffixCandidates = [];
  const nameCandidates = [];
  for (const contact of contacts) {
    const identity = contactIdentity(contact);
    const emailMatch = email && identity.emails.includes(email);
    const nameMatch = name && identity.name === name;
    const suffixPhones = identity.phones.filter((phone) =>
      phone.replace(/\D/g, "").endsWith(partialDigits),
    );
    if (emailMatch) emailCandidates.push(...identity.phones);
    if ((emailMatch || nameMatch) && suffixPhones.length === 1) suffixCandidates.push(suffixPhones[0]);
    if (nameMatch) nameCandidates.push(...identity.phones);
  }
  for (const candidates of [emailCandidates, suffixCandidates, nameCandidates]) {
    const unique = [...new Set(candidates)];
    if (unique.length === 1) return unique[0];
  }
  return "";
}

async function extractParticipant(participant, api) {
  const lineRows = await mapLimit(ALLOWED_QUO_PHONE_NUMBERS, 2, async (line) => {
    const [messages, calls] = await Promise.all([
      api.paginated("messages", line.id, participant),
      api.paginated("calls", line.id, participant),
    ]);
    return { line, messages, calls };
  });
  const messages = deduplicate(
    lineRows.flatMap(({ line, messages: rows }) => rows.map((row) => messageRecord(row, line))),
  );
  const rawCalls = deduplicate(
    lineRows.flatMap(({ line, calls: rows }) => rows.map((row) => ({ row, line }))),
  );
  const calls = await mapLimit(rawCalls, 5, ({ row, line }) =>
    callRecord(row, line, participant, api),
  );
  return {
    participant,
    messages: messages.sort(chronological),
    calls: calls.sort(chronological),
    timeline: [...messages, ...calls].sort(chronological),
  };
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const localEnv = await loadLocalEnv();
  const apiKey = process.env.QUO_API_KEY || localEnv.QUO_API_KEY;
  if (!apiKey) throw new Error("QUO_API_KEY is unavailable");
  const baseUrl = (process.env.QUO_API_BASE || localEnv.QUO_API_BASE || DEFAULT_BASE_URL).replace(/\/$/, "");

  const inputPayload = JSON.parse(await fs.readFile(args.input, "utf8"));
  const allRecords = Array.isArray(inputPayload)
    ? inputPayload
    : inputPayload.records ?? inputPayload.leads ?? inputPayload.results;
  if (!Array.isArray(allRecords)) throw new Error("Input JSON has no records array");
  let selected = allRecords;
  if (args.sourceRowNumber != null) {
    selected = selected.filter((record) => record.sourceRowNumber === args.sourceRowNumber);
  }
  if (args.limit != null) selected = selected.slice(0, args.limit);
  if (!selected.length) throw new Error("No lead rows were selected");

  const api = createApiClient({ apiKey, baseUrl });
  let records = selected.map((record) => ({
    sourceRowNumber: record.sourceRowNumber,
    name: record.name,
    email: record.email,
    phone: record.phone,
    participant: tryE164(record.phone),
    participantResolution: tryE164(record.phone) ? "source phone" : "unresolved",
  }));
  if (records.some((record) => !record.participant)) {
    const contacts = await api.listContacts();
    records = records.map((record) => {
      if (record.participant) return record;
      const participant = resolveParticipantFromContacts(record, contacts);
      return {
        ...record,
        participant,
        participantResolution: participant ? "Quo contact identity fallback" : "unresolved",
      };
    });
  }
  const participants = [...new Set(records.map((record) => record.participant).filter(Boolean))];
  const histories = new Map();
  for (let offset = 0; offset < participants.length; offset += 5) {
    const batch = participants.slice(offset, offset + 5);
    const results = await mapLimit(batch, 5, (participant) => extractParticipant(participant, api));
    for (const result of results) histories.set(result.participant, result);
    console.error(`Quo progress: ${Math.min(offset + batch.length, participants.length)}/${participants.length} phone numbers`);
  }

  const outputRecords = records.map((record) => {
    const history = histories.get(record.participant);
    if (!history) {
      return {
        ...record,
        error: "Quo history unavailable because the source phone number is incomplete and no unique Quo contact matched",
        messages: [],
        calls: [],
        timeline: [],
      };
    }
    return {
      ...record,
      error: "",
      messages: history.messages,
      calls: history.calls,
      timeline: history.timeline,
    };
  });
  const uniqueHistories = [...histories.values()];
  const summary = {
    records: outputRecords.length,
    uniquePhoneNumbers: participants.length,
    unresolvedRecords: outputRecords.filter((record) => !record.participant).length,
    contactsWithActivity: outputRecords.filter((record) => record.timeline.length).length,
    messages: uniqueHistories.reduce((sum, item) => sum + item.messages.length, 0),
    calls: uniqueHistories.reduce((sum, item) => sum + item.calls.length, 0),
    callsWithTranscript: uniqueHistories.reduce(
      (sum, item) => sum + item.calls.filter((call) => call.transcript.length).length,
      0,
    ),
    transcriptSegments: uniqueHistories.reduce(
      (sum, item) => sum + item.calls.reduce((count, call) => count + call.transcript.length, 0),
      0,
    ),
    callsWithVoicemailTranscript: uniqueHistories.reduce(
      (sum, item) => sum + item.calls.filter((call) => call.voicemailTranscript).length,
      0,
    ),
  };
  const output = {
    generatedAt: new Date().toISOString(),
    source: {
      system: "Quo",
      apiBase: baseUrl,
      lines: ALLOWED_QUO_PHONE_NUMBERS,
      scope: "Complete available history for each selected participant",
    },
    summary,
    records: outputRecords,
  };
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: args.output, ...summary }));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
