#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CAPTURED_AT = "2026-08-06T23:30:00.000Z";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const sources = [
  {
    key: "shezara-ali-492286",
    contact: {
      dripjobsId: "17293537956cd034cfe844473dae44",
      name: "Shezara Ali",
      email: "shezara.ali@gmail.com",
      phone: "6139141793",
      addressLine1: "314 Central Park Dr",
      addressLine2: "#805",
      city: "Ottawa",
      province: "ON",
      postalCode: "K2C 0R2",
      formattedAddress: "314 Central Park Dr #805, Ottawa, ON, K2C 0R2",
      source: "Meta-Perspective",
      salesperson: "Scott Madden",
    },
    job: {
      number: "3159412",
      uuid: "2157053299e8cacb7a1e4743e99c43",
      status: "completed",
      sourceStatus: "Completed",
      pipelineStage: "Project Complete",
      amountCents: 96_615,
    },
    invoice: {
      number: "492286",
      uuid: "7845703897f33012c63e1c4242b054",
      status: "Paid",
      issuedOn: "2026-08-04",
      subtotalCents: 85_500,
      taxCents: 11_115,
      totalCents: 96_615,
      paidCents: 96_615,
      balanceCents: 0,
      createdAt: "2026-08-04T14:16:24.000Z",
      items: [
        ["Why Choose Ottawa Painters", 0, 0, 0],
        ["Client Notes", 0, 0, 0],
        ["Interior Painting - Walls", 46_500, 6_045, 52_545],
        ["Interior Painting - Trim", 9_500, 1_235, 10_735],
        ["Interior Painting - Doors", 18_000, 2_340, 20_340],
        ["Bedroom wall", 11_500, 1_495, 12_995],
      ],
    },
    payments: [
      {
        number: "575860",
        label: "Payment",
        amountCents: 61_615,
        method: "E-Transfer",
        receivedOn: "2026-08-05",
        bankMatch: {
          postedOn: "2026-08-05",
          descriptionIncludes: "***AAq",
          counterparty: "Shezara Ali",
          confirmationMasked: "C1AsSu***AAq",
          bankDepositedOn: "2026-08-05",
        },
      },
      {
        number: "574866",
        label: "Payment",
        amountCents: 35_000,
        method: "E-Transfer",
        receivedOn: "2026-08-04",
        bankMatch: null,
      },
    ],
  },
  {
    key: "darya-rafi-492650",
    contact: {
      dripjobsId: "566256995933af9d21558a4906bca4",
      contactNumber: "2383750",
      name: "Darya Rafi",
      email: "drafipour@gmail.com",
      phone: "6135017778",
      addressLine1: "3106 Uplands Dr",
      addressLine2: null,
      city: "Ottawa",
      province: "ON",
      postalCode: "K1V 9Z6",
      formattedAddress: "3106 Uplands Dr, Ottawa, ON, K1V 9Z6",
      source: "Meta-Perspective",
      salesperson: "Scott Madden",
    },
    job: {
      number: "3129595",
      uuid: "2460188528e5a05ff6e3614a49a13a",
      status: "scheduled",
      sourceStatus: "Scheduled",
      pipelineStage: "Project Scheduled",
      amountCents: 577_882,
    },
    invoice: {
      number: "492650",
      uuid: "24378342564617432d24e048c4ae61",
      status: "Partially Paid",
      issuedOn: "2026-08-04",
      subtotalCents: 511_400,
      taxCents: 66_482,
      totalCents: 577_882,
      paidCents: 144_471,
      balanceCents: 433_411,
      createdAt: null,
      items: [
        ["Why Choose Ottawa Painters", 0, 0, 0],
        ["Client Notes", 0, 0, 0],
        ["Interior Painting - Walls", 511_400, 66_482, 577_882],
      ],
    },
    payments: [
      {
        number: "575558",
        label: "Deposit",
        amountCents: 144_471,
        method: "E-Transfer",
        receivedOn: "2026-08-05",
        bankMatch: {
          postedOn: "2026-08-04",
          descriptionIncludes: "***GAR",
          counterparty: "Darya Rafi Pour",
          confirmationMasked: "C1ApYu***GAR",
          bankDepositedOn: "2026-08-04",
          dateDiscrepancy:
            "DripJobs shows received 2026-08-05; TD EasyWeb shows deposited and posted 2026-08-04.",
        },
      },
    ],
  },
];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertSourceArithmetic(source) {
  const lineSubtotal = source.invoice.items.reduce((sum, item) => sum + item[1], 0);
  const lineTax = source.invoice.items.reduce((sum, item) => sum + item[2], 0);
  const lineTotal = source.invoice.items.reduce((sum, item) => sum + item[3], 0);
  const paymentTotal = source.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  if (
    lineSubtotal !== source.invoice.subtotalCents ||
    lineTax !== source.invoice.taxCents ||
    lineTotal !== source.invoice.totalCents ||
    source.invoice.subtotalCents + source.invoice.taxCents !== source.invoice.totalCents ||
    source.invoice.paidCents + source.invoice.balanceCents !== source.invoice.totalCents ||
    paymentTotal !== source.invoice.paidCents ||
    source.job.amountCents !== source.invoice.totalCents
  ) throw new Error(`${source.key}: source arithmetic does not reconcile.`);
}

for (const source of sources) assertSourceArithmetic(source);

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Refusing import for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const transactionResult = await db
  .from("transactions")
  .select("id,posted_on,description,amount_cents,counterparty,contact_id,review_status,notes,metadata,updated_at")
  .gte("posted_on", "2026-08-03")
  .lte("posted_on", "2026-08-06");
if (transactionResult.error) throw transactionResult.error;

for (const source of sources) {
  const [contactByExternal, contactsByName, quoteByProposal, invoiceByExternal, invoicesByNumber] =
    await Promise.all([
      db.from("contacts").select("*").eq("dripjobs_contact_id", source.contact.dripjobsId).maybeSingle(),
      db.from("contacts").select("*").ilike("name", source.contact.name),
      db.from("quotes").select("*,lead:leads(*)").eq("dripjobs_proposal_id", source.job.number).maybeSingle(),
      db.from("invoices").select("*").eq("source_system", "dripjobs").eq("external_id", source.invoice.uuid).maybeSingle(),
      db.from("invoices").select("*").eq("category", "customer").eq("invoice_number", source.invoice.number),
    ]);
  for (const [label, result] of [
    ["contact external lookup", contactByExternal],
    ["contact name lookup", contactsByName],
    ["quote lookup", quoteByProposal],
    ["invoice external lookup", invoiceByExternal],
    ["invoice number lookup", invoicesByNumber],
  ]) if (result.error) throw new Error(`${source.key} ${label}: ${result.error.message}`);

  const sameIdentityContact = (contactsByName.data ?? []).find((row) =>
    row.email?.toLocaleLowerCase("en-CA") === source.contact.email.toLocaleLowerCase("en-CA") ||
    String(row.phone ?? "").replace(/\D/g, "") === source.contact.phone,
  );
  source.existingContact = contactByExternal.data ?? sameIdentityContact ?? null;
  source.contactId = source.existingContact?.id ?? stableUuid(`contact:dripjobs:${source.contact.dripjobsId}`);
  source.existingQuote = quoteByProposal.data ?? null;
  source.leadId = source.existingQuote?.lead_id ?? stableUuid(`lead:dripjobs-job:${source.job.uuid}`);
  source.quoteId = source.existingQuote?.id ?? stableUuid(`quote:dripjobs:${source.job.number}`);

  const jobById = await db.from("jobs").select("*").eq("id", stableUuid(`job:dripjobs:${source.job.uuid}`)).maybeSingle();
  if (jobById.error) throw new Error(`${source.key} job lookup: ${jobById.error.message}`);
  const jobByQuote = source.existingQuote
    ? await db.from("jobs").select("*").eq("accepted_quote_id", source.quoteId).maybeSingle()
    : { data: null, error: null };
  if (jobByQuote.error) throw new Error(`${source.key} job quote lookup: ${jobByQuote.error.message}`);
  source.existingJob = jobByQuote.data ?? jobById.data ?? null;
  source.jobId = source.existingJob?.id ?? stableUuid(`job:dripjobs:${source.job.uuid}`);

  const compatibleNumberInvoice = (invoicesByNumber.data ?? []).find((row) =>
    row.source_system === "dripjobs" &&
    Number(row.total_cents) === source.invoice.totalCents,
  );
  source.existingInvoice = invoiceByExternal.data ?? compatibleNumberInvoice ?? null;
  source.invoiceId = source.existingInvoice?.id ?? stableUuid(`invoice:dripjobs:${source.invoice.uuid}`);

  for (const payment of source.payments) {
    if (!payment.bankMatch) {
      payment.transaction = null;
      continue;
    }
    const matches = (transactionResult.data ?? []).filter((row) =>
      row.posted_on === payment.bankMatch.postedOn &&
      Number(row.amount_cents) === payment.amountCents &&
      row.description.includes(payment.bankMatch.descriptionIncludes),
    );
    if (matches.length !== 1) {
      throw new Error(`${source.key} payment ${payment.number}: expected one bank transaction, found ${matches.length}.`);
    }
    payment.transaction = matches[0];
  }
}

const unlinked350Candidates = (transactionResult.data ?? []).filter(
  (row) => Number(row.amount_cents) === 35_000,
);
const preview = {
  mode: APPLY ? "apply" : "dry-run",
  sources: sources.map((source) => ({
    customer: source.contact.name,
    contact_id: source.contactId,
    existing_contact: source.existingContact?.id ?? null,
    job_number: source.job.number,
    job_id: source.jobId,
    existing_quote: source.existingQuote
      ? { id: source.existingQuote.id, lead_id: source.existingQuote.lead_id }
      : null,
    existing_job: source.existingJob
      ? {
          id: source.existingJob.id,
          contact_id: source.existingJob.contact_id,
          lead_id: source.existingJob.lead_id,
          accepted_quote_id: source.existingJob.accepted_quote_id,
          status: source.existingJob.status,
          contract_amount_cents: source.existingJob.contract_amount_cents,
          metadata: source.existingJob.metadata,
        }
      : null,
    invoice_number: source.invoice.number,
    invoice_id: source.invoiceId,
    existing_invoice: source.existingInvoice?.id ?? null,
    before_hst_cents: source.invoice.subtotalCents,
    hst_cents: source.invoice.taxCents,
    total_cents: source.invoice.totalCents,
    paid_cents: source.invoice.paidCents,
    balance_cents: source.invoice.balanceCents,
    payments: source.payments.map((payment) => ({
      number: payment.number,
      amount_cents: payment.amountCents,
      received_on: payment.receivedOn,
      bank_transaction: payment.transaction ?? null,
      match_method: payment.transaction ? "exact EasyWeb date, amount, and masked reference" : "DripJobs source payment event only",
    })),
  })),
  unlinked_350_bank_candidates: unlinked350Candidates,
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

for (const source of sources) {
  const sourceUrl = `https://app.dripjobs.com/jobs/invoice/${source.invoice.uuid}`;
  const contactUrl = `https://app.dripjobs.com/contacts/edit/${source.contact.dripjobsId}`;
  const observation = {
    source: "Authenticated DripJobs contact, job, invoice, and payment pages",
    captured_at: CAPTURED_AT,
    no_email_used: true,
    contact: source.contact,
    job: source.job,
    invoice: source.invoice,
    payments: source.payments.map(({ transaction: _transaction, ...payment }) => payment),
    source_urls: { contact: contactUrl, invoice: sourceUrl },
  };
  const observationJson = JSON.stringify(observation);
  const documentId = stableUuid(`document:dripjobs-observation:${source.invoice.uuid}`);

  const documentWrite = await db.from("documents").upsert({
    id: documentId,
    kind: "dripjobs_invoice_observation",
    original_filename: `DripJobs invoice ${source.invoice.number} observation 2026-08-06.json`,
    mime_type: "application/json",
    size_bytes: Buffer.byteLength(observationJson),
    content_sha256: sha256(observationJson),
    source_url: sourceUrl,
    captured_at: CAPTURED_AT,
    metadata: observation,
  }, { onConflict: "id" });
  if (documentWrite.error) throw documentWrite.error;

  const contactWrite = await db.from("contacts").upsert({
    id: source.contactId,
    kind: "customer",
    dripjobs_contact_id: source.contact.dripjobsId,
    name: source.contact.name,
    email: source.contact.email,
    phone: source.contact.phone,
    normalized_email: source.contact.email.toLocaleLowerCase("en-CA"),
    normalized_phone: source.contact.phone,
    metadata: {
      ...(source.existingContact?.metadata ?? {}),
      source: "dripjobs_live_observation",
      source_url: contactUrl,
      source_name: source.contact.source,
      salesperson: source.contact.salesperson,
      contact_number: source.contact.contactNumber ?? null,
      formatted_address: source.contact.formattedAddress,
      captured_at: CAPTURED_AT,
    },
    created_at: source.existingContact?.created_at ?? source.invoice.createdAt ?? CAPTURED_AT,
    updated_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (contactWrite.error) throw contactWrite.error;

  if (!source.existingQuote) {
    const leadWrite = await db.from("leads").upsert({
      id: source.leadId,
      contact_id: source.contactId,
      dripjobs_deal_id: null,
      status: "won",
      pipeline_stage_raw: source.job.pipelineStage,
      source: source.contact.source,
      normalized_channel: "meta",
      address: source.contact.formattedAddress,
      city: source.contact.city,
      province: source.contact.province,
      postal_code: source.contact.postalCode,
      created_at: source.invoice.createdAt ?? CAPTURED_AT,
      captured_at: CAPTURED_AT,
      updated_at: CAPTURED_AT,
      metadata: {
        source: "dripjobs_live_observation",
        job_number: source.job.number,
        job_uuid: source.job.uuid,
        deal_name: source.contact.name,
      },
    }, { onConflict: "id" });
    if (leadWrite.error) throw leadWrite.error;

    const quoteWrite = await db.from("quotes").upsert({
      id: source.quoteId,
      lead_id: source.leadId,
      dripjobs_proposal_id: source.job.number,
      name: source.contact.name,
      status: "accepted",
      amount_cents: source.job.amountCents,
      tax_cents: source.invoice.taxCents,
      accepted_at: null,
      source: "dripjobs_live_observation",
      metadata: {
        job_uuid: source.job.uuid,
        invoice_number: source.invoice.number,
        invoice_uuid: source.invoice.uuid,
        source_status: source.job.sourceStatus,
        pipeline_stage: source.job.pipelineStage,
      },
      created_at: source.invoice.createdAt ?? CAPTURED_AT,
      updated_at: CAPTURED_AT,
    }, { onConflict: "id" });
    if (quoteWrite.error) throw quoteWrite.error;
  }

  const jobWrite = await db.from("jobs").upsert({
    id: source.jobId,
    contact_id: source.contactId,
    lead_id: source.leadId,
    accepted_quote_id: source.quoteId,
    name: source.contact.name,
    status: source.job.status,
    contract_amount_cents: source.job.amountCents,
    address_line_1: source.contact.addressLine1,
    address_line_2: source.contact.addressLine2,
    city: source.contact.city,
    province: source.contact.province,
    postal_code: source.contact.postalCode,
    country: "CA",
    formatted_address: source.contact.formattedAddress,
    companycam_project_ids: source.existingJob?.companycam_project_ids ?? [],
    is_feed_visible: true,
    source: "dripjobs",
    metadata: {
      ...(source.existingJob?.metadata ?? {}),
      dripjobs_job_number: source.job.number,
      dripjobs_job_uuid: source.job.uuid,
      dripjobs_status: source.job.sourceStatus,
      deal_stage: source.job.pipelineStage,
      salesperson: source.contact.salesperson,
      invoice_number: source.invoice.number,
      invoice_uuid: source.invoice.uuid,
      source_url: sourceUrl,
      source_payload: observation,
    },
    created_at: source.existingJob?.created_at ?? source.invoice.createdAt ?? CAPTURED_AT,
    updated_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (jobWrite.error) throw jobWrite.error;

  const invoiceWrite = await db.from("invoices").upsert({
    id: source.invoiceId,
    contact_id: source.contactId,
    direction: "receivable",
    category: "customer",
    source_system: "dripjobs",
    external_id: source.invoice.uuid,
    invoice_number: source.invoice.number,
    status: source.invoice.status,
    issued_on: source.invoice.issuedOn,
    due_on: null,
    currency: "CAD",
    subtotal_cents: source.invoice.subtotalCents,
    tax_cents: source.invoice.taxCents,
    total_cents: source.invoice.totalCents,
    paid_cents: source.invoice.paidCents,
    balance_cents: source.invoice.balanceCents,
    metadata: {
      ...(source.existingInvoice?.metadata ?? {}),
      source_url: sourceUrl,
      source_status: source.invoice.status,
      dripjobs_job_number: source.job.number,
      dripjobs_job_uuid: source.job.uuid,
      salesperson: source.contact.salesperson,
      captured_at: CAPTURED_AT,
      source_payload: observation,
    },
    created_at: source.existingInvoice?.created_at ?? source.invoice.createdAt ?? CAPTURED_AT,
    updated_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (invoiceWrite.error) throw invoiceWrite.error;

  const lineRows = source.invoice.items.map((item, index) => ({
    id: stableUuid(`invoice-line:dripjobs:${source.invoice.uuid}:${index + 1}`),
    invoice_id: source.invoiceId,
    line_number: index + 1,
    description: item[0],
    quantity: 1,
    unit: "item",
    unit_price_cents: item[1],
    subtotal_cents: item[1],
    tax_cents: item[2],
    total_cents: item[3],
    source_kind: "dripjobs_invoice_item",
    metadata: { source_invoice_uuid: source.invoice.uuid },
    created_at: source.invoice.createdAt ?? CAPTURED_AT,
    updated_at: CAPTURED_AT,
  }));
  const linesWrite = await db.from("invoice_lines").upsert(lineRows, { onConflict: "invoice_id,line_number" });
  if (linesWrite.error) throw linesWrite.error;

  const jobAllocationId = stableUuid(`invoice-job-allocation:dripjobs:${source.invoice.uuid}`);
  const jobAllocationWrite = await db.from("invoice_job_allocations").upsert({
    id: jobAllocationId,
    invoice_id: source.invoiceId,
    job_id: source.jobId,
    subtotal_cents: source.invoice.subtotalCents,
    tax_cents: source.invoice.taxCents,
    total_cents: source.invoice.totalCents,
    allocation_method: "source_invoice_job",
    confidence: 1,
    needs_review: false,
    metadata: {
      dripjobs_job_number: source.job.number,
      dripjobs_job_uuid: source.job.uuid,
      source_invoice_uuid: source.invoice.uuid,
    },
    created_at: source.invoice.createdAt ?? CAPTURED_AT,
    updated_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (jobAllocationWrite.error) throw jobAllocationWrite.error;

  for (const payment of source.payments) {
    const allocationId = stableUuid(`transaction-allocation:dripjobs-payment:${payment.number}`);
    if (payment.transaction) {
      const activeAllocations = await db
        .from("transaction_allocations")
        .select("id,invoice_id,amount_cents,reversed_at")
        .eq("transaction_id", payment.transaction.id)
        .is("reversed_at", null);
      if (activeAllocations.error) throw activeAllocations.error;
      const conflict = (activeAllocations.data ?? []).find((allocation) =>
        allocation.id !== allocationId &&
        (allocation.invoice_id !== source.invoiceId || Number(allocation.amount_cents) !== payment.amountCents),
      );
      if (conflict) throw new Error(`${source.key} payment ${payment.number}: conflicting active bank allocation ${conflict.id}.`);
    }

    const allocationWrite = await db.from("transaction_allocations").upsert({
      id: allocationId,
      transaction_id: payment.transaction?.id ?? null,
      invoice_id: source.invoiceId,
      job_id: source.jobId,
      contact_id: source.contactId,
      source_system: "dripjobs",
      external_id: payment.number,
      allocation_type: payment.transaction ? "customer_payment" : "customer_payment_event",
      amount_cents: payment.amountCents,
      allocation_method: payment.transaction
        ? "exact_bank_date_amount_reference_and_dripjobs_payment"
        : "dripjobs_source_payment_event",
      confidence: 1,
      needs_review: false,
      metadata: {
        payment_label: payment.label,
        payment_method: payment.method,
        dripjobs_received_on: payment.receivedOn,
        bank_evidence: payment.bankMatch,
        no_email_used: true,
      },
      created_at: CAPTURED_AT,
      updated_at: CAPTURED_AT,
    }, { onConflict: "id" });
    if (allocationWrite.error) throw allocationWrite.error;

    if (payment.transaction) {
      const transactionWrite = await db.from("transactions").update({
        contact_id: source.contactId,
        counterparty: payment.bankMatch.counterparty,
        review_status: "reconciled",
        notes: `Verified DripJobs ${payment.label.toLocaleLowerCase("en-CA")} #${payment.number} for invoice ${source.invoice.number}.`,
        metadata: {
          ...(payment.transaction.metadata ?? {}),
          bank_reconciliation: {
            allocation_id: allocationId,
            invoice_id: source.invoiceId,
            invoice_number: source.invoice.number,
            job_id: source.jobId,
            contact_id: source.contactId,
            dripjobs_payment_number: payment.number,
            method: "exact_bank_date_amount_reference_and_dripjobs_payment",
            dripjobs_received_on: payment.receivedOn,
            bank_evidence: payment.bankMatch,
          },
        },
        updated_at: CAPTURED_AT,
      })
        .eq("id", payment.transaction.id)
        .eq("updated_at", payment.transaction.updated_at)
        .select("id")
        .maybeSingle();
      if (transactionWrite.error) throw transactionWrite.error;
      if (!transactionWrite.data) throw new Error(`${source.key}: concurrent bank transaction update.`);
    }

    const paymentEventWrite = await db.from("verification_events").upsert({
      id: stableUuid(`verification:dripjobs-payment:${payment.number}`),
      entity_type: "transaction_allocation",
      entity_id: allocationId,
      action: payment.transaction ? "bank_payment_reconciled" : "source_payment_recorded",
      reason: payment.transaction
        ? `DripJobs payment #${payment.number} matched the unique EasyWeb transaction by date, amount, and masked reference.`
        : `DripJobs payment #${payment.number} was recorded without inventing a bank-transaction match.`,
      old_values: null,
      new_values: {
        invoice_number: source.invoice.number,
        payment_number: payment.number,
        amount_cents: payment.amountCents,
        transaction_id: payment.transaction?.id ?? null,
      },
      evidence: {
        document_id: documentId,
        dripjobs_received_on: payment.receivedOn,
        bank_evidence: payment.bankMatch,
        no_email_used: true,
      },
      occurred_at: CAPTURED_AT,
    }, { onConflict: "id" });
    if (paymentEventWrite.error) throw paymentEventWrite.error;
  }

  for (const entity of [
    { type: "contact", id: source.contactId, role: "source_contact" },
    { type: "job", id: source.jobId, role: "source_job" },
    { type: "invoice", id: source.invoiceId, role: "physical_invoice_observation" },
    ...source.payments.filter((payment) => payment.transaction).map((payment) => ({
      type: "transaction",
      id: payment.transaction.id,
      role: "matched_bank_payment",
    })),
  ]) {
    const evidenceLinkWrite = await db.from("evidence_links").upsert({
      id: stableUuid(`evidence-link:${documentId}:${entity.type}:${entity.id}`),
      document_id: documentId,
      entity_type: entity.type,
      entity_id: entity.id,
      evidence_role: entity.role,
      metadata: { invoice_number: source.invoice.number },
      created_at: CAPTURED_AT,
    }, { onConflict: "id" });
    if (evidenceLinkWrite.error) throw evidenceLinkWrite.error;
  }

  const invoiceEventWrite = await db.from("verification_events").upsert({
    id: stableUuid(`verification:dripjobs-invoice:${source.invoice.uuid}`),
    entity_type: "invoice",
    entity_id: source.invoiceId,
    action: "source_invoice_imported",
    reason: `Authenticated DripJobs invoice #${source.invoice.number} and its payment history were captured directly; email was not used.`,
    old_values: source.existingInvoice,
    new_values: {
      invoice_number: source.invoice.number,
      subtotal_cents: source.invoice.subtotalCents,
      tax_cents: source.invoice.taxCents,
      total_cents: source.invoice.totalCents,
      paid_cents: source.invoice.paidCents,
      balance_cents: source.invoice.balanceCents,
      job_id: source.jobId,
    },
    evidence: { document_id: documentId, source_url: sourceUrl, no_email_used: true },
    occurred_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (invoiceEventWrite.error) throw invoiceEventWrite.error;
}

const verification = await db
  .from("invoices")
  .select("id,invoice_number,status,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,contact:contacts(id,name,dripjobs_contact_id),job_allocations:invoice_job_allocations(id,subtotal_cents,tax_cents,total_cents,needs_review,job:jobs(id,name,status,contract_amount_cents)),payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,external_id,allocation_type,amount_cents,needs_review)")
  .in("id", sources.map((source) => source.invoiceId));
if (verification.error) throw verification.error;

for (const row of verification.data ?? []) {
  const paymentTotal = (row.payment_allocations ?? []).reduce((sum, allocation) => sum + Number(allocation.amount_cents), 0);
  const jobTotal = (row.job_allocations ?? []).reduce((sum, allocation) => sum + Number(allocation.total_cents), 0);
  if (
    Number(row.subtotal_cents) + Number(row.tax_cents) !== Number(row.total_cents) ||
    Number(row.paid_cents) + Number(row.balance_cents) !== Number(row.total_cents) ||
    paymentTotal !== Number(row.paid_cents) ||
    jobTotal !== Number(row.total_cents)
  ) throw new Error(`Post-write verification failed for invoice ${row.invoice_number}.`);
}
console.log(JSON.stringify({ status: "verified", invoices: verification.data }, null, 2));
