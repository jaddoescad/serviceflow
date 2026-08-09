#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUSTOMER_BRIEF_HELP,
  liveCustomerAdapters,
  parseCustomerBriefArgs,
  retrieveCustomerBrief,
} from "./lib/ottawa-customer-rag.mjs";
import { QUO_ACCESS_SCOPE_VERSION } from "./lib/ottawa-quo-scope.mjs";
import { HELP, buildOttawaDbInvocation, parseReportArgs } from "./lib/ottawa-report-contract.mjs";

const DEFAULT_CUSTOMER_CACHE_DIR = "/opt/data/cache/customer-brief";
const DEFAULT_CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000;

function customerCacheFile(options, env) {
  const key = createHash("sha256")
    .update(JSON.stringify({
      query: options.query.toLowerCase(),
      maxEvidence: options.maxEvidence,
      capabilities: {
        quo: Boolean(env.QUO_API_KEY) ? QUO_ACCESS_SCOPE_VERSION : false,
        companycam: Boolean(env.COMPANYCAM_API_KEY),
      },
    }))
    .digest("hex");
  return path.join(env.OTTAWA_RAG_CACHE_DIR || DEFAULT_CUSTOMER_CACHE_DIR, `${key}.json`);
}

function customerCacheTtl(env) {
  const value = Number(env.OTTAWA_RAG_CACHE_TTL_MS ?? DEFAULT_CUSTOMER_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 60 * 60 * 1000) : DEFAULT_CUSTOMER_CACHE_TTL_MS;
}

function isDeterministicSourceGap(source, status, env) {
  if (status?.status !== "unavailable") return false;
  if (source === "quo") {
    return !env.QUO_API_KEY || status.error === "Customer has no phone number for Quo retrieval";
  }
  if (source === "companycam") {
    return !env.COMPANYCAM_API_KEY || status.error === "Customer jobs have no CompanyCam project IDs";
  }
  return false;
}

export function isCacheableCustomerBrief(result, env = {}) {
  if (result?.resolution !== "resolved") return false;
  if (result.source_status?.database?.status !== "ok" || result.source_status?.gmail?.status !== "ok") return false;
  return ["quo", "companycam"].every((source) => {
    const status = result.source_status?.[source];
    return status?.status === "ok" || isDeterministicSourceGap(source, status, env);
  });
}

export async function readCustomerBriefCache(options, env = process.env, now = Date.now()) {
  const ttlMs = customerCacheTtl(env);
  if (ttlMs === 0) return null;
  try {
    const cached = JSON.parse(await readFile(customerCacheFile(options, env), "utf8"));
    const ageMs = now - Number(cached.cached_at_ms ?? 0);
    if (ageMs < 0 || ageMs > ttlMs || !isCacheableCustomerBrief(cached.result, env)) return null;
    return {
      ...cached.result,
      cache: { status: "hit", age_ms: ageMs, ttl_ms: ttlMs },
      latency_ms: 0,
    };
  } catch {
    return null;
  }
}

export async function writeCustomerBriefCache(options, result, env = process.env, now = Date.now()) {
  if (customerCacheTtl(env) === 0 || !isCacheableCustomerBrief(result, env)) return;
  const file = customerCacheFile(options, env);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify({ cached_at_ms: now, result }), { mode: 0o600 });
}

export async function run(argv, dependencies = {}) {
  if (argv[0] === "customer-brief") {
    let briefOptions;
    try {
      briefOptions = parseCustomerBriefArgs(argv.slice(1));
    } catch (error) {
      process.stderr.write(`Error: ${error.message}\n\n${CUSTOMER_BRIEF_HELP}\n`);
      return 2;
    }
    if (briefOptions.help) {
      process.stdout.write(`${CUSTOMER_BRIEF_HELP}\n`);
      return 0;
    }
    try {
      const cached = await readCustomerBriefCache(briefOptions, process.env);
      if (cached) {
        process.stdout.write(`${JSON.stringify(cached, null, briefOptions.json ? 0 : 2)}\n`);
        return 0;
      }
      const adapters = dependencies.customerAdapters ?? liveCustomerAdapters(process.env, dependencies.fetch ?? fetch);
      const result = await retrieveCustomerBrief(briefOptions, adapters);
      result.cache = { status: "miss", ttl_ms: customerCacheTtl(process.env) };
      await writeCustomerBriefCache(briefOptions, result, process.env).catch(() => {});
      process.stdout.write(`${JSON.stringify(result, null, briefOptions.json ? 0 : 2)}\n`);
      return result.resolution === "resolved" ? 0 : 3;
    } catch (error) {
      process.stderr.write(`Error: ${error.message}\n`);
      return 1;
    }
  }

  const spawn = dependencies.spawn ?? spawnSync;
  let options;
  try {
    options = parseReportArgs(argv);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n\n${HELP}\n`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const invocation = buildOttawaDbInvocation(options);
  const result = spawn(invocation.executable, invocation.args, {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  if (result.error) {
    process.stderr.write(
      `Unable to run ${invocation.executable}: ${result.error.message}\n` +
      "Set OTTAWA_DB_CLI to the existing read-only ottawa-db executable.\n",
    );
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
