#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { addGmailLabel, listGmailLabels, readGmailScopeStatus } from "./lib/ottawa-gmail-labeling.mjs";

export const HELP = `Ottawa Painters add-only Gmail labeling

Usage:
  ottawa-gmail-label labels --json
  ottawa-gmail-label scope --json
  ottawa-gmail-label add --message-id <gmail-id> --label <approved-label> --dry-run --json
  ottawa-gmail-label add --message-id <gmail-id> --label <approved-label> --yes --json

Only existing user labels in HERMES_GMAIL_LABEL_ALLOWLIST can be added. This
tool cannot remove labels, use system labels, archive, delete, mark read/unread,
send mail, or create/rename/delete labels.`;

export function parseArgs(argv) {
  const result = { command: null, messageId: null, label: null, dryRun: false, yes: false, json: false, help: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") result.help = true;
    else if (token === "--dry-run") result.dryRun = true;
    else if (token === "--yes" || token === "-y") result.yes = true;
    else if (token === "--json") result.json = true;
    else if (token === "--message-id" || token === "--label") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
      if (token === "--message-id") result.messageId = value;
      else result.label = value;
    } else if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
    else positionals.push(token);
  }
  result.command = positionals.shift() ?? null;
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  if (!result.help && !["labels", "scope", "add"].includes(result.command)) throw new Error("Command must be labels, scope, or add");
  if (result.command === "add" && (!result.messageId || !result.label)) throw new Error("add requires --message-id and --label");
  if (result.dryRun && result.yes) throw new Error("Use either --dry-run or --yes, not both");
  return result;
}

function write(value, json) {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

export async function run(argv, env = process.env, fetchImpl = fetch) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      write(HELP, false);
      return 0;
    }
    if (options.command === "labels") {
      const labels = await listGmailLabels(env, fetchImpl);
      write({ schema_version: 1, status: "ok", labels: labels.filter((label) => label.type === "user") }, options.json);
      return 0;
    }
    if (options.command === "scope") {
      write({ schema_version: 1, status: "ok", scope: await readGmailScopeStatus(env) }, options.json);
      return 0;
    }
    const result = await addGmailLabel({
      messageId: options.messageId,
      labelSelector: options.label,
      dryRun: options.dryRun,
      confirmed: options.yes,
    }, env, fetchImpl);
    write({ schema_version: 1, ...result }, options.json);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options?.json || argv.includes("--json")) process.stderr.write(`${JSON.stringify({ schema_version: 1, status: "error", error: message })}\n`);
    else process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
