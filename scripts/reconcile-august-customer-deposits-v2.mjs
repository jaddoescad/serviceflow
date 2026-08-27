#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ACCOUNT_SLUG = "td-chequing-6970";
const ACCOUNT_LAST_FOUR = "6970";
const ACCOUNTING_CUTOFF = "2026-06-01";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

const payments = [
  {
    key: "tasha-thornton-494611-deposit",
    transactionId: "314d285b-3905-5f24-bd77-49ed88427282",
    postedOn: "2026-08-06",
    bankDescription: "E-TFR ***xvd CASH",
    amountCents: 22_459,
    customer: "Tasha Thornton",
    interacSender: "Tasha Thornton",
    invoiceNumber: "494611",
    dripjobsMessageId: "19fdc83837c2b585",
    interacMessageId: "19fd9a6e4b0930f2",
    dripjobsPaymentDate: "2026-08-07",
  },
  {
    key: "yasmin-jiwani-495042-deposit",
    transactionId: "010542f5-6766-566b-9a97-9638d3563b48",
    postedOn: "2026-08-07",
    bankDescription: "E-TRANSFER ***Kv7",
    amountCents: 49_126,
    customer: "Yasmin Jiwani",
    interacSender: "YASMIN JIWANI",
    invoiceNumber: "495042",
    dripjobsMessageId: "19febe308bc7dca5",
    interacMessageId: "19fde778d6cb10cf",
    dripjobsPaymentDate: "2026-08-10",
  },
  {
    key: "erin-zuber-495362-deposit",
    transactionId: "d38bf4d6-3aaf-5e57-a481-300e0fcc3d54",
    postedOn: "2026-08-07",
    bankDescription: "E-TRANSFER ***x8x",
    amountCents: 100_000,
    customer: "Erin zuber",
    interacSender: "ERIN E ZUBER",
    invoiceNumber: "495362",
    dripjobsMessageId: "19febe36910a616c",
    interacMessageId: "19fde1eb31576389",
    dripjobsPaymentDate: "2026-08-10",
  },
  {
    key: "christine-nasrallah-418136-deposit",
    transactionId: "39d5f19f-d0b2-530e-959c-d7fb1529c46c",
    postedOn: "2026-08-10",
    bankDescription: "E-TRANSFER ***Qks",
    amountCents: 81_643,
    customer: "Christine Nasrallah",
    interacSender: "CHRISTINE NASRALLAH",
    invoiceNumber: "418136",
    dripjobsMessageId: "19febd902cf82431",
    interacMessageId: "19fe6fc4fbd1a572",
    dripjobsPaymentDate: "2026-08-10",
  },
  {
    key: "mariel-mckenzie-496082-deposit",
    transactionId: "ab49f9e4-55ef-5bc2-a211-d1f85c6ee10d",
    postedOn: "2026-08-10",
    bankDescription: "E-TRANSFER ***SSg",
    amountCents: 224_927,
    customer: "Mariel McKenzie",
    interacSender: "MARIEL MCKENZIE",
    invoiceNumber: "496082",
    dripjobsMessageId: "19febd31083d66f8",
    interacMessageId: "19feb770abea7275",
    dripjobsPaymentDate: "2026-08-10",
  },
  {
    key: "sue-deluney-398827-balance",
    transactionId: "dd17477f-0af1-5531-b24f-98662e0ebd6f",
    postedOn: "2026-08-10",
    bankDescription: "E-TRANSFER ***vbf",
    amountCents: 288_884,
    customer: "Sue Deluney",
    interacSender: "SUZANNE E DELUNEY",
    invoiceNumber: "398827",
    dripjobsMessageId: "19febdb377447249",
    interacMessageId: "19fe1871fadc626a",
    dripjobsPaymentDate: "2026-08-10",
  },
  {
    key: "lesley-lesley-498237-deposit",
    transactionId: "d3a603a9-d008-5a04-a7ea-85c360097572",
    postedOn: "2026-08-12",
    bankDescription: "E-TRANSFER ***WBU",
    amountCents: 74_863,
    customer: "Lesley Lesley",
    interacSender: "Lesley Flansberry",
    invoiceNumber: "498237",
    dripjobsMessageId: "19ffb38aabc7e2a6",
    interacMessageId: "19ff7bf42af4c879",
    dripjobsPaymentDate: "2026-08-13",
  },
  {
    key: "sophie-bruyere-498183-deposit",
    transactionId: "7c24a9a9-08e0-5266-b207-3d21f5f32448",
    postedOn: "2026-08-12",
    bankDescription: "E-TRANSFER ***EpB",
    amountCents: 123_311,
    customer: "Sophie Bruyere",
    interacSender: "NICOLAS SEGUIN",
    invoiceNumber: "498183",
    dripjobsMessageId: "19ff7889dcc145a7",
    interacMessageId: "19ff774649be72ba",
    dripjobsPaymentDate: "2026-08-12",
  },
  {
    key: "jillian-letts-448952-balance",
    transactionId: "52d6402d-db63-510c-8f46-2198b0fa0098",
    postedOn: "2026-08-14",
    bankDescription: "E-TRANSFER ***rBn",
    amountCents: 108_951,
    customer: "Jillian Letts",
    interacSender: "JILLIAN Letts",
    invoiceNumber: "448952",
    dripjobsMessageId: "1a001a3d3a0cd955",
    interacMessageId: "1a00192d335c35cd",
    dripjobsPaymentDate: "2026-08-14",
  },
  {
    key: "barry-dollin-457013-balance",
    transactionId: "18b1ac07-1b1a-5c84-996e-9319ac8c1e9d",
    postedOn: "2026-08-14",
    bankDescription: "E-TRANSFER ***Nc3",
    amountCents: 481_635,
    customer: "Barry Dollin",
    interacSender: "BARRY DOLLIN",
    invoiceNumber: "457013",
    dripjobsMessageId: "1a00fd7d9272edf6",
    interacMessageId: "1a0026a86ede9f5c",
    dripjobsPaymentDate: "2026-08-17",
  },
  {
    key: "chris-casey-500186-deposit",
    transactionId: "e59af5b6-32db-54b3-acc1-b996357eba70",
    postedOn: "2026-08-17",
    bankDescription: "E-TRANSFER ***eJR",
    amountCents: 114_610,
    customer: "Chris Casey",
    interacSender: "CHRISTOPHER ANTHONY CASEY",
    invoiceNumber: "500186",
    dripjobsMessageId: "1a00fcd6b1dfe715",
    interacMessageId: "1a006a8c651ff8ec",
    dripjobsPaymentDate: "2026-08-17",
  },
  {
    key: "irene-roberts-470443-balance",
    transactionId: "a01e9692-e4b6-52d4-8d3e-c289719e7406",
    postedOn: "2026-08-17",
    bankDescription: "E-TRANSFER ***k9J",
    amountCents: 163_399,
    customer: "Irene Roberts",
    interacSender: "IRENE ROBERTS",
    invoiceNumber: "470443",
    dripjobsMessageId: "1a00fc85f67eea05",
    interacMessageId: "1a00c0e0fbe9ace8",
    dripjobsPaymentDate: "2026-08-17",
  },
  {
    key: "katharina-keet-501671-deposit",
    transactionId: "03e82491-c8c6-5008-949c-cf418985fa9f",
    postedOn: "2026-08-18",
    bankDescription: "E-TRANSFER ***5VQ",
    amountCents: 33_053,
    customer: "Katharina Keet",
    interacSender: "KATHARINA KEET",
    invoiceNumber: "501671",
    dripjobsMessageId: "1a016a288ddecd7d",
    interacMessageId: "1a01688050fbd268",
    dripjobsPaymentDate: "2026-08-18",
  },
  {
    key: "marc-leahy-484866-deposit",
    transactionId: "0abf8a69-7314-5de3-b7ac-e2aee30c160e",
    postedOn: "2026-08-07",
    bankDescription: "E-TRANSFER ***suB",
    amountCents: 52_460,
    customer: "Marc Leahy",
    interacSender: "MARC LEAHY",
    invoiceNumber: "484866",
    dripjobsMessageId: "19febe3f5baee106",
    interacMessageId: "19fdd7a1cbda9011",
    dripjobsPaymentDate: "2026-08-10",
    interacReference: "C1AHdcnWHsuB",
  },
  {
    key: "marc-leahy-484866-balance",
    transactionId: "70125ad5-708c-55df-a41f-1813ebb3335b",
    postedOn: "2026-08-14",
    bankDescription: "E-TRANSFER ***tpF",
    amountCents: 157_381,
    customer: "Marc Leahy",
    interacSender: "MARC LEAHY",
    invoiceNumber: "484866",
    dripjobsMessageId: "1a0007cb76e01174",
    interacMessageId: "1a0006e708a4c226",
    dripjobsPaymentDate: "2026-08-14",
    interacReference: "C1Aw92aZGtpF",
  },
  {
    key: "catherine-mcgerray-497472-deposit",
    transactionId: "bf4fa43f-5e6f-55ac-ad9b-048e6af607d2",
    postedOn: "2026-08-17",
    bankDescription: "E-TFR ***wxT EPAY",
    amountCents: 200_000,
    customer: "Catherine McGerray",
    interacSender: "Catherine McGerray",
    invoiceNumber: "497472",
    dripjobsMessageId: "1a00fcdfe87e989e",
    interacMessageId: "1a005e954075946b",
    dripjobsPaymentDate: "2026-08-17",
    interacReference: "C1AcDM7WvwxT",
  },
  {
    key: "catherine-mcgerray-497472-second-payment",
    transactionId: "f9244fa5-668a-5ac0-a901-33367204a171",
    postedOn: "2026-08-17",
    bankDescription: "E-TFR ***dFN EPAY",
    amountCents: 91_153,
    customer: "Catherine McGerray",
    interacSender: "Catherine McGerray",
    invoiceNumber: "497472",
    dripjobsMessageId: "1a00fc98cb33dc99",
    interacMessageId: "1a00be4573fefacd",
    dripjobsPaymentDate: "2026-08-17",
    interacReference: "C1AhHHcNvdFN",
  },
  {
    key: "erin-lee-493396-payment",
    transactionId: "526fa3ae-41f5-5171-9111-70ce21939458",
    postedOn: "2026-08-14",
    bankDescription: "E-TFR ***vgW EPAY",
    amountCents: 65_003,
    customer: "Erin Lee",
    interacSender: "Erin Lee",
    invoiceNumber: "493396",
    dripjobsMessageId: "1a000c87965d4f3b",
    interacMessageId: "1a000ac2058b70de",
    dripjobsPaymentDate: "2026-08-14",
    interacReference: "C1AKbdTFrvgW",
    allowIncompleteBankLinkage: true,
    additionalSourcePayment: {
      amountCents: 21_668,
      method: "Credit Card",
      paidOn: "2026-08-05",
      dripjobsMessageId: "19fd319a311f2fe5",
      receiptMessageId: "19fd319a215bf80e",
    },
  },
  {
    key: "kim-kim-492833-payment",
    transactionId: "92943d29-7e4e-5d14-b9ec-2bfc2fd98ab6",
    postedOn: "2026-08-10",
    bankDescription: "E-TRANSFER ***4D9",
    amountCents: 149_329,
    customer: "Kim Kim",
    interacSender: "KIMBERLEY HUTCHINSON",
    invoiceNumber: "492833",
    dripjobsMessageId: "19ff0bad7eef705f",
    interacMessageId: "19fed9af084789ba",
    dripjobsPaymentDate: "2026-08-11",
    interacReference: "C1AGTxqun4D9",
    allowIncompleteBankLinkage: true,
    additionalSourcePayment: {
      amountCents: 49_777,
      method: "Credit Card",
      paidOn: "2026-08-04",
      dripjobsMessageId: "19fcef0394919d30",
      receiptMessageId: "19fcef03ab48bce8",
    },
  },
  {
    key: "bronte-shay-455380-balance-and-tip",
    transactionId: "50a90fc4-18c1-5044-ab37-a2a3bd23b164",
    postedOn: "2026-08-14",
    bankDescription: "E-TFR ***MNh EPAY",
    bankAmountCents: 60_782,
    amountCents: 56_782,
    remainingNeedsReviewCents: 4_000,
    customer: "Bronte Shay",
    interacSender: "Bronte Shay",
    invoiceNumber: "455380",
    dripjobsMessageId: "1a0013b789909672",
    interacMessageId: "1a00140915dbc128",
    dripjobsPaymentDate: "2026-08-14",
    interacReference: "C1AhY6pacMNh",
    interacMessage: "Thanks for the work. $567.82 is for the work, and $40 is a tip for Camille and Alvaro! Please ensure it make its way to them :)",
  },
  {
    key: "phil-anido-436544-balance",
    transactionId: "bd57b3be-6239-533a-83c4-b8e57b056f30",
    postedOn: "2026-08-20",
    bankDescription: "E-TRANSFER ***uwW",
    amountCents: 150_862,
    customer: "Phil Anido",
    interacSender: "PHILIP J ANIDO",
    invoiceNumber: "436544",
    dripjobsMessageId: "1a01f5efe0a26b8f",
    interacMessageId: "1a01f3591fa183ab",
    dripjobsPaymentDate: "2026-08-20",
    interacReference: "C1AHKD4xruwW",
  },
  {
    key: "lesley-lesley-498237-balance",
    postedOn: "2026-08-20",
    bankDescription: "E-TRANSFER ***2zr",
    amountCents: 224_587,
    runningBalanceCents: 4_795_300,
    customer: "Lesley Lesley",
    interacSender: "Lesley Flansberry",
    invoiceNumber: "498237",
    dripjobsMessageId: "1a021058050437ce",
    interacMessageId: "1a020b7c2fae686c",
    dripjobsPaymentDate: "2026-08-20",
    interacReference: "CAgnR2zr",
    interacMessage: "Payment in full with immense gratitude- invoice 498237",
    visibleEasyWeb: true,
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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function active(rows) {
  const unique = new Map();
  for (const row of rows ?? []) {
    if (!row.reversed_at) unique.set(row.id, row);
  }
  return [...unique.values()];
}

function bankBacked(rows) {
  return active(rows).filter((row) => row.transaction_id);
}

function sum(rows, field = "amount_cents") {
  return (rows ?? []).reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function money(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function resultData(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(
  new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF,
  "Refusing reconciliation for an unexpected Supabase project.",
);
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const account = resultData(
  "account",
  await db.from("accounts").select("id,slug,name,last_four").eq("slug", ACCOUNT_SLUG).single(),
);
assert(account.last_four === ACCOUNT_LAST_FOUR, "TD chequing account identity changed.");

const visiblePayment = payments.find((payment) => payment.visibleEasyWeb);
const visibleEvidencePayload = JSON.stringify({
  account_slug: ACCOUNT_SLUG,
  observed_on: "2026-08-20",
  row: {
    posted_on: visiblePayment.postedOn,
    description: visiblePayment.bankDescription,
    amount_cents: visiblePayment.amountCents,
    running_balance_cents: visiblePayment.runningBalanceCents,
  },
  corroboration: {
    dripjobs_gmail_message_id: visiblePayment.dripjobsMessageId,
    interac_gmail_message_id: visiblePayment.interacMessageId,
    interac_reference: visiblePayment.interacReference,
    interac_message: visiblePayment.interacMessage,
  },
});
const visibleEvidenceHash = sha256(visibleEvidencePayload);
const visibleDocumentId = stableUuid(`document:td-easyweb:visible:${visibleEvidenceHash}`);
const visibleSourceKey = sha256(
  `td-easyweb-visible:${ACCOUNT_SLUG}:${visiblePayment.postedOn}:${visiblePayment.bankDescription}:${visiblePayment.amountCents}:${visiblePayment.runningBalanceCents}`,
);
visiblePayment.transactionId = stableUuid(`transaction:${account.id}:${visibleSourceKey}`);

const invoiceNumbers = [...new Set(payments.map((payment) => payment.invoiceNumber))];
const transactionIds = [...new Set(payments.map((payment) => payment.transactionId))];
const [jobRows, invoiceRows, transactionRows] = await Promise.all([
  resultData(
    "jobs",
    await db
      .from("jobs")
      .select("id,contact_id,name,status,started_on,completed_on,archived_at,metadata,updated_at")
      .in("metadata->job_amount_authority->>invoice_id", invoiceNumbers),
  ),
  resultData(
    "invoices",
    await db
      .from("invoices")
      .select("*,lines:invoice_lines(*),job_allocations:invoice_job_allocations(*),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*)")
      .in("invoice_number", invoiceNumbers),
  ),
  resultData(
    "transactions",
    await db
      .from("transactions")
      .select("*,account:accounts(slug,last_four),allocations:transaction_allocations(*)")
      .in("id", transactionIds),
  ),
]);

assert(jobRows.length === invoiceNumbers.length, `Expected ${invoiceNumbers.length} jobs, found ${jobRows.length}.`);
for (const invoiceNumber of invoiceNumbers) {
  assert(
    jobRows.filter((job) => job.metadata?.job_amount_authority?.invoice_id === invoiceNumber).length === 1,
    `Invoice #${invoiceNumber} does not have exactly one authoritative DripJobs job.`,
  );
  assert(
    invoiceRows.filter((invoice) => invoice.invoice_number === invoiceNumber).length <= 1,
    `Invoice #${invoiceNumber} has duplicate invoice records.`,
  );
}

const existingTransactionIds = new Set(transactionRows.map((transaction) => transaction.id));
for (const payment of payments.filter((row) => !row.visibleEasyWeb)) {
  assert(existingTransactionIds.has(payment.transactionId), `Missing bank transaction ${payment.transactionId}.`);
}
assert(
  existingTransactionIds.has(visiblePayment.transactionId) ||
    !transactionRows.some(
      (transaction) =>
        transaction.account_id === account.id &&
        transaction.posted_on === visiblePayment.postedOn &&
        transaction.description === visiblePayment.bankDescription &&
        Number(transaction.amount_cents) === visiblePayment.amountCents,
    ),
  "Lesley's visible EasyWeb deposit already exists under an unexpected transaction id.",
);

const invoicePlans = [];
for (const invoiceNumber of invoiceNumbers) {
  const job = jobRows.find((row) => row.metadata?.job_amount_authority?.invoice_id === invoiceNumber);
  const authority = job.metadata.job_amount_authority;
  const operational = job.metadata?.dripjobs_operational_authority ?? {};
  const existingInvoice = invoiceRows.find((row) => row.invoice_number === invoiceNumber) ?? null;
  const invoiceId = existingInvoice?.id ?? stableUuid(
    `invoice:dripjobs-jobs-list:${authority.proposal_id}:${invoiceNumber}`,
  );
  const invoicePayments = payments.filter((payment) => payment.invoiceNumber === invoiceNumber);
  const expectedAllocationIds = invoicePayments.map((payment) =>
    stableUuid(`transaction-allocation:${payment.key}:${payment.transactionId}:invoice:${invoiceId}`),
  );
  const priorPayments = bankBacked(existingInvoice?.payments).filter(
    (allocation) => !expectedAllocationIds.includes(allocation.id),
  );
  const priorPaidCents = sum(priorPayments);
  const plannedPaidCents = sum(invoicePayments, "amountCents");
  const bankBackedPaidCents = priorPaidCents + plannedPaidCents;
  const sourceOnlyPayments = invoicePayments
    .map((payment) => payment.additionalSourcePayment)
    .filter(Boolean);
  const sourceOnlyPaidCents = sum(sourceOnlyPayments, "amountCents");
  const subtotalCents = Number(authority.before_hst_cents);
  const taxCents = Number(authority.implied_hst_cents);
  const totalCents = Number(authority.gross_amount_cents);
  const authorityPaidCents = Number(authority.paid_cents);
  const expectedPaidCents = invoiceNumber === "498237" ? totalCents : authorityPaidCents;
  const allowIncompleteBankLinkage = invoicePayments.some((payment) => payment.allowIncompleteBankLinkage);
  const paidCents = allowIncompleteBankLinkage ? expectedPaidCents : bankBackedPaidCents;

  assert(job.name.toLowerCase().includes(invoicePayments[0].customer.split(" ")[0].toLowerCase()), `Job identity changed for invoice #${invoiceNumber}.`);
  assert(!(job.started_on && job.started_on < ACCOUNTING_CUTOFF), `Historical accounting lock applies to ${job.name}.`);
  assert(!(job.archived_at && !job.started_on && !job.completed_on), `Undated archived job is locked: ${job.name}.`);
  assert(subtotalCents + taxCents === totalCents, `Invoice #${invoiceNumber} authority does not add up.`);
  if (allowIncompleteBankLinkage) {
    assert(bankBackedPaidCents < expectedPaidCents, `Invoice #${invoiceNumber} no longer has incomplete bank linkage.`);
    assert(
      bankBackedPaidCents + sourceOnlyPaidCents === expectedPaidCents,
      `Invoice #${invoiceNumber} bank and credit-card source evidence do not equal DripJobs paid total.`,
    );
  } else {
    assert(
      bankBackedPaidCents === expectedPaidCents,
      `Invoice #${invoiceNumber} payment evidence totals ${bankBackedPaidCents}, expected ${expectedPaidCents}; prior=${JSON.stringify(priorPayments.map((row) => ({ id: row.id, amount_cents: row.amount_cents, invoice_id: row.invoice_id, counter_invoice_id: row.counter_invoice_id })))}.`,
    );
  }
  assert(paidCents <= totalCents, `Invoice #${invoiceNumber} would be overpaid.`);

  const currentLineTotalCents = sum(existingInvoice?.lines, "total_cents");
  if (existingInvoice) {
    assert(currentLineTotalCents === Number(existingInvoice.total_cents), `Invoice #${invoiceNumber} existing lines do not match its header.`);
    assert(
      existingInvoice.job_allocations?.filter((allocation) => allocation.job_id === job.id).length === 1,
      `Invoice #${invoiceNumber} does not have exactly one current job allocation.`,
    );
  }

  invoicePlans.push({
    invoiceNumber,
    invoiceId,
    job,
    authority,
    operational,
    existingInvoice,
    invoicePayments,
    expectedAllocationIds,
    priorPaidCents,
    bankBackedPaidCents,
    sourceOnlyPayments,
    sourceOnlyPaidCents,
    paidCents,
    balanceCents: totalCents - paidCents,
    subtotalCents,
    taxCents,
    totalCents,
    status: paidCents === totalCents ? "Paid" : "Partially Paid",
    issuedOn: operational.proposal_signed_on ?? invoicePayments[0].postedOn,
    currentLineTotalCents,
    lineAdjustmentSubtotalCents: existingInvoice ? subtotalCents - Number(existingInvoice.subtotal_cents) : 0,
    lineAdjustmentTaxCents: existingInvoice ? taxCents - Number(existingInvoice.tax_cents) : 0,
    lineAdjustmentTotalCents: existingInvoice ? totalCents - Number(existingInvoice.total_cents) : 0,
  });
}

for (const payment of payments) {
  const transaction = transactionRows.find((row) => row.id === payment.transactionId);
  if (!transaction && payment.visibleEasyWeb) continue;
  assert(transaction, `Missing transaction for ${payment.key}.`);
  assert(transaction.account?.slug === ACCOUNT_SLUG, `${payment.key} account changed.`);
  assert(transaction.posted_on === payment.postedOn, `${payment.key} posting date changed.`);
  assert(transaction.description === payment.bankDescription, `${payment.key} bank description changed.`);
  assert(Number(transaction.amount_cents) === (payment.bankAmountCents ?? payment.amountCents), `${payment.key} amount changed.`);
  const plan = invoicePlans.find((row) => row.invoiceNumber === payment.invoiceNumber);
  const allocationId = stableUuid(
    `transaction-allocation:${payment.key}:${payment.transactionId}:invoice:${plan.invoiceId}`,
  );
  const unexpectedAllocations = active(transaction.allocations).filter((row) => row.id !== allocationId);
  assert(unexpectedAllocations.length === 0, `${payment.key} has an unexpected active allocation.`);
}

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  source_evidence: {
    dripjobs_payment_emails: payments.length,
    interac_autodeposit_emails: payments.length,
    existing_bank_transactions: payments.filter((payment) => !payment.visibleEasyWeb).length,
    new_easyweb_transaction: {
      transaction_id: visiblePayment.transactionId,
      posted_on: visiblePayment.postedOn,
      description: visiblePayment.bankDescription,
      amount_cents: visiblePayment.amountCents,
      running_balance_cents: visiblePayment.runningBalanceCents,
    },
  },
  totals: {
    invoices: invoicePlans.length,
    payments: payments.length,
    allocated_cents: sum(payments, "amountCents"),
    bank_deposit_cents: payments.reduce((total, payment) => total + Number(payment.bankAmountCents ?? payment.amountCents), 0),
    new_invoices: invoicePlans.filter((plan) => !plan.existingInvoice).length,
    existing_invoices_updated: invoicePlans.filter((plan) => plan.existingInvoice).length,
    authoritative_amount_adjustments: invoicePlans.filter((plan) => plan.lineAdjustmentTotalCents !== 0).length,
  },
  invoices: invoicePlans.map((plan) => ({
    invoice_number: plan.invoiceNumber,
    customer: plan.job.name,
    proposal_id: plan.authority.proposal_id,
    invoice_id: plan.invoiceId,
    action: plan.existingInvoice ? "update" : "create",
    total_cents: plan.totalCents,
    prior_bank_paid_cents: plan.priorPaidCents,
    new_payment_cents: sum(plan.invoicePayments, "amountCents"),
    bank_backed_paid_cents: plan.bankBackedPaidCents,
    missing_bank_linkage_cents: plan.paidCents - plan.bankBackedPaidCents,
    unsettled_credit_card_gross_cents: plan.sourceOnlyPaidCents,
    credit_card_payment_events: plan.sourceOnlyPayments,
    paid_cents: plan.paidCents,
    balance_cents: plan.balanceCents,
    status: plan.status,
    amount_adjustment_cents: plan.lineAdjustmentTotalCents,
    payment_transactions: plan.invoicePayments.map((payment) => payment.transactionId),
  })),
};

console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

resultData(
  "EasyWeb evidence document",
  await db.from("documents").upsert({
    id: visibleDocumentId,
    kind: "bank_activity_observation",
    original_filename: "TD EasyWeb Lesley invoice 498237 deposit observed 2026-08-20.json",
    mime_type: "application/json",
    size_bytes: Buffer.byteLength(visibleEvidencePayload),
    content_sha256: visibleEvidenceHash,
    storage_bucket: null,
    storage_path: null,
    source_url: "https://easyweb.td.com/",
    captured_at: capturedAt,
    metadata: JSON.parse(visibleEvidencePayload),
    created_at: capturedAt,
  }, { onConflict: "id" }),
);

if (!existingTransactionIds.has(visiblePayment.transactionId)) {
  resultData(
    "Lesley EasyWeb transaction",
    await db.from("transactions").insert({
      id: visiblePayment.transactionId,
      account_id: account.id,
      import_document_id: visibleDocumentId,
      contact_id: null,
      source_key: visibleSourceKey,
      posted_on: visiblePayment.postedOn,
      transaction_on: visiblePayment.postedOn,
      description: visiblePayment.bankDescription,
      counterparty: visiblePayment.interacSender,
      amount_cents: visiblePayment.amountCents,
      tax_cents: 0,
      net_cents: visiblePayment.amountCents,
      currency: "CAD",
      transaction_type: "income",
      category: "Painting revenue",
      is_transfer: false,
      review_status: "needs_review",
      running_balance_cents: visiblePayment.runningBalanceCents,
      notes: `Posted customer deposit confirmed by EasyWeb, Interac, and DripJobs for invoice #${visiblePayment.invoiceNumber}.`,
      metadata: {
        source: "TD EasyWeb visible posted activity",
        observed_on: "2026-08-20",
        source_document_sha256: visibleEvidenceHash,
        pending: false,
        tax_evidence: { status: "not_applicable", tax_cents: 0 },
        dripjobs_gmail_message_id: visiblePayment.dripjobsMessageId,
        interac_gmail_message_id: visiblePayment.interacMessageId,
        interac_reference: visiblePayment.interacReference,
        interac_message: visiblePayment.interacMessage,
      },
      created_at: capturedAt,
      updated_at: capturedAt,
    }),
  );
}

for (const plan of invoicePlans) {
  const authorityMetadata = {
    proposal_id: plan.authority.proposal_id,
    invoice_number: plan.invoiceNumber,
    source_filename: plan.authority.source_filename,
    source_sha256: plan.authority.source_sha256,
    combined_source_sha256: plan.authority.combined_source_sha256,
    source_document_id: plan.authority.source_document_id,
    source_view: plan.authority.source_view,
    csv_row: plan.authority.csv_row,
    imported_at: plan.authority.imported_at,
    before_hst_cents: plan.subtotalCents,
    implied_hst_cents: plan.taxCents,
    gross_amount_cents: plan.totalCents,
  };
  const paymentMetadata = {
    as_of: capturedAt,
    total_cents: plan.totalCents,
    paid_cents: plan.paidCents,
    bank_backed_paid_cents: plan.bankBackedPaidCents,
    missing_bank_linkage_cents: plan.paidCents - plan.bankBackedPaidCents,
    unsettled_credit_card_gross_cents: plan.sourceOnlyPaidCents,
    credit_card_payment_events: plan.sourceOnlyPayments,
    balance_cents: plan.balanceCents,
    status: plan.status,
    transaction_ids: plan.invoicePayments.map((payment) => payment.transactionId),
    dripjobs_gmail_message_ids: plan.invoicePayments.map((payment) => payment.dripjobsMessageId),
    interac_gmail_message_ids: plan.invoicePayments.map((payment) => payment.interacMessageId),
  };

  if (!plan.existingInvoice) {
    resultData(
      `invoice #${plan.invoiceNumber}`,
      await db.from("invoices").upsert({
        id: plan.invoiceId,
        contact_id: plan.job.contact_id,
        direction: "receivable",
        category: "customer",
        source_system: "dripjobs",
        external_id: `jobs-list-invoice:${plan.invoiceNumber}`,
        invoice_number: plan.invoiceNumber,
        status: plan.status,
        issued_on: plan.issuedOn,
        due_on: null,
        currency: "CAD",
        subtotal_cents: plan.subtotalCents,
        tax_cents: plan.taxCents,
        total_cents: plan.totalCents,
        paid_cents: plan.paidCents,
        balance_cents: plan.balanceCents,
        metadata: {
          customer_name: plan.job.name,
          external_proposal_id: plan.authority.proposal_id,
          accounting_status: "active",
          dripjobs_jobs_list_authority: authorityMetadata,
          customer_payment_reconciliation: paymentMetadata,
        },
        created_at: capturedAt,
        updated_at: capturedAt,
      }, { onConflict: "id" }),
    );
    const lineId = stableUuid(`invoice-line:dripjobs-jobs-list:${plan.invoiceId}:1`);
    resultData(
      `invoice line #${plan.invoiceNumber}`,
      await db.from("invoice_lines").upsert({
        id: lineId,
        invoice_id: plan.invoiceId,
        line_number: 1,
        description: `Painting services — DripJobs proposal #${plan.authority.proposal_id}`,
        quantity: 1,
        unit: "job",
        unit_price_cents: plan.subtotalCents,
        subtotal_cents: plan.subtotalCents,
        tax_cents: plan.taxCents,
        total_cents: plan.totalCents,
        service_started_on: plan.job.started_on,
        service_ended_on: plan.job.completed_on,
        source_kind: "dripjobs_jobs_list_authority",
        metadata: { authority: authorityMetadata },
        created_at: capturedAt,
        updated_at: capturedAt,
      }, { onConflict: "id" }),
    );
    resultData(
      `job allocation #${plan.invoiceNumber}`,
      await db.from("invoice_job_allocations").upsert({
        id: stableUuid(`invoice-job-allocation:dripjobs-jobs-list:${plan.invoiceId}:${plan.job.id}`),
        invoice_id: plan.invoiceId,
        invoice_line_id: null,
        job_id: plan.job.id,
        subtotal_cents: plan.subtotalCents,
        tax_cents: plan.taxCents,
        total_cents: plan.totalCents,
        quantity: 1,
        minutes: null,
        allocation_method: "dripjobs_proposal_number_and_jobs_list_authority",
        confidence: 1,
        needs_review: false,
        metadata: { authority: authorityMetadata },
        created_at: capturedAt,
        updated_at: capturedAt,
      }, { onConflict: "id" }),
    );
  } else {
    if (plan.lineAdjustmentTotalCents !== 0) {
      const nextLineNumber = Math.max(...plan.existingInvoice.lines.map((line) => Number(line.line_number ?? 0)), 0) + 1;
      resultData(
        `authority adjustment line #${plan.invoiceNumber}`,
        await db.from("invoice_lines").upsert({
          id: stableUuid(`invoice-line:jobs-list-authority-adjustment:${plan.invoiceId}:${plan.authority.combined_source_sha256}`),
          invoice_id: plan.invoiceId,
          line_number: nextLineNumber,
          description: "DripJobs Jobs List authoritative contract amount adjustment",
          quantity: 1,
          unit: "adjustment",
          unit_price_cents: plan.lineAdjustmentSubtotalCents,
          subtotal_cents: plan.lineAdjustmentSubtotalCents,
          tax_cents: plan.lineAdjustmentTaxCents,
          total_cents: plan.lineAdjustmentTotalCents,
          service_started_on: plan.job.started_on,
          service_ended_on: plan.job.completed_on,
          source_kind: "dripjobs_jobs_list_adjustment",
          metadata: {
            authority: authorityMetadata,
            previous_invoice_total_cents: Number(plan.existingInvoice.total_cents),
          },
          created_at: capturedAt,
          updated_at: capturedAt,
        }, { onConflict: "id" }),
      );
    }
    const jobAllocation = plan.existingInvoice.job_allocations.find(
      (allocation) => allocation.job_id === plan.job.id,
    );
    resultData(
      `refresh job allocation #${plan.invoiceNumber}`,
      await db.from("invoice_job_allocations").update({
        subtotal_cents: plan.subtotalCents,
        tax_cents: plan.taxCents,
        total_cents: plan.totalCents,
        allocation_method: "dripjobs_proposal_number_and_jobs_list_authority",
        confidence: 1,
        needs_review: false,
        metadata: { ...(jobAllocation.metadata ?? {}), authority: authorityMetadata },
        updated_at: capturedAt,
      }).eq("id", jobAllocation.id),
    );
  }

  resultData(
    `invoice authority evidence #${plan.invoiceNumber}`,
    await db.from("evidence_links").upsert({
      id: stableUuid(`evidence-link:${plan.authority.source_document_id}:invoice:${plan.invoiceId}`),
      document_id: plan.authority.source_document_id,
      entity_type: "invoice",
      entity_id: plan.invoiceId,
      evidence_role: "invoice_amount_authority",
      metadata: authorityMetadata,
      created_at: capturedAt,
    }, { onConflict: "id" }),
  );

  for (const sourcePayment of plan.sourceOnlyPayments) {
    const sourcePaymentAllocationId = stableUuid(
      `transaction-allocation:dripjobs-credit-card-payment:${sourcePayment.dripjobsMessageId}:invoice:${plan.invoiceId}`,
    );
    resultData(
      `credit-card payment event #${plan.invoiceNumber}`,
      await db.from("transaction_allocations").upsert({
        id: sourcePaymentAllocationId,
        transaction_id: null,
        invoice_id: plan.invoiceId,
        counter_invoice_id: null,
        job_id: plan.job.id,
        contact_id: plan.job.contact_id,
        source_system: "dripjobs",
        external_id: sourcePayment.dripjobsMessageId,
        allocation_type: "customer_payment_event",
        amount_cents: sourcePayment.amountCents,
        allocation_method: "dripjobs_credit_card_payment_email",
        confidence: 1,
        needs_review: false,
        reversed_at: null,
        reversal_reason: null,
        metadata: {
          invoice_number: plan.invoiceNumber,
          proposal_id: plan.authority.proposal_id,
          payment_method: sourcePayment.method,
          paid_on: sourcePayment.paidOn,
          dripjobs_gmail_message_id: sourcePayment.dripjobsMessageId,
          customer_receipt_gmail_message_id: sourcePayment.receiptMessageId,
          bank_settlement_status: "pending_stripe_payout_mapping",
        },
        created_at: active(plan.existingInvoice?.payments).find((row) => row.id === sourcePaymentAllocationId)?.created_at ?? capturedAt,
        updated_at: capturedAt,
      }, { onConflict: "id" }),
    );
    resultData(
      `credit-card verification #${plan.invoiceNumber}`,
      await db.from("verification_events").upsert({
        id: stableUuid(`verification:dripjobs-credit-card-payment:${sourcePayment.dripjobsMessageId}:${plan.invoiceId}`),
        entity_type: "transaction_allocation",
        entity_id: sourcePaymentAllocationId,
        action: "customer_credit_card_payment_event_recorded",
        reason: `DripJobs and the customer receipt confirm a ${money(sourcePayment.amountCents)} credit-card payment for invoice #${plan.invoiceNumber}; gross-to-net Stripe payout mapping remains pending.`,
        old_values: null,
        new_values: {
          invoice_id: plan.invoiceId,
          amount_cents: sourcePayment.amountCents,
          payment_method: sourcePayment.method,
          paid_on: sourcePayment.paidOn,
          bank_settlement_status: "pending_stripe_payout_mapping",
        },
        evidence: {
          dripjobs_gmail_message_id: sourcePayment.dripjobsMessageId,
          customer_receipt_gmail_message_id: sourcePayment.receiptMessageId,
          jobs_list_source_document_id: plan.authority.source_document_id,
        },
        performed_by: null,
        occurred_at: capturedAt,
      }, { onConflict: "id" }),
    );
  }

  const currentInvoiceMetadata = plan.existingInvoice?.metadata ?? {};
  const invoiceUpdate = await db.from("invoices").update({
    contact_id: plan.job.contact_id,
    status: plan.status,
    subtotal_cents: plan.subtotalCents,
    tax_cents: plan.taxCents,
    total_cents: plan.totalCents,
    paid_cents: plan.paidCents,
    balance_cents: plan.balanceCents,
    metadata: {
      ...currentInvoiceMetadata,
      dripjobs_jobs_list_authority: authorityMetadata,
      customer_payment_reconciliation: paymentMetadata,
    },
    updated_at: capturedAt,
  }).eq("id", plan.invoiceId)
    .eq("updated_at", plan.existingInvoice?.updated_at ?? capturedAt)
    .select("id")
    .maybeSingle();
  if (invoiceUpdate.error) throw invoiceUpdate.error;
  assert(invoiceUpdate.data, `Concurrent invoice update detected for #${plan.invoiceNumber}.`);

  const jobUpdate = await db.from("jobs").update({
    metadata: {
      ...(plan.job.metadata ?? {}),
      customer_receivable: {
        invoice_id: plan.invoiceId,
        invoice_number: plan.invoiceNumber,
        proposal_id: plan.authority.proposal_id,
        total_cents: plan.totalCents,
        paid_cents: plan.paidCents,
        bank_backed_paid_cents: plan.bankBackedPaidCents,
        missing_bank_linkage_cents: plan.paidCents - plan.bankBackedPaidCents,
        unsettled_credit_card_gross_cents: plan.sourceOnlyPaidCents,
        balance_cents: plan.balanceCents,
        status: plan.status,
        reconciled_at: capturedAt,
        evidence: {
          jobs_list_source_document_id: plan.authority.source_document_id,
          dripjobs_gmail_message_ids: plan.invoicePayments.map((payment) => payment.dripjobsMessageId),
          interac_gmail_message_ids: plan.invoicePayments.map((payment) => payment.interacMessageId),
          credit_card_payment_gmail_message_ids: plan.sourceOnlyPayments.map((payment) => payment.dripjobsMessageId),
        },
      },
    },
    updated_at: capturedAt,
  }).eq("id", plan.job.id).eq("updated_at", plan.job.updated_at).select("id").maybeSingle();
  if (jobUpdate.error) throw jobUpdate.error;
  assert(jobUpdate.data, `Concurrent job update detected for #${plan.invoiceNumber}.`);
}

for (const payment of payments) {
  const plan = invoicePlans.find((row) => row.invoiceNumber === payment.invoiceNumber);
  const allocationId = stableUuid(
    `transaction-allocation:${payment.key}:${payment.transactionId}:invoice:${plan.invoiceId}`,
  );
  const priorTransaction = transactionRows.find((row) => row.id === payment.transactionId);
  const transactionMetadata = priorTransaction?.metadata ?? {
    source: "TD EasyWeb visible posted activity",
    source_document_sha256: visibleEvidenceHash,
    observed_on: "2026-08-20",
  };
  const bankAmountCents = Number(payment.bankAmountCents ?? payment.amountCents);
  const remainingNeedsReviewCents = bankAmountCents - payment.amountCents;
  assert(
    remainingNeedsReviewCents === Number(payment.remainingNeedsReviewCents ?? 0),
    `${payment.key} remaining review amount changed.`,
  );
  const transactionReviewStatus = remainingNeedsReviewCents > 0 ? "needs_review" : "reconciled";
  resultData(
    `customer payment allocation ${payment.key}`,
    await db.from("transaction_allocations").upsert({
      id: allocationId,
      transaction_id: payment.transactionId,
      invoice_id: plan.invoiceId,
      counter_invoice_id: null,
      job_id: plan.job.id,
      contact_id: plan.job.contact_id,
      source_system: "dripjobs",
      external_id: `${payment.dripjobsMessageId}:${payment.invoiceNumber}`,
      allocation_type: "customer_payment",
      amount_cents: payment.amountCents,
      allocation_method: "td_easyweb_posted_transaction,interac_autodeposit_email,dripjobs_invoice_payment_email,exact_amount",
      confidence: 1,
      needs_review: false,
      reversed_at: null,
      reversal_reason: null,
      metadata: {
        invoice_number: payment.invoiceNumber,
        proposal_id: plan.authority.proposal_id,
        customer: payment.customer,
        interac_sender: payment.interacSender,
        interac_reference: payment.interacReference ?? null,
        interac_message: payment.interacMessage ?? null,
        interac_gmail_message_id: payment.interacMessageId,
        dripjobs_gmail_message_id: payment.dripjobsMessageId,
        bank_posted_on: payment.postedOn,
        dripjobs_payment_date: payment.dripjobsPaymentDate,
        bank_description: payment.bankDescription,
        account_last_four: ACCOUNT_LAST_FOUR,
      },
      created_at: active(priorTransaction?.allocations).find((row) => row.id === allocationId)?.created_at ?? capturedAt,
      updated_at: capturedAt,
    }, { onConflict: "id" }),
  );

  const transactionUpdate = await db.from("transactions").update({
    contact_id: plan.job.contact_id,
    counterparty: payment.interacSender,
    category: "Painting revenue",
    review_status: transactionReviewStatus,
    notes: remainingNeedsReviewCents > 0
      ? `Allocated ${money(payment.amountCents)} to DripJobs invoice #${payment.invoiceNumber}; the remaining ${money(remainingNeedsReviewCents)} is an explicit crew tip for Camille and Alvaro and remains unallocated pending payout treatment.`
      : `Customer payment for DripJobs invoice #${payment.invoiceNumber}; EasyWeb deposit ${payment.bankDescription} matched to Interac and DripJobs emails for ${money(payment.amountCents)}.`,
    metadata: {
      ...transactionMetadata,
      settlement_confirmation: {
        status: remainingNeedsReviewCents > 0 ? "invoice_settled_tip_pending" : "settled",
        invoice_id: plan.invoiceId,
        invoice_number: payment.invoiceNumber,
        job_id: plan.job.id,
        allocation_id: allocationId,
        bank_amount_cents: bankAmountCents,
        allocated_cents: payment.amountCents,
        unallocated_cents: remainingNeedsReviewCents,
        interac_sender: payment.interacSender,
        interac_reference: payment.interacReference ?? null,
        interac_gmail_message_id: payment.interacMessageId,
        dripjobs_gmail_message_id: payment.dripjobsMessageId,
        method: "td_easyweb_posted_transaction,interac_autodeposit_email,dripjobs_invoice_payment_email,exact_amount",
        reconciled_at: capturedAt,
      },
    },
    updated_at: capturedAt,
  }).eq("id", payment.transactionId)
    .eq("updated_at", priorTransaction?.updated_at ?? capturedAt)
    .select("id")
    .maybeSingle();
  if (transactionUpdate.error) throw transactionUpdate.error;
  assert(transactionUpdate.data, `Concurrent transaction update detected for ${payment.key}.`);

  resultData(
    `verification ${payment.key}`,
    await db.from("verification_events").upsert({
      id: stableUuid(`verification:customer-payment:${payment.key}:${payment.transactionId}:${plan.invoiceId}`),
      entity_type: "transaction_allocation",
      entity_id: allocationId,
      action: "customer_invoice_payment_reconciled",
      reason: `TD EasyWeb posted ${payment.bankDescription} for ${money(bankAmountCents)}; Interac identifies ${payment.interacSender}; DripJobs identifies ${money(payment.amountCents)} for invoice #${payment.invoiceNumber}${remainingNeedsReviewCents > 0 ? ` and Interac identifies the remaining ${money(remainingNeedsReviewCents)} as a crew tip` : ""}.`,
      old_values: {
        transaction_review_status: priorTransaction?.review_status ?? null,
        invoice_paid_cents: plan.existingInvoice?.paid_cents ?? 0,
        invoice_balance_cents: plan.existingInvoice?.balance_cents ?? plan.totalCents,
      },
      new_values: {
        transaction_review_status: transactionReviewStatus,
        allocation_cents: payment.amountCents,
        unallocated_cents: remainingNeedsReviewCents,
        invoice_paid_cents: plan.paidCents,
        invoice_balance_cents: plan.balanceCents,
      },
      evidence: {
        account_last_four: ACCOUNT_LAST_FOUR,
        bank_posted_on: payment.postedOn,
        bank_description: payment.bankDescription,
        bank_amount_cents: bankAmountCents,
        bank_source_document_sha256: transactionMetadata.source_document_sha256 ?? null,
        interac_sender: payment.interacSender,
        interac_reference: payment.interacReference ?? null,
        interac_message: payment.interacMessage ?? null,
        interac_gmail_message_id: payment.interacMessageId,
        dripjobs_gmail_message_id: payment.dripjobsMessageId,
        dripjobs_invoice_number: payment.invoiceNumber,
        dripjobs_proposal_id: plan.authority.proposal_id,
        dripjobs_jobs_list_source_document_id: plan.authority.source_document_id,
        dripjobs_jobs_list_source_sha256: plan.authority.source_sha256,
      },
      performed_by: null,
      occurred_at: capturedAt,
    }, { onConflict: "id" }),
  );
}

const [verifiedInvoices, verifiedTransactions] = await Promise.all([
  resultData(
    "verified invoices",
    await db.from("invoices")
      .select("id,invoice_number,status,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,lines:invoice_lines(total_cents),job_allocations:invoice_job_allocations(job_id,subtotal_cents,tax_cents,total_cents,needs_review),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,needs_review,reversed_at)")
      .in("id", invoicePlans.map((plan) => plan.invoiceId)),
  ),
  resultData(
    "verified transactions",
    await db.from("transactions")
      .select("id,posted_on,description,amount_cents,counterparty,category,review_status,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at)")
      .in("id", transactionIds),
  ),
]);

for (const plan of invoicePlans) {
  const invoice = verifiedInvoices.find((row) => row.id === plan.invoiceId);
  assert(invoice, `Missing verified invoice #${plan.invoiceNumber}.`);
  assert(Number(invoice.subtotal_cents) === plan.subtotalCents, `Invoice #${plan.invoiceNumber} subtotal verification failed.`);
  assert(Number(invoice.tax_cents) === plan.taxCents, `Invoice #${plan.invoiceNumber} tax verification failed.`);
  assert(Number(invoice.total_cents) === plan.totalCents, `Invoice #${plan.invoiceNumber} total verification failed.`);
  assert(Number(invoice.paid_cents) === plan.paidCents, `Invoice #${plan.invoiceNumber} paid verification failed.`);
  assert(Number(invoice.balance_cents) === plan.balanceCents, `Invoice #${plan.invoiceNumber} balance verification failed.`);
  assert(sum(invoice.lines, "total_cents") === plan.totalCents, `Invoice #${plan.invoiceNumber} line verification failed.`);
  assert(invoice.job_allocations.length === 1, `Invoice #${plan.invoiceNumber} job allocation count verification failed.`);
  assert(Number(invoice.job_allocations[0].total_cents) === plan.totalCents, `Invoice #${plan.invoiceNumber} job allocation total verification failed.`);
  assert(sum(bankBacked(invoice.payments)) === plan.bankBackedPaidCents, `Invoice #${plan.invoiceNumber} bank-backed paid total verification failed.`);
  const expectedSourcePaymentIds = new Set(plan.sourceOnlyPayments.map((sourcePayment) => stableUuid(
    `transaction-allocation:dripjobs-credit-card-payment:${sourcePayment.dripjobsMessageId}:invoice:${plan.invoiceId}`,
  )));
  const verifiedSourcePaymentCents = sum(active(invoice.payments).filter((payment) => expectedSourcePaymentIds.has(payment.id)));
  assert(verifiedSourcePaymentCents === plan.sourceOnlyPaidCents, `Invoice #${plan.invoiceNumber} credit-card source payment verification failed.`);
}

for (const payment of payments) {
  const transaction = verifiedTransactions.find((row) => row.id === payment.transactionId);
  const expectedReviewStatus = Number(payment.remainingNeedsReviewCents ?? 0) > 0 ? "needs_review" : "reconciled";
  assert(transaction, `Missing verified transaction ${payment.key}.`);
  assert(transaction.review_status === expectedReviewStatus, `${payment.key} review status verification failed.`);
  assert(transaction.category === "Painting revenue", `${payment.key} category verification failed.`);
  assert(sum(active(transaction.allocations)) === payment.amountCents, `${payment.key} allocation verification failed.`);
}

console.log(JSON.stringify({
  status: "verified",
  invoices: verifiedInvoices.map((invoice) => ({
    invoice_number: invoice.invoice_number,
    total_cents: invoice.total_cents,
    paid_cents: invoice.paid_cents,
    balance_cents: invoice.balance_cents,
    status: invoice.status,
  })),
  transactions: verifiedTransactions.map((transaction) => ({
    posted_on: transaction.posted_on,
    description: transaction.description,
    amount_cents: transaction.amount_cents,
    counterparty: transaction.counterparty,
    review_status: transaction.review_status,
  })),
}, null, 2));
