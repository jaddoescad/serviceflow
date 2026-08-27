#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import {
  contractorInvoiceStatus,
  contractorInvoiceVisionSelfTest,
  defaultContractorInvoicePaths,
  deferContractorInvoice,
  importContractorInvoice,
  parseContractorInvoiceItems,
  pollContractorInvoices,
  prepareContractorInvoice,
  recordContractorInvoiceFailure,
  stageContractorInvoice,
} from "./lib/ottawa-contractor-invoice.mjs";

export const HELP = `Ottawa Painters contractor-invoice intake

Usage:
  ottawa-contractor-invoice poll --limit 10 --dry-run|--yes --json
  ottawa-contractor-invoice stage --message-id ID --dry-run|--yes --json
  ottawa-contractor-invoice prepare --message-id ID --attachment-index N --json
  ottawa-contractor-invoice import --message-id ID --attachment-index N --invoice-number NUMBER --issued-on YYYY-MM-DD --subtotal-cents N --tax-cents N --total-cents N --items "MATCH::EVIDENCE::DESCRIPTION::SUBTOTAL_CENTS::START_OR_-::END_OR_-~~..." --yes --json
  ottawa-contractor-invoice defer --message-id ID --attachment-index N --reason REASON --yes --json
  ottawa-contractor-invoice vision-self-test --json
  ottawa-contractor-invoice status --json

The importer creates an unpaid labour payable, itemized lines, and exact-evidence
job assignments. Use match type name, address, proposal, company, or unassigned. It never
guesses a job and cannot mark invoices paid, create bank allocations, send
payments, or modify Gmail.`;

const SUPABASE_ENV_KEYS = new Set(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "HERMES_TIME_ENTRY_TOKEN", "HERMES_CONTRACTOR_INVOICE_TOKEN"]);

function unquoteEnvValue(value) {
  const text = String(value ?? "").trim().replace(/\r$/, "");
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

export async function contractorInvoiceEnvironment(env = process.env, envFile = null) {
  const merged = { ...env };
  const file = envFile || env.HERMES_CONTRACTOR_INVOICE_SUPABASE_ENV || "/opt/data/hermes-time-entry.env";
  if ((merged.SUPABASE_SERVICE_ROLE_KEY || merged.HERMES_CONTRACTOR_INVOICE_TOKEN || merged.HERMES_TIME_ENTRY_TOKEN)
      && (merged.SUPABASE_URL || merged.NEXT_PUBLIC_SUPABASE_URL)) return merged;
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return merged;
    throw error;
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().replace(/^export\s+/, "");
    if (!SUPABASE_ENV_KEYS.has(key) || merged[key]) continue;
    merged[key] = unquoteEnvValue(line.slice(separator + 1));
  }
  return merged;
}

function boundedInteger(value, name, minimum, maximum) {
  if (!/^\d+$/.test(String(value ?? ""))) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    command: null,
    limit: 10,
    messageId: null,
    attachmentIndex: null,
    invoiceNumber: null,
    issuedOn: null,
    subtotalCents: null,
    taxCents: null,
    totalCents: null,
    items: null,
    reason: null,
    dryRun: false,
    yes: false,
    json: false,
    help: false,
  };
  const positionals = [];
  const values = new Map([
    ["--limit", "limit"],
    ["--message-id", "messageId"],
    ["--attachment-index", "attachmentIndex"],
    ["--invoice-number", "invoiceNumber"],
    ["--issued-on", "issuedOn"],
    ["--subtotal-cents", "subtotalCents"],
    ["--tax-cents", "taxCents"],
    ["--total-cents", "totalCents"],
    ["--items", "items"],
    ["--reason", "reason"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") options.help = true;
    else if (token === "--dry-run") options.dryRun = true;
    else if (token === "--yes" || token === "-y") options.yes = true;
    else if (token === "--json") options.json = true;
    else if (values.has(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
      options[values.get(token)] = value;
    } else if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
    else positionals.push(token);
  }
  options.command = positionals.shift() ?? null;
  if (positionals.length) throw new Error(`Unexpected argument: ${positionals[0]}`);
  if (options.help) return options;
  if (!["poll", "stage", "prepare", "import", "defer", "vision-self-test", "status"].includes(options.command)) throw new Error("Command must be poll, stage, prepare, import, defer, vision-self-test, or status");

  if (options.limit !== 10) options.limit = boundedInteger(options.limit, "--limit", 1, 25);
  if (options.attachmentIndex !== null) options.attachmentIndex = boundedInteger(options.attachmentIndex, "--attachment-index", 1, 5);
  for (const key of ["subtotalCents", "taxCents", "totalCents"]) if (options[key] !== null) options[key] = boundedInteger(options[key], `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, 0, 100_000_000_000);

  if (["poll", "stage"].includes(options.command) && options.dryRun === options.yes) throw new Error(`${options.command} requires exactly one of --dry-run or --yes`);
  if (["prepare", "vision-self-test", "status"].includes(options.command) && (options.dryRun || options.yes)) throw new Error(`${options.command} is read-only and does not accept --dry-run or --yes`);
  if (["import", "defer"].includes(options.command) && (!options.yes || options.dryRun)) throw new Error(`${options.command} requires --yes`);
  if (["stage", "prepare", "import", "defer"].includes(options.command) && !options.messageId) throw new Error(`${options.command} requires --message-id`);
  if (["prepare", "import", "defer"].includes(options.command) && options.attachmentIndex === null) throw new Error(`${options.command} requires --attachment-index`);
  if (options.command === "import") {
    for (const [key, flag] of [["invoiceNumber", "--invoice-number"], ["issuedOn", "--issued-on"], ["subtotalCents", "--subtotal-cents"], ["taxCents", "--tax-cents"], ["totalCents", "--total-cents"]]) {
      if (options[key] === null) throw new Error(`import requires ${flag}`);
    }
    if (!options.items) throw new Error("import requires --items");
    parseContractorInvoiceItems(options.items);
  }
  if (options.command === "defer" && !options.reason) throw new Error("defer requires --reason");

  const allowedByCommand = {
    poll: ["limit", "dryRun", "yes", "json"],
    stage: ["messageId", "dryRun", "yes", "json"],
    prepare: ["messageId", "attachmentIndex", "json"],
    import: ["messageId", "attachmentIndex", "invoiceNumber", "issuedOn", "subtotalCents", "taxCents", "totalCents", "items", "yes", "json"],
    defer: ["messageId", "attachmentIndex", "reason", "yes", "json"],
    "vision-self-test": ["json"],
    status: ["json"],
  }[options.command];
  const defaults = { limit: 10, messageId: null, attachmentIndex: null, invoiceNumber: null, issuedOn: null, subtotalCents: null, taxCents: null, totalCents: null, items: null, reason: null, dryRun: false, yes: false, json: false };
  for (const [key, defaultValue] of Object.entries(defaults)) if (!allowedByCommand.includes(key) && options[key] !== defaultValue) throw new Error(`${options.command} does not accept ${key}`);
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
    let result;
    if (options.command === "poll") result = await pollContractorInvoices({ limit: options.limit, dryRun: options.dryRun, confirmed: options.yes }, env, fetchImpl);
    else if (options.command === "stage") result = await stageContractorInvoice({ messageId: options.messageId, dryRun: options.dryRun, confirmed: options.yes }, env, fetchImpl);
    else if (options.command === "prepare") result = await prepareContractorInvoice({ messageId: options.messageId, attachmentIndex: options.attachmentIndex }, env, fetchImpl);
    else if (options.command === "import") result = await importContractorInvoice({
      messageId: options.messageId,
      attachmentIndex: options.attachmentIndex,
      invoiceNumber: options.invoiceNumber,
      issuedOn: options.issuedOn,
      subtotalCents: options.subtotalCents,
      taxCents: options.taxCents,
      totalCents: options.totalCents,
      items: options.items,
      confirmed: true,
    }, env, fetchImpl);
    else if (options.command === "defer") result = await deferContractorInvoice({ messageId: options.messageId, attachmentIndex: options.attachmentIndex, reason: options.reason, confirmed: true }, env);
    else if (options.command === "vision-self-test") result = await contractorInvoiceVisionSelfTest({}, env);
    else result = await contractorInvoiceStatus({}, env);
    write(result);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const paths = defaultContractorInvoicePaths(env);
      await recordContractorInvoiceFailure(paths.healthFile, error);
    } catch {}
    write({ schema_version: 1, status: "error", wakeAgent: false, error: message }, process.stderr);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2), await contractorInvoiceEnvironment(process.env));
}
