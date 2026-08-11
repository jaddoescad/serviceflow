import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { allowedQuoPhoneNumberIds } from "./ottawa-quo-scope.mjs";

const execFileAsync = promisify(execFile);
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const QUO_API = "https://api.quo.com/v1";
const COMPANYCAM_API = "https://api.companycam.com/v2";
const SIBLING_OTTAWA_DB = resolve(dirname(fileURLToPath(import.meta.url)), "..", "ottawa-db");

export const CUSTOMER_BRIEF_HELP = `Usage:
  ottawa customer-brief <name|email|phone|uuid> [--max-evidence 30] [--timeout-ms 6500] [--json]

Runs one identity-resolution database report, then retrieves Gmail, Quo, and
CompanyCam evidence in parallel. Output is bounded, ranked, and read-only.`;

function boundedInteger(value, name, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseCustomerBriefArgs(argv) {
  const positional = [];
  const options = { json: false, maxEvidence: 30, timeoutMs: 6500, customerLimit: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") options.json = true;
    else if (token === "--max-evidence") {
      options.maxEvidence = boundedInteger(argv[++index], token, 30, 1, 60);
    } else if (token === "--timeout-ms") {
      options.timeoutMs = boundedInteger(argv[++index], token, 6500, 1000, 15000);
    } else if (token === "--customer-limit") {
      options.customerLimit = boundedInteger(argv[++index], token, 5, 1, 10);
    } else if (token === "--help" || token === "-h") options.help = true;
    else if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
    else positional.push(token);
  }
  options.query = positional.join(" ").trim();
  if (!options.help && !options.query) throw new Error("customer-brief requires a customer identity");
  return options;
}

function normalizeCustomerCommand(value) {
  if (!value || typeof value !== "object" || value.command !== "customer" || !("contact" in value)) return null;
  const contact = value.contact && typeof value.contact === "object" ? value.contact : null;
  const hasContact = Boolean(contact && [contact.id, contact.name, contact.email, contact.phone].some(Boolean));
  const jobs = Array.isArray(value.jobs) ? value.jobs.map((job) => ({
    ...job,
    id: job.id ?? job.job_id ?? null,
    name: job.name ?? job.job_name ?? null,
    address: job.address ?? job.formatted_address ?? null,
    companycam_project_ids: job.companycam_project_ids ?? [],
  })) : [];
  const quotes = Array.isArray(value.quotes) ? value.quotes.map((quote) => ({
    ...quote,
    name: quote.name ?? quote.quote_name ?? null,
  })) : [];
  return {
    schema_version: 1,
    command: "customer",
    as_of: value.as_of ?? null,
    filters: value.filters ?? {},
    match_count: hasContact ? 1 : 0,
    rows: hasContact ? [{
      match_score: 70,
      customer: contact,
      summary: value.summary ?? {},
      jobs,
      leads: Array.isArray(value.leads) ? value.leads : [],
      quotes,
      invoices: Array.isArray(value.invoices) ? value.invoices : [],
    }] : [],
    warnings: Array.isArray(value.caveats) ? value.caveats : [],
    provenance: ["ottawa-db customer"],
  };
}

function findReport(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    try {
      return findReport(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findReport(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (Number(value.schema_version) === 1 && Array.isArray(value.rows)) return value;
  const customerReport = normalizeCustomerCommand(value);
  if (customerReport) return customerReport;
  for (const key of ["report", "data", "rows", "result", "records"]) {
    if (key in value) {
      const found = findReport(value[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function extractReport(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`ottawa-db returned invalid JSON: ${error.message}`);
  }
  const report = findReport(parsed);
  if (!report) throw new Error("ottawa-db output did not contain a versioned report");
  return report;
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (String(value).trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function normalizedWords(value) {
  return String(value ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function buildDatabaseSearchQueries(query) {
  const trimmed = String(query ?? "").trim();
  const words = normalizedWords(trimmed);
  if (trimmed.includes("@") || /\d{7}/.test(trimmed.replace(/\D/g, "")) || words.length < 2) return [trimmed];
  // A surname lookup handles normal and reversed display names with one DB
  // process; client-side token scoring selects the intended candidate.
  return [words.at(-1)];
}

export function resolveOttawaDbExecutable(env = process.env, pathExists = existsSync) {
  if (env.OTTAWA_DB_CLI) return env.OTTAWA_DB_CLI;
  return pathExists(SIBLING_OTTAWA_DB) ? SIBLING_OTTAWA_DB : "ottawa-db";
}

export function buildCustomerDbInvocation(query, limit, executable) {
  return {
    executable,
    args: ["customer", query, "--limit", String(limit), "--json"],
  };
}

export function isNoCustomerMatchError(error) {
  return /no customer matches/i.test(`${error?.stderr ?? ""} ${error?.message ?? ""}`);
}

function emptyCustomerReport(query) {
  return {
    schema_version: 1,
    command: "customer",
    filters: { term: query },
    match_count: 0,
    rows: [],
    warnings: [],
    provenance: ["ottawa-db customer"],
  };
}

function customerMatchScore(row, query) {
  const customer = row.customer ?? {};
  const lowerQuery = String(query).trim().toLowerCase();
  if ([customer.id, customer.name, customer.email].filter(Boolean).some((value) => String(value).toLowerCase() === lowerQuery)) return 100;
  const queryPhone = String(query).replace(/\D/g, "").length >= 7 ? normalizePhone(query) : null;
  if (queryPhone && queryPhone === normalizePhone(customer.phone)) return 99;
  const queryWords = normalizedWords(query).filter((word) => word.length >= 3);
  const nameWords = normalizedWords(customer.name);
  if (queryWords.length > 0 && queryWords.every((queryWord) => {
    const prefix = queryWord.slice(0, Math.min(6, queryWord.length));
    return nameWords.some((nameWord) => nameWord.startsWith(prefix) || prefix.startsWith(nameWord.slice(0, Math.min(6, nameWord.length))));
  })) return 92;
  return Number(row.match_score ?? 0);
}

function escapeGmailPhrase(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').trim();
}

export function buildGmailQuery(identity) {
  const clauses = [];
  if (identity.email) clauses.push(`from:${identity.email}`, `to:${identity.email}`);
  if (identity.phone) {
    const digits = identity.phone.replace(/\D/g, "");
    if (digits.length >= 7) clauses.push(`"${digits.slice(-10)}"`);
  }
  if (identity.name) clauses.push(`"${escapeGmailPhrase(identity.name)}"`);
  for (const address of identity.addresses ?? []) {
    if (address) clauses.push(`"${escapeGmailPhrase(address)}"`);
  }
  const unique = [...new Set(clauses)].slice(0, 8);
  return `in:anywhere -in:spam -in:trash (${unique.join(" OR ")})`;
}

function compact(value, maximum = 700) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum - 1)}…`;
}

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function evidenceKey(item) {
  return [item.source, item.source_ref ?? "", item.occurred_at ?? "", item.kind ?? "", item.text ?? ""].join("|");
}

function identityTerms(identity) {
  return [...new Set([
    identity.name,
    identity.email,
    normalizePhone(identity.phone),
    ...(identity.addresses ?? []),
  ].filter(Boolean).map((value) => String(value).toLowerCase()))];
}

export function rankEvidence(items, identity, maximum = 30, now = new Date()) {
  const terms = identityTerms(identity);
  const seen = new Set();
  const ranked = [];
  for (const raw of items) {
    const item = {
      ...raw,
      occurred_at: dateValue(raw.occurred_at),
      title: compact(raw.title, 240),
      text: compact(raw.text, 700),
    };
    const key = evidenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const haystack = `${item.title} ${item.text}`.toLowerCase();
    const identityHits = terms.reduce((count, term) => count + (term && haystack.includes(term) ? 1 : 0), 0);
    const sourceWeight = { gmail: 5, quo: 5, companycam: 3, database: 4 }[item.source] ?? 1;
    const ageDays = item.occurred_at ? Math.max(0, (now.valueOf() - new Date(item.occurred_at).valueOf()) / 86_400_000) : 9999;
    const recency = Math.max(0, 3 - ageDays / 180);
    ranked.push({ ...item, score: Number((sourceWeight + identityHits * 4 + recency).toFixed(3)) });
  }
  ranked.sort((a, b) => b.score - a.score || String(b.occurred_at ?? "").localeCompare(String(a.occurred_at ?? "")));
  return ranked.slice(0, maximum).map((item, index) => ({ rank: index + 1, ...item }));
}

function selectResolvedRow(report, query) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  if (rows.length === 0) return { status: "not_found", candidates: [] };
  const sorted = rows
    .map((row) => ({ ...row, match_score: Math.max(Number(row.match_score ?? 0), customerMatchScore(row, query)) }))
    .sort((a, b) => Number(b.match_score ?? 0) - Number(a.match_score ?? 0));
  const best = sorted[0];
  const bestScore = Number(best.match_score ?? (rows.length === 1 ? 90 : 0));
  const secondScore = Number(sorted[1]?.match_score ?? -1);
  const exactQuery = String(query).toLowerCase();
  const directExact = [best.customer?.id, best.customer?.name, best.customer?.email]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase() === exactQuery);
  const queryPhone = String(query).replace(/\D/g, "").length >= 7 ? normalizePhone(query) : null;
  const customerPhone = normalizePhone(best.customer?.phone);
  const exact = directExact || Boolean(queryPhone && customerPhone && queryPhone === customerPhone);
  if (rows.length > 1 && !exact && (bestScore < 85 || bestScore - secondScore < 10)) {
    return {
      status: "ambiguous",
      candidates: sorted.slice(0, 5).map((row) => ({
        id: row.customer?.id,
        name: row.customer?.name,
        email: row.customer?.email,
        phone: row.customer?.phone,
        match_score: row.match_score ?? null,
      })),
    };
  }
  return { status: "resolved", row: best, candidates: [] };
}

function identityFromRow(row) {
  return {
    id: row.customer?.id ?? null,
    name: row.customer?.name ?? null,
    email: row.customer?.email ?? null,
    phone: normalizePhone(row.customer?.phone),
    addresses: [...new Set((row.jobs ?? []).map((job) => job.address).filter(Boolean))].slice(0, 5),
    companycam_project_ids: [...new Set((row.jobs ?? []).flatMap((job) => job.companycam_project_ids ?? []).filter(Boolean))].slice(0, 5),
  };
}

function sourceResult(status, startedAt, extra = {}) {
  return { status, latency_ms: Date.now() - startedAt, ...extra };
}

async function guardedSource(name, operation) {
  const startedAt = Date.now();
  try {
    const evidence = await operation();
    return { name, evidence, status: sourceResult("ok", startedAt, { evidence_count: evidence.length }) };
  } catch (error) {
    return {
      name,
      evidence: [],
      status: sourceResult(error?.code === "SOURCE_UNAVAILABLE" ? "unavailable" : "error", startedAt, {
        error: compact(error.message, 180),
      }),
    };
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} exceeded ${timeoutMs}ms`);
        error.code = "SOURCE_TIMEOUT";
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function unavailable(message) {
  const error = new Error(message);
  error.code = "SOURCE_UNAVAILABLE";
  return error;
}

export async function retrieveCustomerBrief(options, adapters) {
  const startedAt = Date.now();
  const databaseTimeoutMs = Math.max(options.timeoutMs, 12_000);
  const report = await withTimeout(adapters.database(options.query, options.customerLimit), databaseTimeoutMs, "database");
  const resolution = selectResolvedRow(report, options.query);
  if (resolution.status !== "resolved") {
    return {
      schema_version: 1,
      retrieval_version: "basic-customer-rag-v1",
      command: "customer-brief",
      query: options.query,
      resolution: resolution.status,
      candidates: resolution.candidates,
      source_status: { database: { status: "ok", match_count: report.match_count ?? report.rows?.length ?? 0 } },
      evidence: [],
      latency_ms: Date.now() - startedAt,
      warnings: resolution.status === "ambiguous" ? ["Multiple customers matched; external retrieval was skipped."] : ["No customer matched."],
    };
  }

  const row = resolution.row;
  const identity = identityFromRow(row);
  const sourceOperations = [
    ["gmail", adapters.gmail],
    ["quo", adapters.quo],
    ["companycam", adapters.companycam],
  ].map(([name, adapter]) => guardedSource(name, () => withTimeout(adapter(identity), options.timeoutMs, name)));
  const sourceResults = await Promise.all(sourceOperations);
  const evidence = rankEvidence(sourceResults.flatMap((result) => result.evidence), identity, options.maxEvidence);
  const sourceStatus = {
    database: { status: "ok", match_count: report.match_count ?? report.rows?.length ?? 1 },
  };
  for (const result of sourceResults) sourceStatus[result.name] = result.status;

  return {
    schema_version: 1,
    retrieval_version: "basic-customer-rag-v1",
    command: "customer-brief",
    query: options.query,
    resolution: "resolved",
    as_of: new Date().toISOString(),
    identity,
    facts: {
      customer: row.customer,
      summary: row.summary ?? {},
      jobs: row.jobs ?? [],
      leads: row.leads ?? [],
      quotes: row.quotes ?? [],
      invoices: row.invoices ?? row.open_receivables ?? [],
    },
    evidence,
    source_status: sourceStatus,
    latency_ms: Date.now() - startedAt,
    warnings: [
      ...(report.warnings ?? []),
      ...sourceResults.filter((result) => result.status.status !== "ok").map((result) => `${result.name}: ${result.status.error}`),
      "Communication and photo evidence is read-only and does not prove payment or job completion by itself.",
    ],
    provenance: [...new Set([...(report.provenance ?? []), ...sourceResults.map((result) => result.name)])],
  };
}

function headersObject(message) {
  return Object.fromEntries((message.payload?.headers ?? []).map((header) => [String(header.name).toLowerCase(), header.value]));
}

export async function googleAccessToken(env, fetchImpl) {
  const file = env.GOOGLE_TOKEN_FILE || "/opt/data/google_token.json";
  let credential;
  try {
    credential = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw unavailable(`Gmail credential file is unavailable at ${file}`);
  }
  const existing = credential.access_token ?? credential.token;
  const expiry = Number(credential.expiry_date ?? credential.expiry ?? credential.expires_at ?? 0);
  if (existing && expiry > Date.now() + 60_000) return existing;
  if (!credential.refresh_token || !credential.client_id || !credential.client_secret) {
    throw unavailable("Gmail refresh credential is incomplete");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credential.refresh_token,
    client_id: credential.client_id,
    client_secret: credential.client_secret,
  });
  const response = await fetchImpl(credential.token_uri || GOOGLE_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) throw new Error(`Gmail token refresh failed with HTTP ${response.status}`);
  return json.access_token;
}

export async function searchGmail(identity, env = process.env, fetchImpl = fetch) {
  const token = await googleAccessToken(env, fetchImpl);
  const listUrl = new URL(`${GMAIL_API}/messages`);
  listUrl.searchParams.set("q", buildGmailQuery(identity));
  listUrl.searchParams.set("maxResults", String(boundedInteger(env.OTTAWA_RAG_GMAIL_LIMIT, "OTTAWA_RAG_GMAIL_LIMIT", 15, 1, 30)));
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const listResponse = await fetchImpl(listUrl, { method: "GET", headers });
  const list = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) throw new Error(`Gmail search failed with HTTP ${listResponse.status}`);
  const messages = (list.messages ?? []).slice(0, 20);
  const details = await Promise.all(messages.map(async ({ id }) => {
    const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(id)}`);
    url.searchParams.set("format", "metadata");
    for (const name of ["From", "To", "Subject", "Date"]) url.searchParams.append("metadataHeaders", name);
    const response = await fetchImpl(url, { method: "GET", headers });
    if (!response.ok) return null;
    return response.json();
  }));
  return details.filter(Boolean).map((message) => {
    const messageHeaders = headersObject(message);
    const from = messageHeaders.from ?? "";
    const direction = identity.email && from.toLowerCase().includes(identity.email.toLowerCase()) ? "incoming" : "outgoing_or_system";
    return {
      source: "gmail",
      source_ref: message.id,
      occurred_at: dateValue(messageHeaders.date) ?? (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null),
      kind: "email",
      direction,
      title: messageHeaders.subject || "(no subject)",
      text: message.snippet || "",
    };
  });
}

function bodyRows(body) {
  if (Array.isArray(body)) return body;
  for (const key of ["data", "items", "messages", "results"]) if (Array.isArray(body?.[key])) return body[key];
  return [];
}

export async function searchQuo(identity, env = process.env, fetchImpl = fetch) {
  if (!env.QUO_API_KEY) throw unavailable("QUO_API_KEY is unavailable");
  if (!identity.phone) throw unavailable("Customer has no phone number for Quo retrieval");
  const base = env.QUO_API_BASE || QUO_API;
  const headers = { Authorization: env.QUO_API_KEY, Accept: "application/json" };
  const numberResponse = await fetchImpl(`${base}/phone-numbers`, { method: "GET", headers });
  const numberBody = await numberResponse.json().catch(() => ({}));
  if (!numberResponse.ok) throw new Error(`Quo phone-number lookup failed with HTTP ${numberResponse.status}`);
  const phoneNumberIds = allowedQuoPhoneNumberIds(numberBody);
  if (phoneNumberIds.length === 0) throw new Error("Quo Sales and Production phone lines are unavailable");
  const responses = await Promise.all(phoneNumberIds.map(async (phoneNumberId) => {
    const url = new URL(`${base}/messages`);
    url.searchParams.set("phoneNumberId", phoneNumberId);
    url.searchParams.append("participants", identity.phone);
    url.searchParams.set("maxResults", "100");
    const response = await fetchImpl(url, { method: "GET", headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Quo message lookup failed with HTTP ${response.status}`);
    return bodyRows(body);
  }));
  return responses.flat().map((message) => ({
    source: "quo",
    source_ref: message.id ?? message.messageId ?? null,
    occurred_at: message.createdAt ?? message.created_at ?? message.sentAt ?? message.timestamp ?? null,
    kind: message.type ?? "message",
    direction: message.direction ?? null,
    title: message.direction ? `${message.direction} Quo message` : "Quo message",
    text: message.text ?? message.content ?? message.body ?? message.message ?? "",
  }));
}

export async function searchCompanyCam(identity, env = process.env, fetchImpl = fetch) {
  if (!env.COMPANYCAM_API_KEY) throw unavailable("COMPANYCAM_API_KEY is unavailable");
  const projectIds = identity.companycam_project_ids ?? [];
  if (projectIds.length === 0) throw unavailable("Customer jobs have no CompanyCam project IDs");
  const base = env.COMPANYCAM_API_BASE || COMPANYCAM_API;
  const headers = { Authorization: `Bearer ${env.COMPANYCAM_API_KEY}`, Accept: "application/json" };
  const results = await Promise.all(projectIds.slice(0, 5).map(async (projectId) => {
    const [projectResponse, photosResponse] = await Promise.all([
      fetchImpl(`${base}/projects/${encodeURIComponent(projectId)}`, { method: "GET", headers }),
      fetchImpl(`${base}/projects/${encodeURIComponent(projectId)}/photos?per_page=25`, { method: "GET", headers }),
    ]);
    const [project, photosBody] = await Promise.all([
      projectResponse.json().catch(() => ({})),
      photosResponse.json().catch(() => ([])),
    ]);
    if (!projectResponse.ok) throw new Error(`CompanyCam project lookup failed with HTTP ${projectResponse.status}`);
    if (!photosResponse.ok) throw new Error(`CompanyCam photo lookup failed with HTTP ${photosResponse.status}`);
    return { projectId, project, photos: bodyRows(photosBody) };
  }));
  return results.flatMap(({ projectId, project, photos }) => {
    const projectEvidence = {
      source: "companycam",
      source_ref: String(projectId),
      occurred_at: project.updated_at ?? project.updatedAt ?? project.created_at ?? null,
      kind: "project",
      direction: null,
      title: project.name ?? `CompanyCam project ${projectId}`,
      text: compact([project.address?.street_address_1, project.address?.city, project.status].filter(Boolean).join(" — ")),
    };
    const photoEvidence = photos.map((photo) => ({
      source: "companycam",
      source_ref: String(photo.id ?? ""),
      occurred_at: photo.captured_at ?? photo.capturedAt ?? photo.created_at ?? photo.createdAt ?? null,
      kind: "photo",
      direction: null,
      title: `CompanyCam photo — ${project.name ?? projectId}`,
      text: photo.description ?? photo.caption ?? photo.note ?? "Photo recorded",
    }));
    return [projectEvidence, ...photoEvidence];
  });
}

export async function queryCustomerDatabase(query, limit, env = process.env) {
  const timeout = boundedInteger(env.OTTAWA_RAG_DB_TIMEOUT_MS, "OTTAWA_RAG_DB_TIMEOUT_MS", 12000, 1000, 15000);
  const reports = await Promise.all(buildDatabaseSearchQueries(query).map(async (searchQuery) => {
    const invocation = buildCustomerDbInvocation(
      searchQuery,
      limit,
      resolveOttawaDbExecutable(env),
    );
    try {
      const { stdout } = await execFileAsync(invocation.executable, invocation.args, {
        env,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      return extractReport(stdout);
    } catch (error) {
      if (isNoCustomerMatchError(error)) return emptyCustomerReport(searchQuery);
      throw error;
    }
  }));
  const rowsByCustomer = new Map();
  for (const report of reports) {
    for (const row of report.rows ?? []) {
      const key = row.customer?.id ?? JSON.stringify(row.customer);
      const existing = rowsByCustomer.get(key);
      if (!existing || customerMatchScore(row, query) > customerMatchScore(existing, query)) rowsByCustomer.set(key, row);
    }
  }
  const primary = reports[0];
  const rows = [...rowsByCustomer.values()]
    .map((row) => ({ ...row, match_score: customerMatchScore(row, query) }))
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
  return {
    ...primary,
    filters: { ...(primary.filters ?? {}), query, retrieval_queries: buildDatabaseSearchQueries(query) },
    match_count: rows.length,
    rows,
    provenance: [...new Set(reports.flatMap((report) => report.provenance ?? []))],
  };
}

export function liveCustomerAdapters(env = process.env, fetchImpl = fetch) {
  return {
    database: (query, limit) => queryCustomerDatabase(query, limit, env),
    gmail: (identity) => searchGmail(identity, env, fetchImpl),
    quo: (identity) => searchQuo(identity, env, fetchImpl),
    companycam: (identity) => searchCompanyCam(identity, env, fetchImpl),
  };
}
