#!/usr/bin/env node

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { validateDripJobsJobsExports } from "./lib/dripjobs-jobs-list.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_ROOT = "/opt/data/state/dripjobs-sync";
const DEFAULT_PROFILE = "/opt/data/profiles/dripjobs-sync/browser-profile";
const DEFAULT_IMPORTER = "/opt/data/bin/import-invoice-list-job-amounts.mjs";
const DEFAULT_ENV_FILE = "/opt/data/hermes-job-amounts.env";
const DRIPJOBS_JOBS_URL = "https://app.dripjobs.com/jobs/list";
const SESSION_NAME = "ottawa-dripjobs-daily";
const MAX_COMMAND_OUTPUT = 2 * 1024 * 1024;

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const confirmed = argv.includes("--yes");
  for (const token of argv) if (!["--dry-run", "--yes", "--json"].includes(token)) throw new Error(`Unknown option: ${token}`);
  if (dryRun === confirmed) throw new Error("Run requires exactly one of --dry-run or --yes");
  return { dryRun, confirmed };
}

function pathsFor(env) {
  const root = path.resolve(env.HERMES_DRIPJOBS_SYNC_ROOT || DEFAULT_ROOT);
  if (root === path.parse(root).root) throw new Error("DripJobs sync root must be a specific directory");
  return {
    root,
    downloads: path.join(root, "downloads"),
    health: path.resolve(env.HERMES_DRIPJOBS_SYNC_HEALTH || path.join(root, "health.json")),
    manifest: path.resolve(env.HERMES_DRIPJOBS_SYNC_MANIFEST || path.join(root, "accepted-manifest.json")),
    lease: path.join(root, "run.lock"),
    browserProfile: path.resolve(env.HERMES_DRIPJOBS_BROWSER_PROFILE || DEFAULT_PROFILE),
    importer: path.resolve(env.HERMES_DRIPJOBS_IMPORTER || DEFAULT_IMPORTER),
    envFile: path.resolve(env.HERMES_DRIPJOBS_SUPABASE_ENV || DEFAULT_ENV_FILE),
    agentBrowser: env.HERMES_AGENT_BROWSER_BIN || "agent-browser",
  };
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function acquireLease(file, now) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const descriptor = await open(file, "wx", 0o600);
    await descriptor.writeFile(`${JSON.stringify({ pid: process.pid, started_at: now.toISOString() })}\n`);
    await descriptor.close();
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const existing = await readJson(file, {});
  const started = Date.parse(existing?.started_at || "");
  if (Number.isFinite(started) && now.getTime() - started < 60 * 60 * 1000) throw new Error("another DripJobs sync is already running");
  await unlink(file).catch(() => {});
  const descriptor = await open(file, "wx", 0o600);
  await descriptor.writeFile(`${JSON.stringify({ pid: process.pid, started_at: now.toISOString(), replaced_stale_lease: true })}\n`);
  await descriptor.close();
}

async function command(executable, args, dependencies, timeout = 60_000) {
  const execute = dependencies.execFile || execFileAsync;
  try {
    return await execute(executable, args, { timeout, maxBuffer: MAX_COMMAND_OUTPUT, env: dependencies.env });
  } catch (error) {
    const detail = String(error?.stderr || error?.stdout || error?.message || "command failed").replace(/\s+/g, " ").trim().slice(0, 280);
    throw new Error(`${path.basename(executable)} failed: ${detail}`);
  }
}

async function firstSuccessfulCommand(executable, candidates, dependencies, timeout, failureMessage) {
  for (const args of candidates) {
    try {
      return await command(executable, args, dependencies, timeout);
    } catch {}
  }
  throw new Error(failureMessage);
}

async function downloadedCsv(directory, deadline, dependencies) {
  const pause = dependencies.pause || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let previous = null;
  while (Date.now() < deadline) {
    const entries = await readdir(directory, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase("en-CA").endsWith(".csv"));
    if (candidates.length > 1) throw new Error("browser downloaded more than one CSV file for one Jobs List view");
    if (candidates.length === 1) {
      const file = path.join(directory, candidates[0].name);
      const details = await stat(file);
      if (details.size > 0 && previous?.file === file && previous?.size === details.size) return file;
      previous = { file, size: details.size };
    }
    await pause(500);
  }
  throw new Error("DripJobs did not produce a Jobs List CSV within 30 seconds");
}

function parseEvalObject(output) {
  const raw = String(output ?? "").trim();
  const candidates = [raw];
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try { candidates.push(JSON.parse(raw)); } catch {}
  }
  const openIndex = raw.indexOf("{");
  const closeIndex = raw.lastIndexOf("}");
  if (openIndex >= 0 && closeIndex > openIndex) candidates.push(raw.slice(openIndex, closeIndex + 1));
  for (const candidate of candidates) {
    try {
      if (typeof candidate === "object") return candidate;
      return JSON.parse(String(candidate).replace(/\\"/g, '"'));
    } catch {}
  }
  throw new Error("DripJobs browser returned an unreadable selection result");
}

async function openJobsPage(paths, browserDependencies, common, pause) {
  await command(paths.agentBrowser, [...common, "close"], browserDependencies, 20_000).catch(() => {});
  await pause(500);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await command(paths.agentBrowser, [...common, "open", DRIPJOBS_JOBS_URL], browserDependencies, 60_000);
    await command(paths.agentBrowser, [...common, "wait", "--load", "networkidle"], browserDependencies, 30_000)
      .catch(() => command(paths.agentBrowser, [...common, "wait", "3000"], browserDependencies, 10_000));
    const currentUrl = String((await command(paths.agentBrowser, [...common, "get", "url"], browserDependencies, 10_000)).stdout || "").trim();
    if (/^https:\/\/app\.dripjobs\.com\//i.test(currentUrl)) return currentUrl;
    await command(paths.agentBrowser, [...common, "close"], browserDependencies, 20_000).catch(() => {});
    await pause(1_000);
  }
  throw new Error("DripJobs browser session did not open the expected site after one retry");
}

async function signInIfNeeded(paths, browserDependencies, common, pause, currentUrl) {
  let snapshot = await command(paths.agentBrowser, [...common, "snapshot", "-i"], browserDependencies, 30_000);
  let page = String(snapshot.stdout || "");
  const loginPage = /\/(?:login|signin|auth)(?:\/|$|\?)/i.test(currentUrl) || (/your email address|type=['"]email['"]|autocomplete=['"]username['"]/i.test(page) && /password/i.test(page));
  if (!loginPage) return page;
  const email = String(browserDependencies.env.HERMES_DRIPJOBS_LOGIN_EMAIL || "").trim();
  const password = String(browserDependencies.env.HERMES_DRIPJOBS_LOGIN_PASSWORD || "");
  if (!email || !password) throw new Error("DripJobs needs a one-time sign-in; add the DripJobs login keys in Hermes Keys");
  await firstSuccessfulCommand(paths.agentBrowser, [
    [...common, "fill", "input[type='email']", email],
    [...common, "fill", "input[name='email']", email],
    [...common, "fill", "input[autocomplete='username']", email],
    [...common, "fill", "input[type='text']", email],
  ], browserDependencies, 20_000, "DripJobs email field was not available");
  await firstSuccessfulCommand(paths.agentBrowser, [
    [...common, "fill", "input[type='password']", password],
    [...common, "fill", "input[name='password']", password],
    [...common, "fill", "input[autocomplete='current-password']", password],
  ], browserDependencies, 20_000, "DripJobs password field was not available");
  await firstSuccessfulCommand(paths.agentBrowser, [
    [...common, "find", "role", "button", "click", "--name", "Sign In"],
    [...common, "find", "role", "button", "click", "--name", "Log In"],
    [...common, "click", "button[type='submit']"],
  ], browserDependencies, 20_000, "DripJobs sign-in button was not available");
  await command(paths.agentBrowser, [...common, "wait", "--url", "**/jobs/list*"], browserDependencies, 60_000);
  await pause(2_000);
  snapshot = await command(paths.agentBrowser, [...common, "snapshot", "-i"], browserDependencies, 30_000);
  page = String(snapshot.stdout || "");
  if (/sign\s*in|log\s*in|forgot password/i.test(page)) throw new Error("DripJobs sign-in did not succeed");
  return page;
}

async function exportJobsLists(runDirectory, paths, dependencies) {
  const pause = dependencies.pause || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  await mkdir(paths.browserProfile, { recursive: true, mode: 0o700 });
  const browserDependencies = {
    ...dependencies,
    env: { ...dependencies.env, AGENT_BROWSER_PROFILE: paths.browserProfile, AGENT_BROWSER_DOWNLOAD_PATH: runDirectory },
  };
  const common = ["--session", SESSION_NAME];
  const currentUrl = await openJobsPage(paths, browserDependencies, common, pause);
  await signInIfNeeded(paths, browserDependencies, common, pause, currentUrl);
  await pause(2_000);
  const snapshot = await command(paths.agentBrowser, [...common, "snapshot", "-i"], browserDependencies, 30_000);
  const page = String(snapshot.stdout || "");
  const pageUrl = String((await command(paths.agentBrowser, [...common, "get", "url"], browserDependencies, 10_000)).stdout || "").trim();
  const pageTitle = String((await command(paths.agentBrowser, [...common, "get", "title"], browserDependencies, 10_000)).stdout || "").trim();
  // DripJobs renders the table controls without accessible labels in some
  // headless sessions, so an accessibility snapshot is not a reliable gate.
  // Confirm the canonical page here; the exact toggle, page-length, selection,
  // row-count, and export controls are each validated immediately below.
  if (!/^https:\/\/app\.dripjobs\.com\/jobs\/list(?:[/?#]|$)/i.test(pageUrl) || !/Jobs List/i.test(pageTitle)) {
    const browserDiagnostic = path.join(paths.root, "last-browser-snapshot.json");
    await writeFile(browserDiagnostic, `${JSON.stringify({ captured_at: new Date().toISOString(), url: pageUrl, title: pageTitle, snapshot: page.slice(0, 200_000) }, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`DripJobs Jobs List controls were not ready (title: ${pageTitle.replace(/\s+/g, " ").slice(0, 100) || "untitled"})`);
  }
  await unlink(path.join(paths.root, "last-browser-snapshot.json")).catch(() => {});

  const exported = {};
  for (const view of ["active", "archived"]) {
    const viewDirectory = path.join(runDirectory, view);
    await mkdir(viewDirectory, { recursive: true, mode: 0o700 });
    // agent-browser binds its download directory when the persistent session is
    // opened. Keep downloads in the run root, then move each completed export
    // into its view folder before starting the next export.
    const viewDependencies = browserDependencies;
    const shouldShowArchived = view === "archived";
    await command(paths.agentBrowser, [
      ...common,
      "eval",
      `(() => { const toggle = document.querySelector('#show-archived-toggle'); if (!toggle) return 'missing'; if (toggle.checked !== ${shouldShowArchived}) { toggle.click(); return 'toggled'; } return 'ready'; })()`,
    ], viewDependencies, 30_000);
    await pause(1_500);
    const allResult = await command(paths.agentBrowser, [
      ...common,
      "eval",
      "(() => { const select = document.querySelector(\"select[name='sortable-list-table_length']\"); if (!select) return 'missing'; select.value = '-1'; select.dispatchEvent(new Event('change', { bubbles: true })); return 'all'; })()",
    ], viewDependencies, 30_000);
    if (!/all/.test(String(allResult.stdout || ""))) throw new Error(`DripJobs ${view} Jobs List All control was not available`);
    await pause(1_000);
    const selectedResult = await command(paths.agentBrowser, [
      ...common,
      "eval",
      `(() => { const header = document.querySelector('#select-all'); const toggle = document.querySelector('#show-archived-toggle'); if (!header || !toggle) return { error: 'selection controls missing' }; if (header.checked) header.click(); header.click(); const body = document.body.innerText || ''; const total = Number((body.match(/Total Deals:\\s*(\\d+)/) || [])[1]); return { view: '${view}', archived: toggle.checked, total, rendered: document.querySelectorAll('tbody input[type=checkbox]').length, selected: document.querySelectorAll('tbody input[type=checkbox]:checked').length }; })()`,
    ], viewDependencies, 30_000);
    const selected = parseEvalObject(selectedResult.stdout);
    const minimumRows = shouldShowArchived ? 50 : 25;
    if (selected.archived !== shouldShowArchived || selected.total < minimumRows || selected.rendered !== selected.total || selected.selected !== selected.total) {
      throw new Error(`DripJobs ${view} Jobs List was not fully selected (${selected.selected}/${selected.total})`);
    }
    const exportResult = await command(paths.agentBrowser, [
      ...common,
      "eval",
      "(() => { const link = document.querySelector(\"a[onclick*='exportCSVSelected']\"); if (!link) return 'missing'; link.click(); return 'started'; })()",
    ], viewDependencies, 30_000);
    if (!/started/.test(String(exportResult.stdout || ""))) throw new Error(`DripJobs ${view} Jobs List export control was not available`);
    const downloaded = await downloadedCsv(runDirectory, Date.now() + 30_000, dependencies);
    const destination = path.join(viewDirectory, path.basename(downloaded));
    await rename(downloaded, destination);
    exported[view] = destination;
  }
  return exported;
}

function errorAlert(error, { liveImporterStarted = true } = {}) {
  const detail = String(error?.message || error || "unknown error").replace(/\s+/g, " ").trim().slice(0, 400);
  const writeStatus = liveImporterStarted
    ? "The live importer may have partially applied idempotent updates; verification is required before retry."
    : "No job amounts or production months were changed.";
  return `🚨 DripJobs job authority sync failed — ${detail}. ${writeStatus}`;
}

async function recordFailure(paths, previous, error, now, mode) {
  const health = {
    ...(previous || {}),
    schema_version: 2,
    service: "dripjobs_job_authority_sync",
    mode,
    status: "error",
    validation_status: "failed",
    last_attempt_at: now.toISOString(),
    last_failed_at: now.toISOString(),
    consecutive_errors: Number(previous?.consecutive_errors || 0) + 1,
    last_error: String(error?.message || error).replace(/\s+/g, " ").trim().slice(0, 500),
  };
  await writeJsonAtomic(paths.health, health);
  return health;
}

async function recordSuccess(paths, previous, validation, importerResult, now, mode) {
  const health = {
    schema_version: 2,
    service: "dripjobs_job_authority_sync",
    mode,
    status: "ok",
    validation_status: "accepted",
    last_attempt_at: now.toISOString(),
    last_successful_sync_at: mode === "live" ? now.toISOString() : previous?.last_successful_sync_at ?? null,
    last_successful_validation_at: now.toISOString(),
    last_source_sha256: validation.manifest.source_sha256,
    last_row_count: validation.manifest.row_count,
    last_active_row_count: validation.manifest.active_row_count,
    last_archived_row_count: validation.manifest.archived_row_count,
    last_distinct_proposals: validation.manifest.distinct_proposals,
    last_gross_total_cents: validation.manifest.gross_total_cents,
    last_qualifying_production_rows: validation.manifest.qualifying_production_rows,
    last_applied_jobs: Number(importerResult?.applied_jobs || 0),
    last_applied_amount_changes: Number(importerResult?.applied_amount_changes || 0),
    last_applied_production_month_changes: Number(importerResult?.applied_production_month_changes || 0),
    historical_locked_unchanged: Number(importerResult?.historical_locked_unchanged || 0),
    unresolved_unchanged: Number(importerResult?.unresolved_unchanged || 0),
    consecutive_errors: 0,
    last_error: null,
  };
  await writeJsonAtomic(paths.health, health);
  return health;
}

export async function runDailySync({ argv = process.argv.slice(2), env = process.env, now = new Date(), dependencies = {} } = {}) {
  const options = parseArgs(argv);
  const paths = pathsFor(env);
  const execution = { ...dependencies, env };
  await acquireLease(paths.lease, now);
  await mkdir(paths.downloads, { recursive: true, mode: 0o700 });
  const runDirectory = await mkdtemp(path.join(paths.downloads, "run-"));
  const previousHealth = await readJson(paths.health, {});
  const storedManifest = await readJson(paths.manifest, null);
  // The previous automation stored an Invoice List manifest at this path. It is
  // not a valid continuity baseline for the replacement Jobs List authority,
  // so preserve it on disk until the first live Jobs List run succeeds but do
  // not reject the migration because the source type changed intentionally.
  const previousManifest = storedManifest?.source_type === "dripjobs_jobs_list_all_views_csv"
    ? storedManifest
    : null;
  let liveImporterStarted = false;
  try {
    await access(paths.importer, constants.R_OK);
    await access(paths.envFile, constants.R_OK);
    const csvFiles = await exportJobsLists(runDirectory, paths, execution);
    const [activeBytes, archivedBytes] = await Promise.all([readFile(csvFiles.active), readFile(csvFiles.archived)]);
    const validation = validateDripJobsJobsExports({ active: activeBytes, archived: archivedBytes }, { previousManifest, now });
    const importerArgs = [
      paths.importer,
      `--active-csv=${csvFiles.active}`,
      `--archived-csv=${csvFiles.archived}`,
      `--env=${paths.envFile}`,
      "--summary",
      "--json",
      ...(options.confirmed ? ["--apply"] : []),
    ];
    liveImporterStarted = options.confirmed;
    const imported = await command(process.execPath, importerArgs, execution, 5 * 60_000);
    const importerResult = JSON.parse(String(imported.stdout || "{}").trim() || "{}");
    if (options.confirmed && importerResult.status !== "verified") throw new Error("job authority importer did not return verified status");
    if (options.confirmed) await writeJsonAtomic(paths.manifest, validation.manifest);
    const mode = options.confirmed ? "live" : "dry-run";
    const health = await recordSuccess(paths, previousHealth, validation, importerResult, now, mode);
    return {
      exitCode: 0,
      output: options.dryRun
        ? JSON.stringify({ status: "dry_run_ok", validation: validation.manifest, importer: importerResult })
        : Number(previousHealth?.consecutive_errors || 0) > 0
          ? `✅ DripJobs job authority sync recovered — ${health.last_row_count} jobs validated; ${health.last_applied_jobs} job record(s) updated.`
          : "",
      health,
      validation,
      importerResult,
    };
  } catch (error) {
    await recordFailure(paths, previousHealth, error, now, options.confirmed ? "live" : "dry-run");
    return { exitCode: 1, output: errorAlert(error, { liveImporterStarted }), error };
  } finally {
    await command(paths.agentBrowser, ["--session", SESSION_NAME, "close"], execution, 20_000).catch(() => {});
    await rm(runDirectory, { recursive: true, force: true });
    await unlink(paths.lease).catch(() => {});
  }
}

async function main() {
  const result = await runDailySync();
  if (result.output) process.stdout.write(`${result.output}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stdout.write(`${errorAlert(error)}\n`);
    process.exitCode = 1;
  });
}
