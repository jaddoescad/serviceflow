#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_TIME_ZONE = "America/Toronto";
const DEFAULT_ACTOR_EMAIL = "info@paintersottawa.com";
const MAX_FUTURE_MS = 5 * 60 * 1000;

export function parseCliArgs(argv) {
  const args = {
    command: null,
    employee: null,
    at: "now",
    date: null,
    project: null,
    timeZone: DEFAULT_TIME_ZONE,
    actorEmail: null,
    envFile: null,
    yes: false,
    dryRun: false,
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
  if (args.at === "now" && positionals.length > 0) args.at = positionals.shift();
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  return args;
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
  if (twentyFourHour) {
    return { hour: Number(twentyFourHour[1]), minute: Number(twentyFourHour[2]) };
  }

  throw new Error(`Invalid time "${value}". Use 6pm, 18:00, or a full ISO timestamp.`);
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

function zonedLocalToDate(dateKey, hour, minute, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid date "${dateKey}". Use YYYY-MM-DD.`);
  }
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

export function parseClockOutAt(value, { date = null, timeZone = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const text = String(value ?? "now").trim();
  if (!text || text.toLowerCase() === "now") return new Date(now);

  const offsetIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
  if (offsetIso.test(text)) {
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid timestamp: ${text}`);
    return parsed;
  }

  const localIso = text.match(/^(\d{4}-\d{2}-\d{2})T(.+)$/);
  if (localIso) {
    const { hour, minute } = parseTimeOfDay(localIso[2]);
    return zonedLocalToDate(localIso[1], hour, minute, timeZone);
  }

  const { hour, minute } = parseTimeOfDay(text);
  return zonedLocalToDate(date ?? localDateKey(now, timeZone), hour, minute, timeZone);
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ");
}

export function selectActiveShift(shifts, employeeQuery, projectQuery = null) {
  const employee = normalize(employeeQuery);
  if (!employee) throw new Error("Employee name is required.");

  const project = normalize(projectQuery);
  let matches = shifts.filter((shift) => normalize(shift.user_name).includes(employee));
  if (project) matches = matches.filter((shift) => normalize(shift.project_name).includes(project));

  const exact = matches.filter((shift) => normalize(shift.user_name) === employee);
  if (exact.length === 1) return exact[0];
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(`No active shift found for "${employeeQuery}"${projectQuery ? ` on "${projectQuery}"` : ""}.`);
  }

  const options = matches.map((shift) => `${shift.user_name} — ${shift.project_name}`).join("\n  - ");
  throw new Error(`More than one active shift matched. Add --project to choose one:\n  - ${options}`);
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
    path.resolve(scriptRoot, "../Ottawa Painters App/.env.local"),
    path.resolve(scriptRoot, ".env.local"),
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
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Put it in .env.local or pass --env-file. It is used only by this server-side CLI.",
    );
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    serviceRoleKey,
    actorEmail: args.actorEmail || values.TIME_ENTRY_ADMIN_EMAIL || DEFAULT_ACTOR_EMAIL,
  };
}

async function request(config, table, { method = "GET", params = {}, body = null, prefer = null } = {}) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
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
    throw new Error(`Supabase request failed: ${detail}`);
  }
  return payload;
}

function formatOttawaDateTime(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(startedAt, endedAt) {
  const minutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h${remainder ? ` ${remainder}m` : ""}`;
}

async function confirmClockOut(message) {
  if (!process.stdin.isTTY) throw new Error("Confirmation requires an interactive terminal. Re-run with --yes.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${message} [y/N] `);
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function runClockOut(args) {
  if (!args.employee) throw new Error("Employee name is required.");
  const config = loadConfiguration(args);
  const shifts = await request(config, "time_entries", {
    params: {
      select: "id,user_id,user_name,project_name,started_at,ended_at,status,adjustment_history",
      status: "eq.active",
      ended_at: "is.null",
      order: "started_at.desc",
    },
  });
  const shift = selectActiveShift(shifts, args.employee, args.project);
  const endedAt = parseClockOutAt(args.at, { date: args.date, timeZone: args.timeZone });
  const startedAt = new Date(shift.started_at);
  if (endedAt < startedAt) throw new Error("Clock-out must be after clock-in.");
  if (endedAt.getTime() > Date.now() + MAX_FUTURE_MS) {
    throw new Error("Clock-out cannot be more than five minutes in the future.");
  }

  const summary = `${shift.user_name} on ${shift.project_name} at ${formatOttawaDateTime(endedAt, args.timeZone)}`;
  console.log(`Active shift: ${shift.user_name} — ${shift.project_name}`);
  console.log(`Clocked in:   ${formatOttawaDateTime(shift.started_at, args.timeZone)}`);
  console.log(`Clock out:    ${formatOttawaDateTime(endedAt, args.timeZone)} (${formatDuration(shift.started_at, endedAt)})`);

  if (args.dryRun) {
    console.log("Dry run only; nothing changed.");
    return;
  }
  if (!args.yes && !(await confirmClockOut(`Clock out ${summary}?`))) {
    console.log("Cancelled; nothing changed.");
    return;
  }

  const actors = await request(config, "employee_profiles", {
    params: {
      select: "user_id,email,full_name,role,is_active",
      email: `eq.${config.actorEmail}`,
      is_active: "eq.true",
      limit: "2",
    },
  });
  if (actors.length !== 1 || !["admin", "manager"].includes(actors[0].role)) {
    throw new Error(`Could not resolve one active admin/manager for ${config.actorEmail}. Use --actor-email.`);
  }

  const endedAtIso = endedAt.toISOString();
  const history = Array.isArray(shift.adjustment_history) ? [...shift.adjustment_history] : [];
  history.push({
    at: new Date().toISOString(),
    by: actors[0].user_id,
    by_role: actors[0].role,
    source: "admin_cli",
    changes: { ended_at: { from: shift.ended_at, to: endedAtIso } },
  });

  const updated = await request(config, "time_entries", {
    method: "PATCH",
    params: { id: `eq.${shift.id}`, status: "eq.active", ended_at: "is.null" },
    body: { ended_at: endedAtIso, status: "complete", adjustment_history: history },
    prefer: "return=representation",
  });
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new Error("The shift changed before the update completed. Re-run the command to inspect its current state.");
  }

  console.log(`Done: ${updated[0].user_name} clocked out at ${formatOttawaDateTime(updated[0].ended_at, args.timeZone)}.`);
}

function printHelp() {
  console.log(`Ottawa Painters time-entry CLI

Usage:
  npm run clock-out -- "Michael Matambo" 6pm
  npm run clock-out -- --employee "Michael Matambo" --at 18:00 --yes
  npm run clock-out -- "Michael" now --dry-run

Options:
  --employee <name>       Painter name (positional name also works)
  --at <time>             now, 6pm, 18:00, local datetime, or ISO timestamp
  --date <YYYY-MM-DD>     Date for a time-only --at value (defaults to today)
  --project <name>        Disambiguate by project
  --timezone <IANA zone>  Defaults to America/Toronto
  --actor-email <email>   Admin/manager recorded in the audit trail
  --env-file <path>       File containing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  --dry-run               Show the matched shift without changing it
  -y, --yes               Skip the confirmation prompt
  -h, --help              Show this help
`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help || args.command === "help" || args.command == null) {
    printHelp();
    return;
  }
  if (args.command !== "clock-out") throw new Error(`Unknown command: ${args.command}`);
  await runClockOut(args);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
