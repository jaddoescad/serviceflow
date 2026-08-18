#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyEmailIntake, defaultIntakePaths, pollEmailIntake, recordIntakeFailure } from "./lib/ottawa-email-intake.mjs";

export const HELP = `Ottawa Painters automatic Gmail intake

Usage:
  ottawa-email-intake poll --limit 25 --dry-run --json
  ottawa-email-intake poll --limit 25 --yes --json
  ottawa-email-intake classify --message-id ID --label-id ID --yes --json

The tool processes incoming inbox mail only, adds exactly one approved working
label, stores no message bodies, and cannot send, archive, delete, mark read, or
remove labels.`;

export function parseArgs(argv) {
  const options = { command: null, limit: 25, messageId: null, labelId: null, dryRun: false, yes: false, json: false, help: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") options.help = true;
    else if (token === "--dry-run") options.dryRun = true;
    else if (token === "--yes" || token === "-y") options.yes = true;
    else if (token === "--json") options.json = true;
    else if (["--limit", "--message-id", "--label-id"].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
      if (token === "--limit") options.limit = Number(value);
      else if (token === "--message-id") options.messageId = value;
      else options.labelId = value;
    } else if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
    else positionals.push(token);
  }
  options.command = positionals.shift() ?? null;
  if (positionals.length) throw new Error(`Unexpected argument: ${positionals[0]}`);
  if (!options.help && !["poll", "classify"].includes(options.command)) throw new Error("Command must be poll or classify");
  if (options.dryRun && options.yes) throw new Error("Use either --dry-run or --yes, not both");
  if (options.command === "poll" && options.dryRun === options.yes) throw new Error("poll requires exactly one of --dry-run or --yes");
  if (options.command === "classify" && (!options.messageId || !options.labelId || !options.yes || options.dryRun)) {
    throw new Error("classify requires --message-id, --label-id, and --yes");
  }
  return options;
}

function write(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value)}\n`);
}

export async function run(argv, env = process.env, fetchImpl = fetch) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${HELP}\n`);
      return 0;
    }
    const result = options.command === "poll"
      ? await pollEmailIntake({ limit: options.limit, dryRun: options.dryRun, confirmed: options.yes }, env, fetchImpl)
      : await classifyEmailIntake({ messageId: options.messageId, labelId: options.labelId, confirmed: true }, env, fetchImpl);
    write(result);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const paths = defaultIntakePaths(env);
      await recordIntakeFailure(paths.healthFile, error);
    } catch {}
    write({ schema_version: 1, status: "error", wakeAgent: false, error: message }, process.stderr);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
