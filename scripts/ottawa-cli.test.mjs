import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildOttawaDbInvocation, buildReportSql, parseReportArgs } from "./lib/ottawa-report-contract.mjs";
import { isCacheableCustomerBrief, readCustomerBriefCache, writeCustomerBriefCache } from "./ottawa-cli.mjs";

test("briefing is one bounded report call", () => {
  const options = parseReportArgs(["briefing", "--days", "30", "--limit", "12", "--json"]);
  assert.deepEqual(options, { command: "briefing", days: 30, limit: 12, json: true });
  assert.equal(buildReportSql(options), "select public.hermes_briefing(30, 12) as report");
  const invocation = buildOttawaDbInvocation(options, "/safe/ottawa-db");
  assert.deepEqual(invocation, {
    executable: "/safe/ottawa-db",
    args: ["query", "select public.hermes_briefing(30, 12) as report", "--limit", "1", "--json"],
  });
});

test("labour defaults to yesterday and keeps the business date explicit", () => {
  const yesterday = parseReportArgs(["labour", "--json"]);
  assert.deepEqual(yesterday, { command: "labour", date: "yesterday", limit: 100, json: true });
  assert.equal(buildReportSql(yesterday), "select public.hermes_labour('yesterday', 100) as report");

  const dated = parseReportArgs(["labour", "--date", "2026-08-08", "--limit", "20"]);
  assert.equal(buildReportSql(dated), "select public.hermes_labour('2026-08-08', 20) as report");
});

test("labour dates reject invalid or ambiguous values", () => {
  assert.throws(() => parseReportArgs(["labour", "--date", "08/08/2026"]), /today, yesterday, or YYYY-MM-DD/);
  assert.throws(() => parseReportArgs(["labour", "--date", "2026-02-30"]), /valid calendar date/);
  assert.throws(() => parseReportArgs(["cash", "--date", "yesterday"]), /does not accept --date/);
});

test("JSON is a query option for the cloud ottawa-db parser", () => {
  const invocation = buildOttawaDbInvocation(
    parseReportArgs(["customer", "Abdullah Yacoub", "--json"]),
    "/safe/ottawa-db",
  );
  assert.equal(invocation.args[0], "query");
  assert.equal(invocation.args.at(-1), "--json");
});

test("job search is SQL escaped and never passed through a shell", () => {
  const options = parseReportArgs(["job", "O'Brien", "Main", "--limit", "5"]);
  assert.equal(buildReportSql(options), "select public.hermes_job_360('O''Brien Main', 5) as report");
});

test("customer requires a search value", () => {
  assert.throws(() => parseReportArgs(["customer"]), /requires a search value/);
});

test("bounded numeric options reject invalid and excessive values", () => {
  assert.throws(() => parseReportArgs(["cash", "--limit", "0"]), /between 1 and 200/);
  assert.throws(() => parseReportArgs(["followups", "--days", "91"]), /between 1 and 90/);
});

test("unknown options and positional values are rejected", () => {
  assert.throws(() => parseReportArgs(["cash", "surprise"]), /does not accept a search value/);
  assert.throws(() => parseReportArgs(["briefing", "--deep"]), /Unknown option/);
});

test("customer briefs use a private bounded cache for immediate repeat questions", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "ottawa-rag-cache-"));
  const env = { OTTAWA_RAG_CACHE_DIR: cacheDir, OTTAWA_RAG_CACHE_TTL_MS: "300000" };
  const options = { query: "Abdullah Yacoub", maxEvidence: 30 };
  const result = {
    resolution: "resolved",
    source_status: {
      database: { status: "ok" },
      gmail: { status: "ok" },
      quo: { status: "unavailable", error: "QUO_API_KEY is unavailable" },
      companycam: { status: "unavailable", error: "COMPANYCAM_API_KEY is unavailable" },
    },
    evidence: [{ source: "gmail", text: "cached" }],
    latency_ms: 1200,
  };
  await writeCustomerBriefCache(options, result, env, 1_000);
  const cached = await readCustomerBriefCache(options, env, 1_050);
  assert.equal(cached.cache.status, "hit");
  assert.equal(cached.cache.age_ms, 50);
  assert.equal(cached.latency_ms, 0);
  assert.equal(await readCustomerBriefCache(options, env, 400_001), null);
});

test("only successful sources or deterministic capability gaps are cached", () => {
  const complete = {
    resolution: "resolved",
    source_status: {
      database: { status: "ok" },
      gmail: { status: "ok" },
      quo: { status: "ok" },
      companycam: { status: "ok" },
    },
  };
  assert.equal(isCacheableCustomerBrief(complete), true);
  assert.equal(isCacheableCustomerBrief({
    ...complete,
    source_status: { ...complete.source_status, quo: { status: "unavailable", error: "QUO_API_KEY is unavailable" } },
  }), true);
  assert.equal(isCacheableCustomerBrief({
    ...complete,
    source_status: { ...complete.source_status, companycam: { status: "unavailable", error: "Customer jobs have no CompanyCam project IDs" } },
  }, { COMPANYCAM_API_KEY: "configured" }), true);
  assert.equal(isCacheableCustomerBrief({ ...complete, source_status: { ...complete.source_status, quo: { status: "error" } } }), false);
  assert.equal(isCacheableCustomerBrief({ ...complete, source_status: { ...complete.source_status, gmail: { status: "error" } } }), false);
});

test("adding an API credential bypasses caches created without that capability", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "ottawa-rag-cache-capability-"));
  const options = { query: "Abdullah Yacoub", maxEvidence: 30 };
  const envWithoutQuo = { OTTAWA_RAG_CACHE_DIR: cacheDir, OTTAWA_RAG_CACHE_TTL_MS: "300000" };
  const result = {
    resolution: "resolved",
    source_status: {
      database: { status: "ok" },
      gmail: { status: "ok" },
      quo: { status: "unavailable", error: "QUO_API_KEY is unavailable" },
      companycam: { status: "unavailable", error: "COMPANYCAM_API_KEY is unavailable" },
    },
  };
  await writeCustomerBriefCache(options, result, envWithoutQuo, 1_000);
  assert.ok(await readCustomerBriefCache(options, envWithoutQuo, 1_100));
  assert.equal(await readCustomerBriefCache(options, { ...envWithoutQuo, QUO_API_KEY: "configured" }, 1_100), null);
});
