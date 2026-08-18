#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachmentExtractorCapabilities, DEFAULT_INBOX_QUERY, readGmailMessage, searchGmailMessages } from "./lib/ottawa-gmail-read.mjs";

export const HELP = `Ottawa Painters read-only Gmail access

Usage:
  ottawa-gmail-read inbox [--limit 10] [--include-body] --json
  ottawa-gmail-read search --query "<gmail-query>" [--limit 10] [--include-body] --json
  ottawa-gmail-read message --message-id <gmail-id> --json
  ottawa-gmail-read capabilities --json

This tool only performs Gmail GET requests. Exact-message reads temporarily
extract bounded text from PDF, JPG, and PNG attachments. It cannot send, draft,
reply, forward, label, archive, delete, or change read state.`;

function boundedLimit(value) {
  if (!/^\d+$/.test(String(value ?? ""))) throw new Error("--limit must be an integer between 1 and 25");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 25) throw new Error("--limit must be an integer between 1 and 25");
  return parsed;
}

export function parseArgs(argv) {
  const result = { command: null, query: null, messageId: null, limit: 10, includeBody: false, json: false, help: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") result.help = true;
    else if (token === "--json") result.json = true;
    else if (token === "--include-body") result.includeBody = true;
    else if (["--query", "--message-id", "--limit"].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
      if (token === "--query") result.query = value;
      else if (token === "--message-id") result.messageId = value;
      else result.limit = boundedLimit(value);
    } else if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
    else positionals.push(token);
  }
  result.command = positionals.shift() ?? null;
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  if (result.help) return result;
  if (!["inbox", "search", "message", "capabilities"].includes(result.command)) throw new Error("Command must be inbox, search, message, or capabilities");
  if (result.command === "search" && !result.query) throw new Error("search requires --query");
  if (result.command === "message" && !result.messageId) throw new Error("message requires --message-id");
  if (result.command !== "search" && result.query) throw new Error("--query is only valid with search");
  if (result.command !== "message" && result.messageId) throw new Error("--message-id is only valid with message");
  if (result.command === "message" && (result.limit !== 10 || result.includeBody)) throw new Error("message does not accept --limit or --include-body");
  if (result.command === "capabilities" && (result.limit !== 10 || result.includeBody || result.query || result.messageId)) throw new Error("capabilities accepts only --json");
  return result;
}

function write(value, json) {
  process.stdout.write(`${json ? JSON.stringify(value, null, 2) : typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

export async function run(argv, env = process.env, fetchImpl = fetch) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      write(HELP, false);
      return 0;
    }
    const data = options.command === "message"
      ? await readGmailMessage({ messageId: options.messageId, includeBody: true, includeAttachments: true }, env, fetchImpl)
      : options.command === "capabilities"
        ? await attachmentExtractorCapabilities()
        : await searchGmailMessages({
        query: options.command === "inbox" ? DEFAULT_INBOX_QUERY : options.query,
        limit: options.limit,
        includeBody: options.includeBody,
      }, env, fetchImpl);
    write({ schema_version: 1, status: "ok", ...data }, options.json);
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
