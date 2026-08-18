#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const META_JOB_ID = "1b1f8b6c31f9";
const REMINDER_MS = 6 * 60 * 60 * 1000;
const MAX_REPORT_AGE_MS = 26 * 60 * 60 * 1000;
const MAX_EMAIL_POLL_AGE_MS = 20 * 60 * 1000;
const MAX_CONTRACTOR_INVOICE_POLL_AGE_MS = 20 * 60 * 1000;
const MAX_DRIPJOBS_SYNC_AGE_MS = 30 * 60 * 60 * 1000;
const DEFAULT_ALERT_EMAIL = "info@paintersottawa.com";
const ENV_FILES = ["/opt/data/.env", "/opt/data/hermes-meta-ads.env"];

function parseEnv(text) {
  const result = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).replace(/^export\s+/, "").trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

async function loadEnvironment() {
  for (const file of ENV_FILES) {
    try {
      const parsed = parseEnv(await readFile(file, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (!process.env[key]) process.env[key] = value;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function result(service, ok, detail) {
  return { service, ok, detail: String(detail || (ok ? "healthy" : "failed")).slice(0, 240) };
}

async function fetchJson(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkSlack() {
  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) return result("Slack", false, "bot token is not configured");
  try {
    const { response, body } = await fetchJson("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!response.ok || body.ok !== true) return result("Slack", false, body.error || `HTTP ${response.status}`);
    return result("Slack", true, "connected");
  } catch (error) {
    return result("Slack", false, error?.name === "AbortError" ? "connection timed out" : error.message);
  }
}

async function checkGmail() {
  try {
    const { stdout } = await execFileAsync("/opt/data/bin/ottawa-gmail-label", ["labels", "--json"], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    const payload = JSON.parse(stdout);
    if (payload.status !== "ok") return result("Gmail", false, "label API did not return ok");
    return result("Gmail", true, "connected");
  } catch (error) {
    return result("Gmail", false, error.stderr?.trim() || error.message);
  }
}

async function checkMeta() {
  const token = String(process.env.HERMES_META_ADS_TOKEN || process.env.META_ACCESS_TOKEN || "").trim();
  const accountId = String(process.env.HERMES_META_AD_ACCOUNT_ID || process.env.META_AD_ACCOUNT_ID || "act_762696206838329").trim();
  const version = String(process.env.HERMES_META_GRAPH_API_VERSION || process.env.META_GRAPH_API_VERSION || "v25.0").trim();
  if (!token) return result("Meta Ads", false, "reporting token is not configured");
  try {
    const url = new URL(`https://graph.facebook.com/${version}/${accountId}`);
    url.searchParams.set("fields", "id,account_status");
    const { response, body } = await fetchJson(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok || body.error) return result("Meta Ads", false, body.error?.message || `HTTP ${response.status}`);
    return result("Meta Ads", true, "reporting API connected");
  } catch (error) {
    return result("Meta Ads", false, error?.name === "AbortError" ? "connection timed out" : error.message);
  }
}

function hermesHomeCandidates() {
  return [...new Set([
    process.env.HERMES_HOME,
    path.join(os.homedir(), ".hermes"),
    "/opt/data",
    "/opt/data/.hermes",
  ].filter(Boolean))];
}

async function readJobs() {
  for (const home of hermesHomeCandidates()) {
    const file = path.join(home, "cron", "jobs.json");
    if (!existsSync(file)) continue;
    const payload = JSON.parse(await readFile(file, "utf8"));
    const jobs = Array.isArray(payload) ? payload : (Array.isArray(payload.jobs) ? payload.jobs : []);
    return { jobs, file };
  }
  throw new Error("cron jobs file was not found");
}

function jobId(job) {
  return String(job.id || job.job_id || "");
}

async function checkCron() {
  try {
    const { stdout, stderr } = await execFileAsync("/opt/hermes/bin/hermes", ["cron", "status"], {
      timeout: 20_000,
      maxBuffer: 512 * 1024,
      env: process.env,
    });
    const statusText = `${stdout}\n${stderr}`;
    const alarming = /not running|STALLED|may NOT be firing|ticks may be failing|last tick error|\u2717/i.exec(statusText);
    if (alarming) return result("Scheduled jobs", false, alarming[0]);

    const { jobs } = await readJobs();
    const enabled = jobs.filter((job) => job.enabled !== false && job.state !== "paused");
    const failed = enabled.find((job) => {
      const state = String(job.last_status || "").toLowerCase();
      return state && !["ok", "completed", "success"].includes(state);
    });
    if (failed) {
      return result("Scheduled jobs", false, `${failed.name || jobId(failed)}: ${failed.last_error || failed.last_status}`);
    }

    const metaJob = enabled.find((job) => jobId(job) === META_JOB_ID);
    if (!metaJob) return result("Scheduled jobs", false, "daily Meta report job is missing or paused");
    if (metaJob.last_delivery_error) return result("Scheduled jobs", false, `Meta report delivery failed: ${metaJob.last_delivery_error}`);
    const lastRun = Date.parse(metaJob.last_run_at || "");
    if (!Number.isFinite(lastRun)) return result("Scheduled jobs", false, "daily Meta report has no successful run timestamp");
    if (Date.now() - lastRun > MAX_REPORT_AGE_MS) return result("Scheduled jobs", false, "daily Meta report is more than 26 hours old");
    return result("Scheduled jobs", true, `${enabled.length} enabled job(s), Meta report current`);
  } catch (error) {
    return result("Scheduled jobs", false, error.stderr?.trim() || error.message);
  }
}

async function checkEmailIntake() {
  try {
    const { jobs } = await readJobs();
    const configuredId = String(process.env.HERMES_EMAIL_INTAKE_JOB_ID || "").trim();
    const job = jobs.find((candidate) => (
      configuredId
        ? jobId(candidate) === configuredId
        : String(candidate.name || "").toLowerCase().startsWith("automatic gmail tagging")
    ));
    if (!job || job.enabled === false || job.state === "paused") {
      return result("Email tagging", false, "automatic Gmail tagging job is missing or paused");
    }
    const healthFile = process.env.HERMES_EMAIL_INTAKE_HEALTH || "/opt/data/state/email-intake-health.json";
    const health = JSON.parse(await readFile(healthFile, "utf8"));
    const lastSuccess = Date.parse(health.last_successful_poll_at || "");
    if (!Number.isFinite(lastSuccess) || Date.now() - lastSuccess > MAX_EMAIL_POLL_AGE_MS) {
      return result("Email tagging", false, "no successful Gmail intake poll in the last 20 minutes");
    }
    const backlog = Number(health.backlog_count || 0);
    if (backlog > 25) return result("Email tagging", false, `backlog is ${backlog} messages`);
    const errors = Number(health.consecutive_errors || 0);
    if (errors >= 3) return result("Email tagging", false, `${errors} consecutive processing errors`);
    return result("Email tagging", true, `${health.last_mode || "live"} poll current; backlog ${backlog}`);
  } catch (error) {
    return result("Email tagging", false, error.code === "ENOENT" ? "email intake health record is missing" : error.message);
  }
}

function singleLine(value, fallback) {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text || fallback;
}

export function contractorInvoiceReviewDetail(health) {
  const total = Number(health?.manual_review_count || 0);
  const items = Array.isArray(health?.manual_review_items) ? health.manual_review_items.slice(0, 2) : [];
  if (items.length === 0) return `${total} attachment(s) need manual review`;
  const summaries = items.map((item) => {
    const filename = singleLine(item?.filename, "(unnamed attachment)").slice(0, 80);
    const reason = singleLine(item?.reason, "manual_review").replaceAll("_", " ").slice(0, 60);
    const messageId = String(item?.message_id || "").trim();
    const link = /^[A-Za-z0-9_-]{5,225}$/.test(messageId) ? ` https://mail.google.com/mail/u/0/#all/${messageId}` : "";
    return `${filename} (${reason})${link}`;
  });
  const hidden = total > items.length ? `; +${total - items.length} more` : "";
  return `${total} attachment(s) need manual review: ${summaries.join("; ")}${hidden}`;
}

async function checkContractorInvoiceSync() {
  try {
    const { jobs } = await readJobs();
    const configuredId = String(process.env.HERMES_CONTRACTOR_INVOICE_JOB_ID || "").trim();
    const job = jobs.find((candidate) => (
      configuredId
        ? jobId(candidate) === configuredId
        : String(candidate.name || "").toLowerCase().startsWith("contractor invoice sync")
    ));
    if (!job || job.enabled === false || job.state === "paused") {
      return result("Contractor invoices", false, "contractor invoice sync job is missing or paused");
    }
    const healthFile = process.env.HERMES_CONTRACTOR_INVOICE_HEALTH || "/opt/data/state/contractor-invoice-health.json";
    const health = JSON.parse(await readFile(healthFile, "utf8"));
    const lastSuccess = Date.parse(health.last_successful_poll_at || "");
    if (!Number.isFinite(lastSuccess) || Date.now() - lastSuccess > MAX_CONTRACTOR_INVOICE_POLL_AGE_MS) {
      return result("Contractor invoices", false, "no successful contractor-invoice poll in the last 20 minutes");
    }
    const backlog = Number(health.backlog_count || 0);
    if (backlog > 25) return result("Contractor invoices", false, `backlog is ${backlog} attachments`);
    const errors = Number(health.consecutive_errors || 0);
    if (errors >= 3) return result("Contractor invoices", false, `${errors} consecutive processing errors`);
    const manual = Number(health.manual_review_count || 0);
    if (manual > 0) return result("Contractor invoices", false, contractorInvoiceReviewDetail(health));
    return result("Contractor invoices", true, `${health.last_mode || "live"} poll current; backlog ${backlog}`);
  } catch (error) {
    return result("Contractor invoices", false, error.code === "ENOENT" ? "contractor-invoice health record is missing" : error.message);
  }
}

async function checkDripJobsJobAmountSync() {
  try {
    const { jobs } = await readJobs();
    const configuredId = String(process.env.HERMES_DRIPJOBS_SYNC_JOB_ID || "").trim();
    const job = jobs.find((candidate) => (
      configuredId
        ? jobId(candidate) === configuredId
        : ["daily dripjobs jobs list", "daily dripjobs invoice list"].some((prefix) => (
          String(candidate.name || "").toLowerCase().startsWith(prefix)
        ))
    ));
    if (!job || job.enabled === false || job.state === "paused") {
      return result("DripJobs job authority", false, "daily Jobs List sync job is missing or paused");
    }
    const healthFile = process.env.HERMES_DRIPJOBS_SYNC_HEALTH || "/opt/data/state/dripjobs-sync/health.json";
    const health = JSON.parse(await readFile(healthFile, "utf8"));
    const lastSuccess = Date.parse(health.last_successful_sync_at || "");
    if (!Number.isFinite(lastSuccess) || Date.now() - lastSuccess > MAX_DRIPJOBS_SYNC_AGE_MS) {
      return result("DripJobs job authority", false, "no successful live Jobs List sync in the last 30 hours");
    }
    if (health.validation_status !== "accepted") {
      return result("DripJobs job authority", false, health.last_error || "last Jobs List validation was not accepted");
    }
    const rows = Number(health.last_row_count || 0);
    if (rows < 100) return result("DripJobs job authority", false, `last accepted combined Jobs List had only ${rows} rows`);
    const errors = Number(health.consecutive_errors || 0);
    if (errors > 0) return result("DripJobs job authority", false, `${errors} consecutive sync error(s): ${health.last_error || "unknown error"}`);
    return result("DripJobs job authority", true, `${rows} jobs accepted; last sync current`);
  } catch (error) {
    return result("DripJobs job authority", false, error.code === "ENOENT" ? "DripJobs sync health record is missing" : error.message);
  }
}

function formatTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function alertText(problems) {
  return [
    `\ud83d\udea8 Hermes health alert \u2014 ${formatTimestamp()}`,
    ...problems.map((item) => `\u2022 ${item.service}: ${item.detail}`),
    "Hermes will recheck in 30 minutes and repeat unchanged alerts after 6 hours.",
  ].join("\n");
}

function fingerprint(problems) {
  return createHash("sha256")
    .update(JSON.stringify(problems.map(({ service, detail }) => [service, detail])))
    .digest("hex");
}

function stateFile() {
  return process.env.HERMES_OPS_HEALTH_STATE_FILE || "/opt/data/state/ops-health-state.json";
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

async function writeState(value) {
  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function sendEmailFallback(message) {
  const { googleAccessToken } = await import("/opt/data/bin/lib/ottawa-customer-rag.mjs");
  const token = await googleAccessToken(process.env, fetch);
  const recipient = process.env.HERMES_ALERT_EMAIL || DEFAULT_ALERT_EMAIL;
  const raw = [
    `To: ${recipient}`,
    "Subject: Hermes alert: Slack connectivity failed",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    message,
  ].join("\r\n");
  const { response, body } = await fetchJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(raw) }),
  }, 20_000);
  if (!response.ok) throw new Error(body.error?.message || `Gmail send HTTP ${response.status}`);
}

function simulatedChecks(service) {
  const names = { meta: "Meta Ads", slack: "Slack", gmail: "Gmail", cron: "Scheduled jobs", email: "Email tagging", invoice: "Contractor invoices", dripjobs: "DripJobs job authority" };
  return Object.entries(names).map(([key, name]) => result(name, key !== service, key === service ? "simulated failure" : "healthy"));
}

async function main() {
  await loadEnvironment();
  const simulateIndex = process.argv.indexOf("--simulate");
  const simulated = simulateIndex >= 0 ? process.argv[simulateIndex + 1] : null;
  if (process.argv.includes("--self-test")) {
    process.stdout.write(`${JSON.stringify({ status: "ok", services: ["Meta Ads", "Slack", "Gmail", "Scheduled jobs", "Email tagging", "Contractor invoices", "DripJobs job authority"] })}\n`);
    return;
  }

  const checks = simulated
    ? simulatedChecks(simulated)
    : await Promise.all([checkMeta(), checkSlack(), checkGmail(), checkCron(), checkEmailIntake(), checkContractorInvoiceSync(), checkDripJobsJobAmountSync()]);
  const problems = checks.filter((item) => !item.ok);
  if (simulated) {
    process.stdout.write(`${alertText(problems)}\n`);
    return;
  }

  const previous = await readState();
  if (problems.length === 0) {
    if (previous.fingerprint) process.stdout.write(`\u2705 Hermes monitoring recovered \u2014 all checks healthy (${formatTimestamp()}).\n`);
    await writeState({ fingerprint: null, last_checked_at: new Date().toISOString(), last_healthy_at: new Date().toISOString() });
    return;
  }

  const currentFingerprint = fingerprint(problems);
  const lastAlert = Date.parse(previous.last_alert_at || "");
  const shouldAlert = previous.fingerprint !== currentFingerprint || !Number.isFinite(lastAlert) || Date.now() - lastAlert >= REMINDER_MS;
  const message = alertText(problems);
  if (shouldAlert) {
    process.stdout.write(`${message}\n`);
    if (problems.some((item) => item.service === "Slack") && !problems.some((item) => item.service === "Gmail")) {
      try {
        await sendEmailFallback(message);
      } catch (error) {
        process.stderr.write(`Slack fallback email failed: ${error.message}\n`);
      }
    }
  }
  await writeState({
    fingerprint: currentFingerprint,
    problems,
    last_checked_at: new Date().toISOString(),
    last_alert_at: shouldAlert ? new Date().toISOString() : previous.last_alert_at,
  });
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Hermes health monitor failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
