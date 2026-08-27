import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { contractorInvoiceEnvironment, parseArgs } from "./ottawa-contractor-invoice-cli.mjs";
import {
  contractorInvoiceStatus,
  contractorInvoiceVisionSelfTest,
  deferContractorInvoice,
  extractMoneyCents,
  importContractorInvoice,
  exactCurrentJobForItem,
  parseContractorInvoiceItems,
  pollContractorInvoices,
  prepareContractorInvoice,
  resolveContractorIdentity,
  senderIdentity,
  stageContractorInvoice,
  verifyInvoiceDecision,
  verifyContractorInvoiceItems,
} from "./lib/ottawa-contractor-invoice.mjs";
import { readGmailAttachment } from "./lib/ottawa-gmail-read.mjs";
import { contractorInvoiceReviewDetail } from "../hermes/scripts/ops-health-monitor.mjs";

const encoded = (value) => Buffer.from(value, "utf8").toString("base64url");

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function invoicePdf() {
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 300 >>
stream
BT /F1 12 Tf 72 720 Td (Fennec Contracting) Tj 0 -20 Td (INVOICE 8) Tj 0 -20 Td (Invoice Date: August 28, 2026) Tj 0 -20 Td (Irene Roberts painting services $1,000.00) Tj 0 -20 Td (Subtotal: $1,000.00) Tj 0 -20 Td (HST: $130.00) Tj 0 -20 Td (Total: $1,130.00) Tj ET
endstream
endobj
%%EOF`, "latin1");
}

function gmailMessage(document = invoicePdf(), { mimeType = "application/pdf", filename = "Invoice_8_2026-08-28.pdf", attachmentId = "pdf-bilal-8" } = {}) {
  return {
    id: "19ffd63af982bf0e",
    threadId: "thread-bilal",
    internalDate: String(Date.parse("2026-08-28T12:00:00Z")),
    labelIds: ["INBOX", "Label_42"],
    snippet: "Attached invoice",
    payload: {
      headers: [
        { name: "From", value: "Bilal Akkacha <fennecps@outlook.com>" },
        { name: "To", value: "info@paintersottawa.com" },
        { name: "Subject", value: "BILAL AKKACHA - Painting Services" },
      ],
      parts: [
        { mimeType: "text/plain", filename: "", body: { data: encoded("Please see attached.") } },
        { mimeType, filename, body: { attachmentId, size: document.length } },
      ],
    },
  };
}

function fakeServices({
  document = invoicePdf(),
  mimeType = "application/pdf",
  filename = "Invoice_8_2026-08-28.pdf",
  attachmentId = "pdf-bilal-8",
  contacts = [{ id: "e2500be8-15c2-5e95-8b37-7104814d14be", name: "Fennec Contracting", email: "fennecps@outlook.com", kind: "contractor" }],
} = {}) {
  const message = gmailMessage(document, { mimeType, filename, attachmentId });
  const writes = [];
  const apiImports = [];
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || "GET";
    calls.push({ url: String(url), method });
    if (url.hostname === "gmail.googleapis.com") {
      if (url.pathname.endsWith("/labels")) return response(200, { labels: [{ id: "Label_42", name: "Finance/Contractor invoices", type: "user" }] });
      if (url.pathname.endsWith("/messages")) return response(200, { messages: [{ id: message.id }] });
      if (url.pathname.includes(`/attachments/${attachmentId}`)) return response(200, { size: document.length, data: document.toString("base64url") });
      if (url.pathname.includes(`/messages/${message.id}`)) return response(200, message);
    }
    if (url.hostname === "bwbckdkouqghdadpkjvn.supabase.co") {
      if (url.pathname === "/functions/v1/hermes-contractor-invoices" && method === "POST") {
        const body = JSON.parse(options.body);
        apiImports.push({ body, headers: options.headers });
        return response(200, {
          status: "imported",
          invoice_id: "3cad7e9e-4a9e-5c1f-90a9-6a3d35d96e60",
          document_id: "d72ccb89-06f9-5d73-b9bb-3a9916c190ec",
          contractor: { id: "e2500be8-15c2-5e95-8b37-7104814d14be", name: "Fennec Contracting", match_method: "exact_sender_email" },
          line_count: 1,
          job_allocation_count: 1,
          unassigned_line_count: 0,
        });
      }
      if (url.pathname === "/rest/v1/evidence_links" && method === "GET") return response(200, []);
      if (url.pathname === "/rest/v1/contacts" && method === "GET") {
        return response(200, contacts);
      }
      if (url.pathname === "/rest/v1/jobs" && method === "GET") {
        return response(200, [{ id: "job-irene", name: "Irene Roberts - current", formatted_address: "147 Wharhol Private, Ottawa, ON", status: "scheduled", started_on: null, completed_on: null, archived_at: null, metadata: { source_payload: { Job: "Irene Roberts" } } }]);
      }
      if (url.pathname.startsWith("/storage/v1/object/labour-invoices/")) return response(200, { Key: url.pathname });
      if (url.pathname.startsWith("/rest/v1/") && method === "POST") {
        const table = url.pathname.split("/").at(-1);
        const body = JSON.parse(options.body);
        writes.push({ table, body });
        return response(201, [body]);
      }
    }
    return response(404, { error: { message: `Unhandled ${method} ${url}` } });
  };
  return { fetchImpl, writes, apiImports, calls, message };
}

test("contractor-invoice CLI exposes only bounded workflow commands", () => {
  assert.equal(parseArgs(["poll", "--limit", "10", "--yes", "--json"]).command, "poll");
  assert.equal(parseArgs(["prepare", "--message-id", "19ffd63af982bf0e", "--attachment-index", "1", "--json"]).attachmentIndex, 1);
  assert.equal(parseArgs(["vision-self-test", "--json"]).command, "vision-self-test");
  assert.equal(parseArgs(["import", "--message-id", "19ffd63af982bf0e", "--attachment-index", "1", "--supplier-name", "Fennec Contracting", "--invoice-number", "8", "--issued-on", "2026-08-28", "--subtotal-cents", "100000", "--tax-cents", "13000", "--total-cents", "113000", "--items", "name::Irene Roberts::Irene Roberts painting services::100000::-::-", "--yes", "--json"]).totalCents, 113000);
  assert.throws(() => parseArgs(["import", "--message-id", "19ffd63af982bf0e", "--attachment-index", "1", "--supplier-name", "Fennec Contracting", "--invoice-number", "8", "--issued-on", "2026-08-28", "--subtotal-cents", "100000", "--tax-cents", "13000", "--total-cents", "113000", "--items", "name::Irene Roberts::Irene Roberts painting services::100000::-::-", "--json"]), /requires --yes/);
  assert.throws(() => parseArgs(["import", "--message-id", "19ffd63af982bf0e", "--attachment-index", "1", "--invoice-number", "8", "--issued-on", "2026-08-28", "--subtotal-cents", "100000", "--tax-cents", "13000", "--total-cents", "113000", "--items", "name::Irene Roberts::Irene Roberts painting services::100000::-::-", "--yes", "--json"]), /requires --supplier-name/);
  assert.throws(() => parseArgs(["delete", "--yes", "--json"]), /Command must/);
});

test("OpenAI vision self-test is bounded, read-only, and does not return transcription text", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-vision-self-test-"));
  try {
    let call;
    const result = await contractorInvoiceVisionSelfTest({
      imageTextExtractor: async (input) => {
        call = input;
        return { status: "transcribed_openai", model: "openai/gpt-5.6-luna", text: "[unreadable]" };
      },
    }, { HERMES_CONTRACTOR_INVOICE_DB: path.join(directory, "state.sqlite") });
    assert.equal(result.status, "ok");
    assert.equal(result.model, "openai/gpt-5.6-luna");
    assert.equal(Object.hasOwn(result, "text"), false);
    assert.equal(call.mimeType, "image/png");
    assert.equal(call.bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(call.visionDirectory, path.join(directory, "contractor-invoice-vision"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invoice items require exact printed evidence, balanced subtotals, and unique eligible jobs", () => {
  const handwrittenAmounts = extractMoneyCents("1 | 9922 Hummingbird Crescent 123 PK's | 500 | | 500-\n1 | popcorn removal + painting putty | 26 | | 26");
  assert.equal(handwrittenAmounts.has(50000), true);
  assert.equal(handwrittenAmounts.has(2600), true);
  assert.equal(handwrittenAmounts.has(992200), false);
  assert.equal(handwrittenAmounts.has(12300), false);
  const items = parseContractorInvoiceItems("name::Irene Roberts::Irene Roberts painting services::100000::-::-");
  const verified = verifyContractorInvoiceItems({ items, evidence: "Irene Roberts painting services $1,000.00", invoice: { subtotalCents: 100000, taxCents: 13000 } });
  assert.deepEqual([verified[0].tax_cents, verified[0].total_cents], [13000, 113000]);
  const current = { id: "current", name: "Current", status: "scheduled", metadata: { source_payload: { Job: "Irene Roberts" } } };
  assert.equal(exactCurrentJobForItem([current], items[0]).id, "current");
  assert.equal(exactCurrentJobForItem([current, { ...current, id: "duplicate" }], items[0]), null);
  assert.equal(exactCurrentJobForItem([{ ...current, started_on: "2026-05-31" }], items[0]), null);
  const company = parseContractorInvoiceItems("company::-::Office administration::6500::-::-")[0];
  assert.equal(exactCurrentJobForItem([current], company), null);
  assert.equal(company.match_value, null);
  assert.throws(() => verifyContractorInvoiceItems({ items, evidence: "Different job $1,000.00", invoice: { subtotalCents: 100000, taxCents: 13000 } }), /description is not supported/);
});

test("contractor-invoice CLI reads only required Supabase credentials from the protected Hermes env file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-env-"));
  try {
    const envFile = path.join(directory, "hermes-time-entry.env");
    await writeFile(envFile, "SUPABASE_URL=https://bwbckdkouqghdadpkjvn.supabase.co\nSUPABASE_SERVICE_ROLE_KEY='server-only'\nHERMES_TIME_ENTRY_TOKEN='bounded-token'\nUNRELATED_SECRET=ignore-me\n");
    const result = await contractorInvoiceEnvironment({ EXISTING: "keep" }, envFile);
    assert.equal(result.SUPABASE_URL, "https://bwbckdkouqghdadpkjvn.supabase.co");
    assert.equal(result.SUPABASE_SERVICE_ROLE_KEY, "server-only");
    assert.equal(result.HERMES_TIME_ENTRY_TOKEN, "bounded-token");
    assert.equal(result.UNRELATED_SECRET, undefined);
    assert.equal(result.EXISTING, "keep");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invoice evidence validation requires exact number, date, labelled totals, and arithmetic", () => {
  const evidence = "INVOICE 8\nInvoice Date: August 28, 2026\nSubtotal: $1,000.00\nHST: $130.00\nTotal: $1,130.00";
  assert.deepEqual(verifyInvoiceDecision({ evidence, filename: "Invoice_8_2026-08-28.pdf", invoiceNumber: "8", issuedOn: "2026-08-28", subtotalCents: 100000, taxCents: 13000, totalCents: 113000 }), {
    invoiceNumber: "8", issuedOn: "2026-08-28", subtotalCents: 100000, taxCents: 13000, totalCents: 113000,
  });
  assert.throws(() => verifyInvoiceDecision({ evidence, filename: "Invoice_8.pdf", invoiceNumber: "8", issuedOn: "2026-08-28", subtotalCents: 100000, taxCents: 13000, totalCents: 120000 }), /does not equal/);
  assert.throws(() => verifyInvoiceDecision({ evidence, filename: "Invoice_8.pdf", invoiceNumber: "9", issuedOn: "2026-08-28", subtotalCents: 100000, taxCents: 13000, totalCents: 113000 }), /number is not supported/);

  const waveEvidence = "INVOICE 8613\nInvoice Date: August 12, 2026\nSubtotal: $540.00\nON 13%: $70.20\nTotal: $610.20";
  assert.equal(verifyInvoiceDecision({ evidence: waveEvidence, filename: "Invoice_8613_2026-08-12.pdf", invoiceNumber: "8613", issuedOn: "2026-08-12", subtotalCents: 54000, taxCents: 7020, totalCents: 61020 }).taxCents, 7020);

  const dayDotMonthEvidence = "INVOICE 156364\nDATE: 21.08.2026\nSUBTOTAL: $900.73\n13% HST: $117.09\nTOTAL: $1,017.82";
  assert.equal(verifyInvoiceDecision({ evidence: dayDotMonthEvidence, filename: "IMG_6891.jpeg", invoiceNumber: "156364", issuedOn: "2026-08-21", subtotalCents: 90073, taxCents: 11709, totalCents: 101782 }).issuedOn, "2026-08-21");

  const zeroTaxEvidence = "INVOICE 8\nInvoice Date: August 13, 2026\nTotal: $367.50\nAmount Due: $367.50";
  assert.equal(verifyInvoiceDecision({ evidence: zeroTaxEvidence, filename: "Invoice_8_2026-08-28.pdf", invoiceNumber: "8", issuedOn: "2026-08-13", subtotalCents: 36750, taxCents: 0, totalCents: 36750 }).subtotalCents, 36750);
});

test("sender identity exact-matches the contractor email without trusting display text", () => {
  assert.deepEqual(senderIdentity("Bilal Akkacha <fennecps@outlook.com>"), { name: "Bilal Akkacha", email: "fennecps@outlook.com" });
});

test("authenticated invoice platforms require exact supplier identity in the subject, contact, and attachment", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === "/rest/v1/contacts" && url.searchParams.get("name") === "eq.XDesign Dev Inc") {
      return response(200, [{ id: "ac2a71c8-5082-5bad-af43-d785ed98b30a", name: "XDesign Dev Inc", email: null, kind: "contractor" }]);
    }
    return response(200, []);
  };
  const ctx = { url: "https://bwbckdkouqghdadpkjvn.supabase.co", key: "test" };
  const message = {
    from: "XDesign Dev Inc <mailer@waveapps.com>",
    reply_to: "xdesign.ottawa@gmail.com",
    subject: "Invoice #8613 from XDesign Dev Inc",
    authentication_results: "dkim=pass header.i=@waveapps.com; dmarc=pass header.from=waveapps.com",
  };
  const matched = await resolveContractorIdentity(ctx, message, "XDesign Dev Inc\nInvoice 8613\nTotal $610.20", fetchImpl);
  assert.equal(matched.contractor.name, "XDesign Dev Inc");
  assert.equal(matched.matchMethod, "authenticated_invoice_platform");
  assert.equal(matched.replyToEmail, "xdesign.ottawa@gmail.com");
  assert.equal(calls.some((url) => url.searchParams.get("name") === "eq.XDesign Dev Inc"), true);
  assert.equal(await resolveContractorIdentity(ctx, { ...message, authentication_results: "dmarc=fail" }, "XDesign Dev Inc", fetchImpl), null);
  assert.equal(await resolveContractorIdentity(ctx, message, "Different Supplier", fetchImpl), null);
});

test("authenticated Jobber notifications require the exact subject supplier and attachment supplier", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/contacts" && url.searchParams.get("name") === "eq.Curb Appeal Pro Wash") {
      return response(200, [{ id: "aa2f1617-b5c1-5cda-b10b-eead26562cb3", name: "Curb Appeal Pro Wash", email: null, kind: "contractor" }]);
    }
    return response(200, []);
  };
  const ctx = { url: "https://bwbckdkouqghdadpkjvn.supabase.co", key: "test" };
  const message = {
    from: "Curb Appeal Pro Wash <notification@msg.getjobber.com>",
    reply_to: "Matthew LArrivee <info@curbappealprowash.ca>",
    subject: "Invoice from Curb Appeal Pro Wash - Kelly Mounce - Exterior Brick Pressure Wash",
    authentication_results: "dkim=pass header.i=@msg.getjobber.com; dmarc=pass header.from=getjobber.com",
  };
  const matched = await resolveContractorIdentity(ctx, message, "Curb Appeal Pro Wash\nInvoice #1404\nTotal $150.00", fetchImpl);
  assert.equal(matched.contractor.name, "Curb Appeal Pro Wash");
  assert.equal(matched.matchMethod, "authenticated_invoice_platform");
  assert.equal(matched.replyToEmail, "info@curbappealprowash.ca");
  assert.equal(await resolveContractorIdentity(ctx, { ...message, authentication_results: "dmarc=fail; dkim=fail" }, "Curb Appeal Pro Wash", fetchImpl), null);
  assert.equal(await resolveContractorIdentity(ctx, { ...message, subject: "Invoice from Different Supplier - Kelly Mounce" }, "Curb Appeal Pro Wash", fetchImpl), null);
  assert.equal(await resolveContractorIdentity(ctx, message, "Different Supplier", fetchImpl), null);
});

test("authenticated direct supplier aliases resolve only their fixed contractor", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/contacts" && url.searchParams.get("name") === "eq.Grutenco Painting & Construction Services") {
      return response(200, [{ id: "2d6edf7a-2a0e-585e-8d62-adf89506e6d6", name: "Grutenco Painting & Construction Services", email: null, kind: "contractor" }]);
    }
    return response(200, []);
  };
  const ctx = { url: "https://bwbckdkouqghdadpkjvn.supabase.co", key: "test" };
  const message = {
    from: '"hello@grutenco.ca" <hello@grutenco.ca>',
    subject: "Invoice Grutenco Painting Services",
    authentication_results: "dkim=pass header.i=@grutenco.ca; dmarc=pass header.from=grutenco.ca",
  };
  const matched = await resolveContractorIdentity(ctx, message, "GRUTENCO PAINTING & CONSTRUCTION SERVICES\nTotal $836.20", fetchImpl);
  assert.equal(matched.contractor.name, "Grutenco Painting & Construction Services");
  assert.equal(matched.matchMethod, "authenticated_supplier_alias");
  assert.equal(await resolveContractorIdentity(ctx, { ...message, authentication_results: "spf=fail" }, "GRUTENCO", fetchImpl), null);
});

test("raw attachment access remains bounded and GET-only", async () => {
  const services = fakeServices();
  const result = await readGmailAttachment({ messageId: services.message.id, attachmentIndex: 1 }, {}, services.fetchImpl, "token");
  assert.equal(result.filename, "Invoice_8_2026-08-28.pdf");
  assert.equal(result.bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.deepEqual(services.calls.map((call) => call.method), ["GET", "GET"]);
});

test("image invoices use fresh bounded OpenAI transcriptions for prepare and import validation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-image-"));
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const services = fakeServices({ document: png, mimeType: "image/png", filename: "Invoice_8_2026-08-28.png", attachmentId: "png-bilal-8" });
    const env = {
      HERMES_CONTRACTOR_INVOICE_DB: path.join(directory, "state.sqlite"),
      HERMES_CONTRACTOR_INVOICE_HEALTH: path.join(directory, "health.json"),
      HERMES_CONTRACTOR_INVOICE_LABEL_ID: "Label_42",
      SUPABASE_URL: "https://bwbckdkouqghdadpkjvn.supabase.co",
      HERMES_TIME_ENTRY_TOKEN: "bounded-token",
    };
    let transcriptionCount = 0;
    const imageTextExtractor = async ({ bytes, mimeType, visionDirectory }) => {
      transcriptionCount += 1;
      assert.deepEqual(bytes, png);
      assert.equal(mimeType, "image/png");
      assert.equal(visionDirectory, path.join(directory, "contractor-invoice-vision"));
      return {
        status: "transcribed_openai",
        text: "Fennec Contracting\nINVOICE 8\nInvoice Date: August 28, 2026\nIrene Roberts painting services $1,000.00\nSubtotal: $1,000.00\nHST: $130.00\nTotal: $1,130.00",
      };
    };

    await stageContractorInvoice({ messageId: services.message.id, confirmed: true }, env, services.fetchImpl, "token");
    const prepared = await prepareContractorInvoice(
      { messageId: services.message.id, attachmentIndex: 1 },
      env,
      services.fetchImpl,
      "token",
      imageTextExtractor,
    );
    assert.equal(prepared.content_status, "transcribed_openai");
    assert.match(prepared.attachment_text, /Total: \$1,130\.00/);

    const imported = await importContractorInvoice({
      messageId: services.message.id,
      attachmentIndex: 1,
      supplierName: "Fennec Contracting",
      invoiceNumber: "8",
      issuedOn: "2026-08-28",
      subtotalCents: 100000,
      taxCents: 13000,
      totalCents: 113000,
      items: "name::Irene Roberts::Irene Roberts painting services::100000::-::-",
      confirmed: true,
    }, env, services.fetchImpl, "token", imageTextExtractor);
    assert.equal(imported.status, "imported");
    assert.equal(transcriptionCount, 2);
    assert.equal(services.apiImports[0].body.attachment_text.includes("HST: $130.00"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("first live poll baselines old labelled mail instead of backfilling it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-baseline-"));
  try {
    const services = fakeServices();
    const env = {
      HERMES_CONTRACTOR_INVOICE_DB: path.join(directory, "state.sqlite"),
      HERMES_CONTRACTOR_INVOICE_HEALTH: path.join(directory, "health.json"),
      HERMES_CONTRACTOR_INVOICE_LABEL_ID: "Label_42",
    };
    const result = await pollContractorInvoices({ confirmed: true, now: new Date("2026-08-14T12:00:00Z") }, env, services.fetchImpl, "token");
    assert.equal(result.status, "initialized");
    assert.equal(result.wakeAgent, false);
    assert.equal(result.context.baseline_message_count, 1);
    const health = JSON.parse(await readFile(env.HERMES_CONTRACTOR_INVOICE_HEALTH, "utf8"));
    assert.equal(health.backlog_count, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an explicitly staged message can safely retry a deferred approved attachment", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-restage-"));
  try {
    const services = fakeServices();
    const env = {
      HERMES_CONTRACTOR_INVOICE_DB: path.join(directory, "state.sqlite"),
      HERMES_CONTRACTOR_INVOICE_HEALTH: path.join(directory, "health.json"),
      HERMES_CONTRACTOR_INVOICE_LABEL_ID: "Label_42",
    };
    await stageContractorInvoice({ messageId: services.message.id, confirmed: true }, env, services.fetchImpl, "token");
    await deferContractorInvoice({ messageId: services.message.id, attachmentIndex: 1, reason: "missing_totals", confirmed: true }, env);
    const deferred = await contractorInvoiceStatus({}, env);
    assert.equal(deferred.manual_review_count, 1);
    assert.deepEqual(deferred.manual_review_items, [{
      message_id: services.message.id,
      attachment_index: 1,
      filename: "Invoice_8_2026-08-28.pdf",
      reason: "missing_totals",
    }]);
    assert.match(contractorInvoiceReviewDetail(deferred), /Invoice_8_2026-08-28\.pdf \(missing totals\).*mail\.google\.com.*19ffd63af982bf0e/);

    await stageContractorInvoice({ messageId: services.message.id, confirmed: true }, env, services.fetchImpl, "token");
    const status = await contractorInvoiceStatus({}, env);
    assert.equal(status.backlog_count, 1);
    assert.equal(status.manual_review_count, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verified import creates only an unpaid v2 labour payable with archived evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-import-"));
  try {
    const services = fakeServices();
    const env = {
      HERMES_CONTRACTOR_INVOICE_DB: path.join(directory, "state.sqlite"),
      HERMES_CONTRACTOR_INVOICE_HEALTH: path.join(directory, "health.json"),
      HERMES_CONTRACTOR_INVOICE_LABEL_ID: "Label_42",
      SUPABASE_URL: "https://bwbckdkouqghdadpkjvn.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-server-only-key",
    };
    await stageContractorInvoice({ messageId: services.message.id, confirmed: true }, env, services.fetchImpl, "token");
    const result = await importContractorInvoice({
      messageId: services.message.id,
      attachmentIndex: 1,
      supplierName: "Fennec Contracting",
      invoiceNumber: "8",
      issuedOn: "2026-08-28",
      subtotalCents: 100000,
      taxCents: 13000,
      totalCents: 113000,
      items: "name::Irene Roberts::Irene Roberts painting services::100000::-::-",
      confirmed: true,
      now: new Date("2026-08-28T13:00:00Z"),
    }, env, services.fetchImpl, "token");
    assert.equal(result.status, "imported");
    assert.equal(result.payment_status, "unpaid");
    assert.equal(result.job_allocation_created, true);
    assert.equal(result.payment_allocation_created, false);
    const invoice = services.writes.find((item) => item.table === "invoices")?.body;
    assert.equal(invoice.direction, "payable");
    assert.equal(invoice.category, "labour");
    assert.equal(invoice.paid_cents, 0);
    assert.equal(invoice.balance_cents, 113000);
    assert.equal(invoice.contact_id, "e2500be8-15c2-5e95-8b37-7104814d14be");
    assert.equal(services.writes.some((item) => item.table === "invoice_job_allocations"), true);
    assert.equal(services.writes.some((item) => item.table === "transaction_allocations"), false);
    const line = services.writes.find((item) => item.table === "invoice_lines")?.body;
    assert.equal(line.metadata.needs_review, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a verified labour-invoice label creates a missing contractor contact with audit provenance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-contact-"));
  try {
    const services = fakeServices({ contacts: [] });
    const env = {
      HERMES_CONTRACTOR_INVOICE_DB: path.join(directory, "state.sqlite"),
      HERMES_CONTRACTOR_INVOICE_HEALTH: path.join(directory, "health.json"),
      HERMES_CONTRACTOR_INVOICE_LABEL_ID: "Label_42",
      SUPABASE_URL: "https://bwbckdkouqghdadpkjvn.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-server-only-key",
    };
    await stageContractorInvoice({ messageId: services.message.id, confirmed: true }, env, services.fetchImpl, "token");
    const result = await importContractorInvoice({
      messageId: services.message.id,
      attachmentIndex: 1,
      supplierName: "Fennec Contracting",
      invoiceNumber: "8",
      issuedOn: "2026-08-28",
      subtotalCents: 100000,
      taxCents: 13000,
      totalCents: 113000,
      items: "name::Irene Roberts::Irene Roberts painting services::100000::-::-",
      confirmed: true,
      now: new Date("2026-08-28T13:00:00Z"),
    }, env, services.fetchImpl, "token");

    assert.equal(result.contact_created, true);
    assert.equal(result.contractor.name, "Fennec Contracting");
    assert.equal(result.contractor.match_method, "labelled_labour_invoice_contact_created");
    const contact = services.writes.find((item) => item.table === "contacts")?.body;
    assert.equal(contact.kind, "contractor");
    assert.equal(contact.name, "Fennec Contracting");
    assert.equal(contact.email, "fennecps@outlook.com");
    assert.equal(contact.metadata.source_label_name, "Finance/Contractor invoices");
    assert.equal(contact.metadata.source_label_id, "Label_42");
    assert.equal(contact.metadata.printed_supplier_name, "Fennec Contracting");
    const event = services.writes.find((item) => item.table === "verification_events" && item.body.action === "contractor_contact_created_from_labelled_labour_invoice")?.body;
    assert.equal(event.entity_id, contact.id);
    assert.equal(event.evidence.document_sha256.length, 64);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("contact creation fails closed when the source label or printed supplier evidence is missing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-contact-guard-"));
  try {
    const services = fakeServices({ contacts: [] });
    const env = {
      HERMES_CONTRACTOR_INVOICE_DB: path.join(directory, "state.sqlite"),
      HERMES_CONTRACTOR_INVOICE_HEALTH: path.join(directory, "health.json"),
      HERMES_CONTRACTOR_INVOICE_LABEL_ID: "Label_42",
      SUPABASE_URL: "https://bwbckdkouqghdadpkjvn.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-server-only-key",
    };
    await stageContractorInvoice({ messageId: services.message.id, confirmed: true }, env, services.fetchImpl, "token");
    services.message.labelIds = ["INBOX"];
    await assert.rejects(() => importContractorInvoice({
      messageId: services.message.id,
      attachmentIndex: 1,
      supplierName: "Fennec Contracting",
      invoiceNumber: "8",
      issuedOn: "2026-08-28",
      subtotalCents: 100000,
      taxCents: 13000,
      totalCents: 113000,
      items: "name::Irene Roberts::Irene Roberts painting services::100000::-::-",
      confirmed: true,
    }, env, services.fetchImpl, "token"), /no longer carries the required label/);
    assert.equal(services.writes.some((item) => item.table === "contacts"), false);

    services.message.labelIds = ["INBOX", "Label_42"];
    await stageContractorInvoice({ messageId: services.message.id, confirmed: true }, env, services.fetchImpl, "token");
    await assert.rejects(() => importContractorInvoice({
      messageId: services.message.id,
      attachmentIndex: 1,
      supplierName: "Different Supplier",
      invoiceNumber: "8",
      issuedOn: "2026-08-28",
      subtotalCents: 100000,
      taxCents: 13000,
      totalCents: 113000,
      items: "name::Irene Roberts::Irene Roberts painting services::100000::-::-",
      confirmed: true,
    }, env, services.fetchImpl, "token"), /Supplier name is not supported/);
    assert.equal(services.writes.some((item) => item.table === "contacts"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Hermes token imports through the narrow contractor-invoice API without a service-role key", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "contractor-invoice-api-"));
  try {
    const services = fakeServices();
    const env = {
      HERMES_CONTRACTOR_INVOICE_DB: path.join(directory, "state.sqlite"),
      HERMES_CONTRACTOR_INVOICE_HEALTH: path.join(directory, "health.json"),
      HERMES_CONTRACTOR_INVOICE_LABEL_ID: "Label_42",
      SUPABASE_URL: "https://bwbckdkouqghdadpkjvn.supabase.co",
      HERMES_TIME_ENTRY_TOKEN: "bounded-token",
    };
    await stageContractorInvoice({ messageId: services.message.id, confirmed: true }, env, services.fetchImpl, "token");
    const result = await importContractorInvoice({
      messageId: services.message.id,
      attachmentIndex: 1,
      supplierName: "Fennec Contracting",
      invoiceNumber: "8",
      issuedOn: "2026-08-28",
      subtotalCents: 100000,
      taxCents: 13000,
      totalCents: 113000,
      items: "name::Irene Roberts::Irene Roberts painting services::100000::-::-",
      confirmed: true,
    }, env, services.fetchImpl, "token");
    assert.equal(result.status, "imported");
    assert.equal(services.apiImports.length, 1);
    assert.equal(services.apiImports[0].headers["x-hermes-time-entry-token"], "bounded-token");
    assert.equal(services.apiImports[0].body.action, "importContractorInvoice");
    assert.equal(services.apiImports[0].body.supplier_name, "Fennec Contracting");
    assert.equal(services.apiImports[0].body.source_label_name, "Finance/Contractor invoices");
    assert.equal(services.apiImports[0].body.source_label_verified, true);
    assert.equal(services.apiImports[0].body.total_cents, 113000);
    assert.equal(services.apiImports[0].body.items[0].match_value, "Irene Roberts");
    assert.match(services.apiImports[0].body.document_base64, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(services.calls.some((call) => call.url.includes("/rest/v1/")), false);
    assert.equal(services.calls.some((call) => call.url.includes("/storage/v1/")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
