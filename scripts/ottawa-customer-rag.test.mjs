import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDatabaseSearchQueries,
  buildCustomerDbInvocation,
  buildGmailQuery,
  extractReport,
  isNoCustomerMatchError,
  parseCustomerBriefArgs,
  rankEvidence,
  resolveOttawaDbExecutable,
  retrieveCustomerBrief,
  searchQuo,
} from "./lib/ottawa-customer-rag.mjs";

function customerRow(overrides = {}) {
  return {
    match_score: 95,
    customer: {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Abdullah Yacoub",
      email: "abdullah@example.com",
      phone: "613-555-1212",
    },
    summary: { job_count: 1, receivable_cents: 0 },
    jobs: [{
      id: "job-1",
      name: "Interior painting",
      address: "100 Main Street, Ottawa",
      companycam_project_ids: ["cc-1"],
    }],
    leads: [],
    quotes: [],
    invoices: [],
    ...overrides,
  };
}

function report(rows = [customerRow()]) {
  return { schema_version: 1, command: "customer", match_count: rows.length, rows, warnings: [], provenance: ["public.contacts"] };
}

test("customer-brief arguments are bounded", () => {
  assert.deepEqual(parseCustomerBriefArgs(["Abdullah", "Yacoub", "--max-evidence", "12", "--timeout-ms", "4000", "--json"]), {
    query: "Abdullah Yacoub",
    json: true,
    maxEvidence: 12,
    timeoutMs: 4000,
    customerLimit: 5,
  });
  assert.throws(() => parseCustomerBriefArgs(["Abdullah", "--timeout-ms", "999"]), /between 1000 and 15000/);
  assert.throws(() => parseCustomerBriefArgs([]), /requires a customer identity/);
});

test("database report extraction accepts common ottawa-db envelopes", () => {
  const value = report();
  assert.deepEqual(extractReport(JSON.stringify([{ report: value }])), value);
  assert.deepEqual(extractReport(JSON.stringify({ rows: [{ report: JSON.stringify(value) }] })), value);
  assert.throws(() => extractReport(JSON.stringify({ rows: [] })), /versioned report/);
});

test("database report extraction normalizes the supported customer JSON command", () => {
  const normalized = extractReport(JSON.stringify({
    command: "customer",
    as_of: "2026-08-08T20:48:15Z",
    filters: { term: "Yacoub" },
    contact: { id: "1", name: "Yacoub Abdulla", email: "y@example.com", phone: "613-555-1212" },
    summary: { invoiced_cents: 719280, paid_cents: 719280, outstanding_cents: 0 },
    jobs: [{ job_name: "Yacoub Abdulla", status: "completed" }],
    quotes: [{ quote_name: "Yacoub Abdulla", status: "accepted" }],
    invoices: [{ invoice_number: "402655", status: "Paid" }],
    caveats: ["receivable invoices only"],
  }));
  assert.equal(normalized.match_count, 1);
  assert.equal(normalized.rows[0].customer.name, "Yacoub Abdulla");
  assert.equal(normalized.rows[0].jobs[0].name, "Yacoub Abdulla");
  assert.equal(normalized.rows[0].quotes[0].name, "Yacoub Abdulla");
  assert.deepEqual(normalized.warnings, ["receivable invoices only"]);
});

test("Gmail query uses the resolved identity and stays bounded", () => {
  const query = buildGmailQuery({
    name: "Abdullah Yacoub",
    email: "abdullah@example.com",
    phone: "+16135551212",
    addresses: ["100 Main Street, Ottawa"],
  });
  assert.match(query, /in:anywhere -in:spam -in:trash/);
  assert.match(query, /from:abdullah@example\.com/);
  assert.match(query, /to:abdullah@example\.com/);
  assert.match(query, /"Abdullah Yacoub"/);
  assert.match(query, /"100 Main Street, Ottawa"/);
});

test("Quo customer retrieval queries only Sales and Production", async () => {
  const messageLineIds = [];
  const evidence = await searchQuo(
    { phone: "+16135551212" },
    { QUO_API_KEY: "secret" },
    async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/phone-numbers")) {
        return new Response(JSON.stringify({ data: [
          { id: "PN4MVRByub", name: "New number" },
          { id: "PNHtOrvjNR", name: "Production" },
          { id: "PNM4XhFsCB", name: "Do not use-Out of commission" },
          { id: "PN3Uvs2ITi", name: "Sales" },
        ] }), { status: 200 });
      }
      const phoneNumberId = parsed.searchParams.get("phoneNumberId");
      messageLineIds.push(phoneNumberId);
      return new Response(JSON.stringify({ data: [{ id: `message-${phoneNumberId}`, text: phoneNumberId }] }), { status: 200 });
    },
  );
  assert.deepEqual(messageLineIds.sort(), ["PN3Uvs2ITi", "PNHtOrvjNR"]);
  assert.equal(evidence.length, 2);
});

test("database retrieval uses one surname lookup for reordered names", () => {
  assert.deepEqual(buildDatabaseSearchQueries("Abdullah Yacoub"), ["yacoub"]);
  assert.deepEqual(buildDatabaseSearchQueries("abdullah@example.com"), ["abdullah@example.com"]);
  assert.deepEqual(buildDatabaseSearchQueries("+1 613 555 1212"), ["+1 613 555 1212"]);
});

test("database retrieval survives a minimal subprocess PATH", () => {
  assert.equal(resolveOttawaDbExecutable({ OTTAWA_DB_CLI: "/custom/ottawa-db" }), "/custom/ottawa-db");
  assert.match(resolveOttawaDbExecutable({}, () => true), /\/ottawa-db$/);
  assert.equal(resolveOttawaDbExecutable({}, () => false), "ottawa-db");
});

test("database retrieval uses the structured customer command, not raw SQL", () => {
  assert.deepEqual(buildCustomerDbInvocation("Yacoub", 5, "/opt/data/bin/ottawa-db"), {
    executable: "/opt/data/bin/ottawa-db",
    args: ["customer", "Yacoub", "--limit", "5", "--json"],
  });
});

test("a no-match spelling can coexist with a successful parallel surname lookup", () => {
  assert.equal(isNoCustomerMatchError({ stderr: "ottawa-db: no customer matches 'Abdullah Yacoub'" }), true);
  assert.equal(isNoCustomerMatchError({ stderr: "connection refused" }), false);
});

test("external sources fan out in parallel after one identity lookup", async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const source = (name) => async () => {
    calls.push(name);
    await gate;
    return [];
  };
  const pending = retrieveCustomerBrief(
    { query: "Abdullah Yacoub", maxEvidence: 10, timeoutMs: 2000, customerLimit: 5 },
    {
      database: async () => report(),
      gmail: source("gmail"),
      quo: source("quo"),
      companycam: source("companycam"),
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.sort(), ["companycam", "gmail", "quo"]);
  release();
  const result = await pending;
  assert.equal(result.resolution, "resolved");
  assert.equal(result.identity.phone, "+16135551212");
  assert.deepEqual(result.identity.companycam_project_ids, ["cc-1"]);
});

test("ambiguous identities stop before external retrieval", async () => {
  let externalCalls = 0;
  const source = async () => { externalCalls += 1; return []; };
  const rows = [
    customerRow({ match_score: 70, customer: { id: "1", name: "Alex Smith", email: "a@example.com", phone: null } }),
    customerRow({ match_score: 70, customer: { id: "2", name: "Alex Smyth", email: "b@example.com", phone: null } }),
  ];
  const result = await retrieveCustomerBrief(
    { query: "Alex", maxEvidence: 10, timeoutMs: 2000, customerLimit: 5 },
    { database: async () => report(rows), gmail: source, quo: source, companycam: source },
  );
  assert.equal(result.resolution, "ambiguous");
  assert.equal(externalCalls, 0);
  assert.equal(result.candidates.length, 2);
});

test("reordered and slightly misspelled customer names are resolved by token prefixes", async () => {
  const rows = [
    customerRow({ match_score: 70, customer: { id: "1", name: "Yacoub Abdulla", email: null, phone: "+16135551212" } }),
    customerRow({ match_score: 70, customer: { id: "2", name: "Yacoub Samir", email: null, phone: null } }),
  ];
  const result = await retrieveCustomerBrief(
    { query: "Abdullah Yacoub", maxEvidence: 10, timeoutMs: 2000, customerLimit: 5 },
    { database: async () => report(rows), gmail: async () => [], quo: async () => [], companycam: async () => [] },
  );
  assert.equal(result.resolution, "resolved");
  assert.equal(result.identity.name, "Yacoub Abdulla");
});

test("evidence is deduplicated, compact, and relevance-ranked", () => {
  const identity = { name: "Abdullah Yacoub", email: "abdullah@example.com", phone: "+16135551212", addresses: [] };
  const items = [
    { source: "companycam", source_ref: "1", kind: "photo", occurred_at: "2026-01-01", title: "Photo", text: "Wall" },
    { source: "gmail", source_ref: "2", kind: "email", occurred_at: "2026-02-01", title: "Abdullah Yacoub", text: "From abdullah@example.com" },
    { source: "gmail", source_ref: "2", kind: "email", occurred_at: "2026-02-01", title: "Abdullah Yacoub", text: "From abdullah@example.com" },
  ];
  const ranked = rankEvidence(items, identity, 10, new Date("2026-03-01"));
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].source, "gmail");
  assert.equal(ranked[0].rank, 1);
});

test("source failures are partial, not fatal", async () => {
  const result = await retrieveCustomerBrief(
    { query: "abdullah@example.com", maxEvidence: 10, timeoutMs: 2000, customerLimit: 5 },
    {
      database: async () => report(),
      gmail: async () => [{ source: "gmail", source_ref: "1", kind: "email", occurred_at: "2026-01-01", title: "Estimate", text: "Accepted" }],
      quo: async () => { throw new Error("temporary failure"); },
      companycam: async () => [],
    },
  );
  assert.equal(result.resolution, "resolved");
  assert.equal(result.source_status.gmail.status, "ok");
  assert.equal(result.source_status.quo.status, "error");
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.facts.summary, { job_count: 1, receivable_cents: 0 });
});
