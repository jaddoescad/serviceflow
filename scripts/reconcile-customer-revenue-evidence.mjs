#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const evidencePath = path.resolve(
  repoRoot,
  "data/customer-revenue-payment-evidence-2025-2026.json",
);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(
      page * pageSize,
      page * pageSize + pageSize - 1,
    );
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function money(value) {
  return Number((Number(value) / 100).toFixed(2));
}

function titleCaseName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "Unknown";
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s'.-])([a-z])/g, (_, boundary, letter) =>
      `${boundary}${letter.toUpperCase()}`,
    );
}

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

// Direct bank evidence identified by the Interac confirmation suffix. Amounts
// are intentionally omitted when the entire remaining bank row belongs to one
// invoice. Explicit splits and residuals are stated in cents.
const directInvoiceMap = {
  gZV: [
    { invoice: "286379", cash: 21840 },
    { invoice: "280975", cash: 214700 },
  ],
  dKk: [{ invoice: "287266", cash: 751450 }],
  UBC: [{ invoice: "281026" }],
  myF: [{ invoice: "290252" }],
  DQs: [{ invoice: "297450" }],
  Sd2: [{ invoice: "296492" }],
  fQP: [{ invoice: "287253" }],
  "2Vm": [{ invoice: "286980" }],
  Cya: [{ invoice: "289996" }],
  DJE: [{ invoice: "289996" }],
  e66: [{ invoice: "304634" }],
  hYk: [{ invoice: "315176" }],
  VyR: [{ invoice: "315176" }],
  eEE: [{ invoice: "315176" }],
  waw: [{ invoice: "315176" }],
  ad6: [{ invoice: "317820" }],
  zpE: [{ invoice: "317820" }],
  TYY: [{ invoice: "317820" }],
  nsx: [{ invoice: "314873" }],
  gkt: [{ invoice: "321449" }],
  kSV: [{ invoice: "321449" }],
  dzf: [{ invoice: "317712" }],
  rM7: [{ invoice: "324552" }],
  P4X: [{ invoice: "324552" }],
  wh5: [{ invoice: "328142" }],
  rYJ: [{ invoice: "324029" }],
  "6aW": [{ invoice: "329600" }],
  YQR: [{ invoice: "329600" }],
  VxH: [{ invoice: "299364" }],
  y2s: [{ invoice: "332744" }],
  bCw: [{ invoice: "332744" }],
  FMw: [{ invoice: "340702" }],
  QsS: [{ invoice: "340702" }],
  Ype: [{ invoice: "289564" }],
  uBR: [{ invoice: "346933" }],
  PQU: [{ invoice: "346934" }],
  WUd: [
    { invoice: "346933", cash: 76275 },
    { invoice: "346934", cash: 223725 },
  ],
  "9jV": [{ invoice: "347590" }],
  e78: [{ invoice: "347590" }],
  "4gn": [{ invoice: "348218" }],
  ST8: [{ invoice: "348218" }],
  ECH: [{ invoice: "348218" }],
  Vzu: [{ invoice: "352537" }],
  Fhu: [{ invoice: "353255" }],
  "9dr": [{ invoice: "353255" }],
  tb3: [{ invoice: "355621" }],
  hpW: [{ invoice: "355621" }],
  Vbp: [{ invoice: "366930" }],
  jGw: [{ invoice: "367477" }],
  fpR: [{ invoice: "369764" }],
  ecw: [{ invoice: "369979" }],
  GpZ: [{ invoice: "370886" }],
  Gxz: [{ invoice: "371086" }],
  Vtn: [{ invoice: "371086" }],
  S88: [{ invoice: "371086" }],
  "5Sx": [{ invoice: "371133" }],
  "5zy": [{ invoice: "371052" }],
  n85: [{ invoice: "371351" }],
  AQj: [{ invoice: "371665" }],
  QnH: [{ invoice: "373569" }],
  XHg: [{ invoice: "373569" }],
  WGR: [{ invoice: "373569" }],
  pD4: [{ invoice: "373569" }],
  fMj: [{ invoice: "374250" }],
  kAs: [{ invoice: "375435" }],
  V8F: [{ invoice: "378089" }],
  rGc: [{ invoice: "378083" }],
  "2pQ": [{ invoice: "379104" }],
  GDf: [{ invoice: "379104" }],
  w3Z: [{ invoice: "378518" }],
  "27C": [{ invoice: "388425" }],
  "8cX": [{ invoice: "387407" }],
  Uxw: [{ invoice: "387407" }],
  JYt: [{ invoice: "387407" }],
  "4xG": [{ invoice: "374014" }],
  KYM: [{ invoice: "374014" }],
  KrW: [{ invoice: "384284" }],
  PrE: [{ invoice: "388401" }],
  fZC: [{ invoice: "396896", cash: 35708 }],
  Kr2: [{ invoice: "397426" }],
  H6T: [{ invoice: "403991" }],
  KAE: [{ invoice: "385696", cash: 1007847 }],
  BJD: [{ invoice: "381855" }],
  eve: [{ invoice: "392456" }],
  A6U: [{ invoice: "419997" }],
  "7AZ": [{ invoice: "437631" }],
  cBY: [{ invoice: "437631" }],
  zkz: [{ invoice: "437631" }],
  EFY: [{ invoice: "437631" }],
  aNH: [{ invoice: "437631" }],
  "6fw": [{ invoice: "437631" }],
  Ms6: [{ invoice: "436544" }],
  XdN: [{ invoice: "401384" }],
  Ahh: [{ invoice: "401384" }],
  "66M": [{ invoice: "419899" }],
  hm5: [{ invoice: "409783" }],
  tRX: [{ invoice: "418258", cash: 253487 }],
  YAQ: [{ invoice: "438280" }],
  "7C9": [{ invoice: "462315" }],
  fpu: [{ invoice: "471547", cash: 16441, applied: 16442 }],
  rGz: [{ invoice: "478642" }],
};

const interacExceptions = {
  XCJ: {
    kind: "legacy_invoice_not_imported",
    resolution: "Jobber invoice 122119882 email found; original invoice/job detail still needs archiving.",
    review: true,
  },
  FmH: {
    kind: "legacy_invoice_not_imported",
    resolution: "Second payment for Jobber invoice 122119882; original invoice/job detail still needs archiving.",
    review: true,
  },
  pNg: { kind: "invoice_missing", resolution: "No customer invoice source found.", review: true },
  TGQ: {
    kind: "legacy_invoice_not_imported",
    resolution: "Jobber quote 959 and payment message found; final invoice is not archived.",
    review: true,
  },
  Tzf: {
    kind: "legacy_invoice_not_imported",
    resolution: "Final payment references invoice 945; final invoice is not archived.",
    review: true,
  },
  gqZ: {
    kind: "invoice_missing",
    resolution: "Customer and 2012 Calico Cres identified; invoice source not found.",
    review: true,
  },
  ypR: {
    kind: "invoice_missing",
    resolution: "Final payment for 2012 Calico Cres identified; invoice source not found.",
    review: true,
  },
  WeX: { kind: "invoice_missing", resolution: "No customer invoice source found.", review: true },
  "7Ze": {
    kind: "legacy_invoice_not_imported",
    resolution: "Jobber quote 968 for 1537 Demeter St found; final invoice is not archived.",
    review: true,
  },
  "4N8": {
    kind: "refunded_deposit",
    resolution: "Deposit was fully returned by bank transaction 0c86e772-5d96-4b68-bb72-28b5b6715eb3.",
  },
  Bp3: {
    kind: "refunded_deposit",
    resolution: "Change-order deposit was fully returned by bank transaction 34cdc990-dad8-4fbb-b4c4-d3a80891b781.",
  },
  TSG: {
    kind: "refunded_deposit",
    resolution: "Deposit was fully returned by bank transaction 512598f2-a9ec-4efe-8a1a-83fdb570501f.",
  },
  dKk: { kind: "overpayment", resolution: "$0.50 exceeds invoice #287266." },
  KrW: { kind: "rounding_overpayment", resolution: "$0.39 exceeds invoice #384284 after prior payments." },
  PrE: { kind: "rounding_overpayment", resolution: "$0.01 exceeds invoice #388401 after the prior deposit." },
  Kr2: { kind: "rounding_overpayment", resolution: "$0.05 exceeds invoice #397426 after prior payments." },
  JYt: { kind: "rounding_overpayment", resolution: "$0.25 exceeds invoice #387407 after the three receipts." },
  fZC: { kind: "rounding_overpayment", resolution: "$0.92 exceeds DripJobs payment/invoice credit." },
  BJD: { kind: "overpayment", resolution: "$5.87 exceeds invoice #381855." },
  KAE: {
    kind: "paired_refund",
    resolution: "$557.09 was returned by bank transaction 499dcfd6-7e79-45af-bf00-3791092ed211; net payment is $10,078.47.",
  },
  A6U: {
    kind: "paired_refund",
    resolution: "$71.75 was returned by bank transaction f76316a9-f7eb-4d7b-8e54-f92f50b9a8ee.",
  },
  tRX: { kind: "rounding_overpayment", resolution: "$0.01 exceeds the DripJobs payment event." },
};

const bankDepositMap = [
  { amount: 238600, invoice: "276606", provider: "mobile_deposit" },
  { amount: 159500, invoice: "290462", provider: "mobile_deposit" },
  { amount: 42375, invoice: "346484", provider: "mobile_deposit" },
  { amount: 646699, invoice: "417102", provider: "mobile_deposit", payment: "494851" },
  { amount: 713708, invoice: "402813", provider: "mobile_deposit", payment: "507320" },
];

const stripeMatches = [
  {
    postedOn: "2026-04-27", amount: 122281, payout: "po_1TPXoG72vdHYfMJMbh4XZbAP",
    lines: [
      { invoice: "413691", payment: "484519", cash: 102506, applied: 105598 },
      { invoice: "424851", payment: "488730", cash: 19775, applied: 20397 },
    ],
  },
  {
    postedOn: "2026-05-19", amount: 267798, payout: "po_1TXAD372vdHYfMJMm1eaD5AI",
    lines: [
      { invoice: "424851", payment: "501154", cash: 124779, applied: 128537 },
      { invoice: "430007", payment: "502271", cash: 87090, applied: 89722 },
      { invoice: "428768", payment: "506652", cash: 55929, applied: 57630 },
    ],
  },
  {
    postedOn: "2026-05-25", amount: 627037, payout: "po_1TZh9U72vdHYfMJMtmnx5NWk",
    lines: [{ invoice: "413358", payment: "512370", cash: 627037, applied: 645795 }],
  },
  {
    postedOn: "2026-06-01", amount: 60373, payout: "po_1TcEae72vdHYfMJMSPkAAlmF",
    lines: [{ invoice: "423615", payment: "517173", cash: 60373, applied: 62207 }],
  },
  {
    postedOn: "2026-06-08", amount: 2456482, payout: "po_1TelHn72vdHYfMJM0YlpDb3Y",
    lines: [
      { invoice: "422089", payment: "518529", cash: 1885614, applied: 1941961 },
      { invoice: "420163", payment: "523117", cash: 570868, applied: 587949 },
    ],
  },
  {
    postedOn: "2026-06-22", amount: 72524, payout: "po_1Tjq5O72vdHYfMJMuyGATe5j",
    lines: [{ invoice: "459414", payment: "531028", cash: 72524, applied: 74721 }],
  },
  {
    postedOn: "2026-06-29", amount: 25124, payout: "po_1TmNjD72vdHYfMJMEddadi9L",
    lines: [{ invoice: "465661", payment: "538766", cash: 25124, applied: 25905 }],
  },
  {
    postedOn: "2026-07-06", amount: 47675, payout: "po_1ToujP72vdHYfMJMUjz9B9lo",
    lines: [{ invoice: "441640", payment: "544703", cash: 47675, applied: 49130 }],
  },
  {
    postedOn: "2026-07-13", amount: 36245, payout: "po_1TrSTI72vdHYfMJMnj4PdeVM",
    lines: [{ invoice: "460926", payment: "546843", cash: 36245, applied: 37358 }],
  },
  {
    postedOn: "2026-07-20", amount: 213600, payout: "po_1Ttzb972vdHYfMJMu3rPHyFl",
    lines: [
      { invoice: "465661", payment: "555420", cash: 133037, applied: 137041 },
      { invoice: "469101", payment: "556622", cash: 80563, applied: 83000 },
    ],
  },
];

const unresolvedProcessorRows = [
  { postedOn: "2026-04-13", amount: 355898, payout: "po_1TKTKG72vdHYfMJMjS2wl8cz", counterparty: "Stripe" },
  { postedOn: "2026-05-04", amount: 130130, payout: "po_1TS5NW72vdHYfMJMHU0RtDVc", counterparty: "Stripe" },
  { postedOn: "2026-05-11", amount: 270480, payout: "po_1TUcIr72vdHYfMJMQapQ3WOp", counterparty: "Stripe" },
  { postedOn: "2026-04-20", amount: 110500, payout: null, counterparty: "Payment processor" },
];

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const [transactions, invoices, paymentEvents, existingAllocations] = await Promise.all([
  fetchAll(() =>
    db.from("financial_transactions").select(
      "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,source_data",
    ),
  ),
  fetchAll(() => db.from("customer_invoices").select("id,invoice_number,total_amount,customer_name")),
  fetchAll(() =>
    db.from("customer_invoice_payment_events").select(
      "id,customer_invoice_id,payment_number,received_on,method,amount",
    ),
  ),
  fetchAll(() =>
    db.from("customer_invoice_bank_allocations").select(
      "id,financial_transaction_id,customer_invoice_id,source_payment_event_id,allocated_amount,invoice_applied_amount,reversed_at",
    ).is("reversed_at", null),
  ),
]);

const transactionById = new Map(transactions.map((row) => [row.id, row]));
const invoicesByNumber = new Map();
for (const invoice of invoices) {
  const values = invoicesByNumber.get(String(invoice.invoice_number)) ?? [];
  values.push(invoice);
  invoicesByNumber.set(String(invoice.invoice_number), values);
}
function invoiceByNumber(number) {
  const candidates = invoicesByNumber.get(String(number)) ?? [];
  if (candidates.length !== 1) {
    throw new Error(`Invoice #${number} resolved to ${candidates.length} rows.`);
  }
  return candidates[0];
}

const paymentsByInvoiceAndNumber = new Map();
for (const event of paymentEvents) {
  paymentsByInvoiceAndNumber.set(
    `${event.customer_invoice_id}|${event.payment_number ?? ""}`,
    event,
  );
}
const existingByTransactionInvoice = new Map();
const transactionAllocated = new Map();
const invoiceApplied = new Map();
const incorrectLauraTransactionId = "c5e8fab5-7273-471b-86e6-40f662294f13";
const incorrectLauraInvoiceId = invoiceByNumber("392456").id;
const reversalPlan = [];
for (const allocation of existingAllocations) {
  if (
    allocation.financial_transaction_id === incorrectLauraTransactionId &&
    allocation.customer_invoice_id === incorrectLauraInvoiceId
  ) {
    reversalPlan.push({
      id: allocation.id,
      reason:
        "Replaced after Interac email proved the $400 deposit references DripJobs proposal 2666986 / invoice #412922, not invoice #392456.",
    });
    continue;
  }
  existingByTransactionInvoice.set(
    `${allocation.financial_transaction_id}|${allocation.customer_invoice_id}`,
    allocation,
  );
  transactionAllocated.set(
    allocation.financial_transaction_id,
    (transactionAllocated.get(allocation.financial_transaction_id) ?? 0) + cents(allocation.allocated_amount),
  );
  invoiceApplied.set(
    allocation.customer_invoice_id,
    (invoiceApplied.get(allocation.customer_invoice_id) ?? 0) + cents(allocation.invoice_applied_amount),
  );
}

const allocationPlan = [];
const transactionUpdates = new Map();
const seenInteracCodes = new Set();

function planAllocation(transaction, spec, methods, note) {
  const invoice = invoiceByNumber(spec.invoice);
  const existing = existingByTransactionInvoice.get(`${transaction.id}|${invoice.id}`);
  if (existing) return;

  const bankRemaining = cents(transaction.amount) - (transactionAllocated.get(transaction.id) ?? 0);
  const invoiceRemaining = cents(invoice.total_amount) - (invoiceApplied.get(invoice.id) ?? 0);
  const cash = spec.cash ?? Math.min(bankRemaining, invoiceRemaining);
  const applied = spec.applied ?? cash;
  if (cash <= 0 || applied <= 0) return;
  if (cash > bankRemaining) {
    throw new Error(`Allocation exceeds bank row ${transaction.id}.`);
  }
  if (applied > invoiceRemaining) {
    throw new Error(`Allocation exceeds invoice #${spec.invoice}.`);
  }

  let sourcePaymentEventId = null;
  if (spec.payment) {
    const event = paymentsByInvoiceAndNumber.get(`${invoice.id}|${spec.payment}`);
    if (!event) throw new Error(`Payment #${spec.payment} was not found for invoice #${spec.invoice}.`);
    sourcePaymentEventId = event.id;
  }

  allocationPlan.push({
    financial_transaction_id: transaction.id,
    customer_invoice_id: invoice.id,
    source_payment_event_id: sourcePaymentEventId,
    allocated_amount: money(cash),
    invoice_applied_amount: money(applied),
    match_method: methods,
    confidence: "confirmed",
    evidence_note: note,
  });
  transactionAllocated.set(transaction.id, (transactionAllocated.get(transaction.id) ?? 0) + cash);
  invoiceApplied.set(invoice.id, (invoiceApplied.get(invoice.id) ?? 0) + applied);
}

for (const row of evidence.interac) {
  const transaction = transactionById.get(row.financial_transaction_id);
  if (!transaction) throw new Error(`Missing Interac bank row ${row.financial_transaction_id}.`);
  if (cents(transaction.amount) !== cents(row.bank_amount)) {
    throw new Error(`Interac evidence amount changed for ${transaction.id}.`);
  }
  seenInteracCodes.add(row.bank_reference_suffix);
  const identity = {
    status: "confirmed",
    provider: "interac",
    sender_name: row.sender_name,
    reference: row.interac_reference,
    bank_reference_suffix: row.bank_reference_suffix,
    transfer_message: row.transfer_message,
    gmail_message_id: row.gmail_message_id,
    email_received_on: row.email_received_on,
    verified_at: "2026-07-31T00:00:00-04:00",
  };
  const exception = interacExceptions[row.bank_reference_suffix] ?? null;
  transactionUpdates.set(transaction.id, {
    counterparty: titleCaseName(row.sender_name),
    identity,
    exception,
  });

  for (const spec of directInvoiceMap[row.bank_reference_suffix] ?? []) {
    planAllocation(
      transaction,
      spec,
      ["interac_confirmation", "reference_suffix", "sender_identity", "invoice_or_job_reference", "owner_authorized_2026_07_31"],
      `Interac ${row.interac_reference} from ${row.sender_name} for $${Number(row.bank_amount).toFixed(2)} posted ${row.posted_on}${row.transfer_message ? `; message: ${row.transfer_message}` : ""}. Linked to customer invoice #${spec.invoice}. Gmail message ${row.gmail_message_id}.`,
    );
  }
}

const classifiedCodes = new Set([
  ...Object.keys(directInvoiceMap),
  ...Object.keys(interacExceptions),
]);
const unclassifiedCodes = [...seenInteracCodes].filter((code) => !classifiedCodes.has(code));
if (unclassifiedCodes.length) {
  throw new Error(`Unclassified Interac evidence: ${unclassifiedCodes.join(", ")}`);
}

for (const spec of bankDepositMap) {
  const candidates = transactions.filter(
    (transaction) =>
      cents(transaction.amount) === spec.amount &&
      transaction.category === "Painting revenue" &&
      transaction.transaction_type === "income" &&
      /deposit/i.test(transaction.description),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Bank deposit for invoice #${spec.invoice} resolved to ${candidates.length} rows.`,
    );
  }
  const transaction = candidates[0];
  planAllocation(
    transaction,
    spec,
    [spec.provider, "exact_amount", "customer_identity", "owner_authorized_2026_07_31"],
    `${spec.provider.replaceAll("_", " ")} posted ${transaction.posted_on} linked to customer invoice #${spec.invoice} using exact amount and customer evidence.`,
  );
  transactionUpdates.set(transaction.id, {
    counterparty: invoiceByNumber(spec.invoice).customer_name,
    identity: {
      status: "confirmed",
      provider: spec.provider,
      invoice_number: spec.invoice,
      verified_at: "2026-07-31T00:00:00-04:00",
    },
    exception: null,
  });
}

function processorTransaction(spec) {
  const candidates = transactions.filter(
    (transaction) =>
      transaction.posted_on === spec.postedOn &&
      cents(transaction.amount) === spec.amount &&
      transaction.category === "Painting revenue" &&
      transaction.transaction_type === "income",
  );
  if (candidates.length !== 1) {
    throw new Error(`Processor row ${spec.postedOn} $${money(spec.amount)} resolved to ${candidates.length} rows.`);
  }
  return candidates[0];
}

for (const spec of stripeMatches) {
  const transaction = processorTransaction(spec);
  const cashTotal = spec.lines.reduce((total, line) => total + line.cash, 0);
  if (cashTotal !== spec.amount) throw new Error(`Stripe payout ${spec.payout} cash split is invalid.`);
  for (const line of spec.lines) {
    planAllocation(
      transaction,
      line,
      ["stripe_payout_confirmation", "stripe_payment_event", "gross_less_processor_fee", "owner_authorized_2026_07_31"],
      `Stripe payout ${spec.payout} posted ${spec.postedOn}. Customer invoice #${line.invoice} received gross credit $${money(line.applied).toFixed(2)}; Stripe withheld $${money(line.applied - line.cash).toFixed(2)} and deposited $${money(line.cash).toFixed(2)}.`,
    );
  }
  transactionUpdates.set(transaction.id, {
    counterparty: "Stripe",
    identity: {
      status: "confirmed",
      provider: "stripe",
      payout_id: spec.payout,
      gross_invoice_credit: money(spec.lines.reduce((total, line) => total + line.applied, 0)),
      processor_fee: money(spec.lines.reduce((total, line) => total + line.applied - line.cash, 0)),
      bank_cash: money(spec.amount),
      verified_at: "2026-07-31T00:00:00-04:00",
    },
    exception: null,
  });
}

for (const spec of unresolvedProcessorRows) {
  const transaction = processorTransaction(spec);
  transactionUpdates.set(transaction.id, {
    counterparty: spec.counterparty,
    identity: {
      status: "confirmed",
      provider: spec.counterparty === "Stripe" ? "stripe" : "unknown_processor",
      payout_id: spec.payout,
      bank_cash: money(spec.amount),
      verified_at: "2026-07-31T00:00:00-04:00",
    },
    exception: {
      kind: "processor_invoice_composition_missing",
      resolution: "Payout identity is confirmed, but the individual customer charges in this batch still need processor evidence.",
      review: true,
    },
  });
}

const correctedLauraTransaction = transactionById.get(incorrectLauraTransactionId);
if (!correctedLauraTransaction || reversalPlan.length > 1) {
  throw new Error(
    `Laura Van Cleef correction found ${reversalPlan.length} incorrect active allocations.`,
  );
}
planAllocation(
  correctedLauraTransaction,
  { invoice: "412922" },
  ["interac_confirmation", "proposal_reference", "corrected_prior_allocation", "owner_authorized_2026_07_31"],
  "Interac C1AMzRJkNj9x from Laura Van Cleef for $400.00 says deposit on proposal 2666986. Proposal 2666986 is customer invoice #412922. Gmail message 19d546ec8bcad9f9. The prior link to invoice #392456 is reversed.",
);
transactionUpdates.set(correctedLauraTransaction.id, {
  counterparty: "Laura Van Cleef",
  identity: {
    status: "confirmed",
    provider: "interac",
    sender_name: "LAURA VAN CLEEFF",
    reference: "C1AMzRJkNj9x",
    bank_reference_suffix: "j9x",
    transfer_message: "deposit on 2666986",
    gmail_message_id: "19d546ec8bcad9f9",
    email_received_on: "2026-04-03",
    verified_at: "2026-07-31T00:00:00-04:00",
  },
  exception: {
    kind: "rounding_overpayment",
    resolution: "$0.01 exceeds invoice #412922 after its prior payments.",
  },
});

const wiseReturnCandidates = transactions.filter(
  (transaction) =>
    transaction.posted_on === "2026-07-06" &&
    cents(transaction.amount) === 28612 &&
    transaction.transaction_type === "income" &&
    /10509213 CANADA MSP/i.test(transaction.description),
);
if (wiseReturnCandidates.length !== 1) {
  throw new Error(`Wise return resolved to ${wiseReturnCandidates.length} rows.`);
}
const wiseReturn = wiseReturnCandidates[0];

const unexplainedResiduals = [];
for (const [transactionId, update] of transactionUpdates) {
  const transaction = transactionById.get(transactionId);
  const residual = cents(transaction.amount) - (transactionAllocated.get(transactionId) ?? 0);
  if (residual > 0 && !update.exception) {
    unexplainedResiduals.push({
      transaction_id: transactionId,
      posted_on: transaction.posted_on,
      description: transaction.description,
      residual: money(residual),
    });
  }
}
if (unexplainedResiduals.length) {
  throw new Error(
    `Unexplained customer-revenue residuals: ${JSON.stringify(unexplainedResiduals)}`,
  );
}

const planSummary = {
  mode: APPLY ? "apply" : "dry-run",
  interac_evidence_rows: evidence.interac.length,
  interac_invoice_codes: Object.keys(directInvoiceMap).length,
  interac_exception_codes: Object.keys(interacExceptions).length,
  new_allocations: allocationPlan.length,
  reversed_incorrect_allocations: reversalPlan.length,
  new_bank_cash_allocated: money(allocationPlan.reduce((sum, row) => sum + cents(row.allocated_amount), 0)),
  new_invoice_credit: money(allocationPlan.reduce((sum, row) => sum + cents(row.invoice_applied_amount), 0)),
  processor_fee_recorded: money(allocationPlan.reduce((sum, row) => sum + cents(row.invoice_applied_amount) - cents(row.allocated_amount), 0)),
  transaction_identity_updates: transactionUpdates.size,
  unresolved_processor_rows: unresolvedProcessorRows.length,
  unexplained_residuals: unexplainedResiduals.length,
  wise_return_reclassification: wiseReturn.id,
};
console.log(JSON.stringify(planSummary, null, 2));
if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply after reviewing the plan.");
  process.exit(0);
}

for (const reversal of reversalPlan) {
  assertNoError(
    `customer allocation ${reversal.id} reversal`,
    await db.from("customer_invoice_bank_allocations").update({
      reversed_at: new Date().toISOString(),
      reversal_reason: reversal.reason,
    }).eq("id", reversal.id),
  );
}

if (allocationPlan.length) {
  for (let index = 0; index < allocationPlan.length; index += 100) {
    assertNoError(
      "customer allocation insert",
      await db.from("customer_invoice_bank_allocations").insert(allocationPlan.slice(index, index + 100)),
    );
  }
}

const now = new Date().toISOString();
const verificationRows = await fetchAll(() => db.from("customer_revenue_verification").select("*"));
const verificationByTransaction = new Map(
  verificationRows.map((row) => [row.financial_transaction_id, row]),
);
for (const [transactionId, update] of transactionUpdates) {
  const transaction = transactionById.get(transactionId);
  const sourceData = sourceObject(transaction.source_data);
  const verification = verificationByTransaction.get(transactionId);
  const exception = update.exception
    ? { status: "confirmed", ...update.exception, confirmed_at: now }
    : null;
  const fullyAllocated = verification?.payment_status === "fully_allocated";
  const settledException = exception && !exception.review;
  const result = await db.from("financial_transactions").update({
    counterparty: update.counterparty,
    review_status: fullyAllocated || settledException ? "reconciled" : "needs_review",
    source_data: {
      ...sourceData,
      customer_revenue_identity: update.identity,
      ...(exception ? { customer_revenue_exception: exception } : {}),
      customer_revenue_settlement: {
        status: verification?.payment_status ?? "unmatched",
        allocated_amount: Number(verification?.allocated_amount ?? 0),
        unallocated_amount: Number(verification?.unallocated_amount ?? transaction.amount),
        rule: "customer_invoice_bank_allocations_are_settlement_truth",
        updated_at: now,
      },
    },
  }).eq("id", transactionId);
  assertNoError(`transaction ${transactionId} evidence update`, result);
}

const wiseSource = sourceObject(wiseReturn.source_data);
assertNoError(
  "Wise return reclassification",
  await db.from("financial_transactions").update({
    counterparty: "Wise",
    category: "Virtual assistant salaries",
    review_status: "reconciled",
    notes: "Returned Wise transfer; offsets one failed/duplicated $286.12 outgoing payment to Ninutsia Gurashvili.",
    source_data: {
      ...wiseSource,
      customer_revenue_reclassification: {
        status: "confirmed",
        reason: "not_customer_revenue",
        evidence: "Gmail Wise transfer confirmation 19f0a8cc405205f9 for CAD 286.12 to Ninutsia Gurashvili.",
        confirmed_at: now,
      },
    },
  }).eq("id", wiseReturn.id),
);

const finalVerification = await fetchAll(() => db.from("customer_revenue_verification").select("*"));
const counts = finalVerification.reduce((output, row) => {
  output[row.payment_status] = (output[row.payment_status] ?? 0) + 1;
  return output;
}, {});
const activeAllocations = await fetchAll(() =>
  db.from("customer_invoice_bank_allocations").select(
    "allocated_amount,invoice_applied_amount,reversed_at",
  ).is("reversed_at", null),
);
console.log(JSON.stringify({
  applied: true,
  customer_revenue_status_counts: counts,
  active_bank_cash_allocated: money(activeAllocations.reduce((sum, row) => sum + cents(row.allocated_amount), 0)),
  active_invoice_credit: money(activeAllocations.reduce((sum, row) => sum + cents(row.invoice_applied_amount), 0)),
}, null, 2));
