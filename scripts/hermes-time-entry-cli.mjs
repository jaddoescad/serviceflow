#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_TIME_ZONE = "America/Toronto";
const DEFAULT_ACTOR_EMAIL = "info@paintersottawa.com";

export function parseCliArgs(argv) {
  const args = {
    command: null,
    employee: null,
    at: null,
    date: null,
    project: null,
    timeZone: DEFAULT_TIME_ZONE,
    actorEmail: null,
    envFile: null,
    yes: false,
    dryRun: false,
    json: false,
    help: false,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-h" || token === "--help") {
      args.help = true;
      continue;
    }
    if (token === "-y" || token === "--yes") {
      args.yes = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }

    const [flag, inlineValue] = token.startsWith("--") ? token.split(/=(.*)/s, 2) : [null, null];
    if (flag) {
      const value = inlineValue ?? argv[++index];
      if (value == null || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--employee") args.employee = value;
      else if (flag === "--at") args.at = value;
      else if (flag === "--date") args.date = value;
      else if (flag === "--project") args.project = value;
      else if (flag === "--timezone") args.timeZone = value;
      else if (flag === "--actor-email") args.actorEmail = value;
      else if (flag === "--env-file") args.envFile = value;
      else throw new Error(`Unknown option: ${flag}`);
      continue;
    }

    positionals.push(token);
  }

  args.command = positionals.shift() ?? null;
  if (!args.employee) args.employee = positionals.shift() ?? null;
  if (!args.at) args.at = positionals.shift() ?? null;
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  return args;
}

function partsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function localDateKey(date, timeZone) {
  const parts = partsInTimeZone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function inferTargetDate(at, explicitDate, timeZone) {
  if (explicitDate) return explicitDate;
  const text = String(at ?? "").trim();
  const embeddedDate = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!embeddedDate) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return localDateKey(parsed, timeZone);
  }
  return embeddedDate[1];
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function resolveLocalDate(value, { timeZone = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const today = localDateKey(now, timeZone);
  const text = String(value ?? "today").trim().toLowerCase();
  if (!text || text === "today") return today;
  if (text === "yesterday") return shiftDateKey(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    const roundTrip = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
    if (roundTrip === text) return text;
  }
  throw new Error(`Invalid date "${value}". Use today, yesterday, or YYYY-MM-DD.`);
}

function parseTimeOfDay(value) {
  const text = String(value).trim().toLowerCase().replace(/\s+/g, "");
  const twelveHour = text.match(/^(1[0-2]|0?[1-9])(?::([0-5]\d))?(am|pm)$/);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3] === "pm") hour += 12;
    return { hour, minute: Number(twelveHour[2] ?? 0) };
  }
  const twentyFourHour = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHour) return { hour: Number(twentyFourHour[1]), minute: Number(twentyFourHour[2]) };
  throw new Error(`Invalid time "${value}". Use 8am, 08:00, or an ISO timestamp with an offset.`);
}

function zonedLocalToDate(dateKey, hour, minute, timeZone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = partsInTimeZone(new Date(guess), timeZone);
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += targetAsUtc - representedAsUtc;
  }

  const result = new Date(guess);
  const verified = partsInTimeZone(result, timeZone);
  if (
    Number(verified.year) !== year ||
    Number(verified.month) !== month ||
    Number(verified.day) !== day ||
    Number(verified.hour) !== hour ||
    Number(verified.minute) !== minute
  ) {
    throw new Error(`The requested local time does not exist in ${timeZone}.`);
  }
  return result;
}

export function parseClockInAt(value, { date = null, timeZone = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("Clock-in time is required.");

  const offsetIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
  if (offsetIso.test(text)) {
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid timestamp: ${text}`);
    return parsed;
  }

  const localIso = text.match(/^(\d{4}-\d{2}-\d{2})T(.+)$/);
  if (localIso) {
    const { hour, minute } = parseTimeOfDay(localIso[2]);
    return zonedLocalToDate(resolveLocalDate(localIso[1], { timeZone, now }), hour, minute, timeZone);
  }

  const { hour, minute } = parseTimeOfDay(text);
  return zonedLocalToDate(resolveLocalDate(date, { timeZone, now }), hour, minute, timeZone);
}

export function localDayRange(date, { timeZone = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const dateKey = resolveLocalDate(date, { timeZone, now });
  return {
    dateKey,
    start: zonedLocalToDate(dateKey, 0, 0, timeZone),
    end: zonedLocalToDate(shiftDateKey(dateKey, 1), 0, 0, timeZone),
  };
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ");
}

function uniqueBy(items, keyFor) {
  return [...new Map(items.map((item) => [keyFor(item), item])).values()];
}

export function selectClockInEntry(entries, employeeQuery, projectQuery = null) {
  const employee = normalize(employeeQuery);
  if (!employee) throw new Error("Employee name is required.");

  const available = entries.filter((entry) => entry.status !== "deleted");
  const exact = available.filter((entry) => normalize(entry.user_name) === employee);
  const nameMatches = exact.length > 0 ? exact : available.filter((entry) => normalize(entry.user_name).includes(employee));
  if (nameMatches.length === 0) throw new Error(`No clock-in found for "${employeeQuery}" on that date.`);

  const employees = uniqueBy(nameMatches, (entry) => entry.user_id || normalize(entry.user_name));
  if (employees.length > 1) {
    const names = uniqueBy(nameMatches, (entry) => normalize(entry.user_name)).map((entry) => entry.user_name).join(", ");
    throw new Error(`More than one employee matched "${employeeQuery}": ${names}. Use a more specific name.`);
  }

  let matches = nameMatches;
  const project = normalize(projectQuery);
  if (project) {
    const exactProject = matches.filter((entry) => normalize(entry.project_name) === project);
    matches = exactProject.length > 0
      ? exactProject
      : matches.filter((entry) => normalize(entry.project_name).includes(project));
    if (matches.length === 0) {
      throw new Error(`No clock-in for "${employeeQuery}" matched project "${projectQuery}" on that date.`);
    }
  }

  matches.sort((left, right) => new Date(left.started_at).getTime() - new Date(right.started_at).getTime());
  return matches[0];
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadConfiguration(args) {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = [
    path.resolve(scriptRoot, ".env"),
    path.resolve(scriptRoot, ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
  ];
  if (args.envFile) {
    const explicit = path.resolve(process.cwd(), args.envFile);
    if (!existsSync(explicit)) throw new Error(`Environment file not found: ${explicit}`);
    candidates.push(explicit);
  }

  const fileValues = Object.assign({}, ...[...new Set(candidates)].map(parseEnvFile));
  const values = { ...fileValues, ...process.env };
  const supabaseUrl = values.SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL || values.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).");
  if (!serviceRoleKey) throw new Error("Missing server-side SUPABASE_SERVICE_ROLE_KEY.");

  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    serviceRoleKey,
    actorEmail: args.actorEmail || values.TIME_ENTRY_ADMIN_EMAIL || DEFAULT_ACTOR_EMAIL,
  };
}

async function request(config, table, { method = "GET", params = {}, body = null, prefer = null } = {}) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
    else url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.message || payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(`Time-entry request failed: ${detail}`);
  }
  return payload;
}

function formatLocal(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

async function confirm(message) {
  if (!process.stdin.isTTY) throw new Error("Confirmation requires an interactive terminal. Re-run with --yes.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(?:es)?$/i.test((await prompt.question(`${message} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
}

async function resolveActor(config, performRequest) {
  const actors = await performRequest(config, "employee_profiles", {
    params: {
      select: "user_id,email,full_name,role,is_active",
      email: `eq.${config.actorEmail}`,
      is_active: "eq.true",
      limit: "2",
    },
  });
  if (actors.length !== 1 || !["admin", "manager"].includes(actors[0].role)) {
    throw new Error(`Could not resolve one active admin/manager for ${config.actorEmail}.`);
  }
  return actors[0];
}

export async function runSetClockIn(args, dependencies = {}) {
  if (!args.employee) throw new Error("Employee name is required.");
  if (!args.at) throw new Error("Clock-in time is required.");

  const now = dependencies.now ?? new Date();
  const targetDate = inferTargetDate(args.at, args.date, args.timeZone);
  const range = localDayRange(targetDate, { timeZone: args.timeZone, now });
  const requestedAt = parseClockInAt(args.at, { date: range.dateKey, timeZone: args.timeZone, now });
  if (localDateKey(requestedAt, args.timeZone) !== range.dateKey) {
    throw new Error("The requested timestamp does not fall on the selected local date.");
  }
  const config = dependencies.config ?? loadConfiguration(args);
  const performRequest = dependencies.request ?? request;
  const entries = await performRequest(config, "time_entries", {
    params: {
      select: "id,user_id,user_name,project_name,started_at,ended_at,status,original_started_at,start_edited_at,adjustment_history",
      started_at: [`gte.${range.start.toISOString()}`, `lt.${range.end.toISOString()}`],
      status: "neq.deleted",
      order: "started_at.asc",
      limit: "500",
    },
  });
  const entry = selectClockInEntry(entries, args.employee, args.project);
  if (entry.ended_at && requestedAt.getTime() > new Date(entry.ended_at).getTime()) {
    throw new Error("Clock-in cannot be after the recorded clock-out.");
  }

  const result = {
    schema_version: 1,
    command: "set-clock-in",
    status: args.dryRun ? "dry_run" : "updated",
    timezone: args.timeZone,
    work_date_local: range.dateKey,
    entry_id: entry.id,
    employee_name: entry.user_name,
    project_name: entry.project_name,
    previous_started_at: entry.started_at,
    previous_clock_in_local: formatLocal(entry.started_at, args.timeZone),
    requested_started_at: requestedAt.toISOString(),
    requested_clock_in_local: formatLocal(requestedAt, args.timeZone),
  };

  if (new Date(entry.started_at).getTime() === requestedAt.getTime()) return { ...result, status: "unchanged" };
  if (args.dryRun) return result;
  if (!args.yes && !(await (dependencies.confirm ?? confirm)(
    `Change ${entry.user_name}'s clock-in from ${result.previous_clock_in_local} to ${result.requested_clock_in_local}?`,
  ))) {
    return { ...result, status: "cancelled" };
  }

  const actor = dependencies.actor ?? await resolveActor(config, performRequest);
  const history = Array.isArray(entry.adjustment_history) ? [...entry.adjustment_history] : [];
  history.push({
    at: now.toISOString(),
    by: actor.user_id,
    by_role: actor.role,
    source: "hermes_slack",
    changes: { started_at: { from: entry.started_at, to: requestedAt.toISOString() } },
  });
  const updated = await performRequest(config, "time_entries", {
    method: "PATCH",
    params: { id: `eq.${entry.id}`, started_at: `eq.${entry.started_at}` },
    body: {
      original_started_at: entry.original_started_at ?? entry.started_at,
      started_at: requestedAt.toISOString(),
      start_edited_at: now.toISOString(),
      adjustment_history: history,
    },
    prefer: "return=representation",
  });
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new Error("The time entry changed before the update completed. Inspect it before trying again.");
  }
  return result;
}

function printHelp() {
  process.stdout.write(`Ottawa Painters Hermes time-entry CLI

Usage:
  ottawa-time set-clock-in --employee "Scott" --at 8am --yes --json
  ottawa-time set-clock-in "Scott" 8am --date yesterday --dry-run

Options:
  --employee <name>       Exact or uniquely partial employee name
  --at <time>             8am, 08:00, local datetime, or offset ISO timestamp
  --date <date>           today (default), yesterday, or YYYY-MM-DD
  --project <name>        Limit entry selection to one project
  --timezone <IANA zone>  Defaults to America/Toronto
  --actor-email <email>   Admin/manager recorded in the audit trail
  --env-file <path>       Server-side Supabase environment file
  --dry-run               Resolve and preview without changing the entry
  --json                  Print structured output
  -y, --yes               Apply without an interactive prompt
  -h, --help              Show this help
`);
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseCliArgs(argv);
  if (args.help || args.command === "help" || args.command == null) {
    printHelp();
    return 0;
  }
  if (args.command !== "set-clock-in") throw new Error(`Unknown command: ${args.command}`);
  const result = await runSetClockIn(args, dependencies);
  if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    process.stdout.write(
      `${result.status}: ${result.employee_name} — ${result.previous_clock_in_local} -> ${result.requested_clock_in_local} (${result.project_name})\n`,
    );
  }
  return result.status === "cancelled" ? 3 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      process.argv.includes("--json")
        ? `${JSON.stringify({ schema_version: 1, status: "error", error: message })}\n`
        : `Error: ${message}\n`,
    );
    process.exitCode = 1;
  });
}
