#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CAPTURED_AT = "2026-08-20T16:40:00.000Z";
const OBSERVED_ON = "2026-08-20";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const sources = [
  {
    accountSlug: "td-chequing-6970",
    filePath: "/Users/jadslim/Downloads/accountactivity (3).csv",
    evidenceFilename: "TD EasyWeb Chequing 6970 downloaded 2026-08-20.csv",
  },
  {
    accountSlug: "td-visa-6650",
    filePath: "/Users/jadslim/Downloads/accountactivity (4).csv",
    evidenceFilename: "TD EasyWeb Visa 6650 downloaded 2026-08-20.csv",
  },
  {
    accountSlug: "td-visa-3660",
    filePath: "/Users/jadslim/Downloads/accountactivity (5).csv",
    evidenceFilename: "TD EasyWeb Visa 3660 downloaded 2026-08-20.csv",
  },
];

const accountSnapshots = {
  "td-chequing-6970": {
    current_balance_cents: 4_570_713,
    available_balance_cents: 4_570_713,
    pending_cents: null,
    note: "EasyWeb balance observed August 20 after three supplier e-Transfers, their fees, and a transfer to the business credit card; the CSV remains current only through the close of the previous business day, so today's posted rows are preserved from visible account activity.",
  },
  "td-investor-7861": {
    current_balance_cents: 0,
    available_balance_cents: 0,
    pending_cents: 0,
    note: "EasyWeb shows no transactions and a zero balance.",
  },
  "td-visa-6650": {
    current_balance_cents: 391_632,
    available_balance_cents: 231_800,
    pending_cents: 126_500,
    note: "EasyWeb shows a $1,265.00 pending Facebook charge; pending activity is excluded. Posted activity is imported from the current statement-period CSV.",
  },
  "td-visa-3660": {
    current_balance_cents: 0,
    available_balance_cents: 750_000,
    pending_cents: 0,
    note: "EasyWeb shows a zero balance and no pending activity. The August 14 payment is preserved from visible posted activity because recent payments may be absent from CSV downloads.",
  },
};

const visiblePostedRows = [
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-20",
    description: "SEND E-TFR FEE",
    amount_cents: -150,
    running_balance_cents: 4_570_713,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: "2026-08-20",
      related_transfer_confirmation_masked: "C1AaPn***RMY",
      related_recipient: "curb appeal softwash",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-20",
    description: "SEND E-TFR *RMY SUPP",
    amount_cents: -15_000,
    running_balance_cents: 4_570_863,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-20",
      status: "Autodeposited",
      recipient: "curb appeal softwash",
      recipient_registered_name: "MATTHEW L ARRIVEE",
      recipient_destination: "payments@curbappealprowash.ca",
      confirmation_masked: "C1AaPn***RMY",
      method: "Email/Mobile",
      message: "Curb Appeal invoice 1404",
      purpose: "SUPP - Supplier Payment",
      sent_by: "OTTAWA PAINTERS",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-20",
    description: "SEND E-TFR FEE",
    amount_cents: -150,
    running_balance_cents: 4_585_863,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: "2026-08-20",
      related_transfer_confirmation_masked: "C1Ay7p***HyZ",
      related_recipient: "Bilal akkacha",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-20",
    description: "SEND E-TFR *HyZ SUPP",
    amount_cents: -168_750,
    running_balance_cents: 4_586_013,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-20",
      status: "Autodeposited",
      recipient: "Bilal akkacha",
      recipient_registered_name: "bilalak",
      recipient_destination: "bilal.akkacha2@outlook.com",
      confirmation_masked: "C1Ay7p***HyZ",
      method: "Email/Mobile",
      message: "Fennec invoices 6, 7, 8",
      purpose: "SUPP - Supplier Payment",
      sent_by: "OTTAWA PAINTERS",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-20",
    description: "IJ295 TFR-TO C/C",
    amount_cents: -391_632,
    running_balance_cents: 4_754_763,
    evidence: {
      source: "TD EasyWeb visible posted activity and account overview",
      observed_on: "2026-08-20",
      destination: "Ottawa Painters business credit card",
      destination_account_last_four: "6650",
      reason: "The withdrawal exactly matches the visible $3,916.32 balance of the business card ending 6650.",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-20",
    description: "SEND E-TFR FEE",
    amount_cents: -150,
    running_balance_cents: 5_146_395,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: "2026-08-20",
      related_transfer_confirmation_masked: "CA***4Wd",
      related_recipient: "Michael Matambo",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-20",
    description: "SEND E-TFR *4Wd SUPP",
    amount_cents: -433_920,
    running_balance_cents: 5_146_545,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-20",
      status: "Deposited",
      recipient: "Michael Matambo",
      recipient_destination: "xdesign.ottawa@gmail.com",
      confirmation_masked: "CA***4Wd",
      method: "Email",
      message: "XDesign invoices 8611-8615",
      purpose: "SUPP - Supplier Payment",
      sent_by: "OTTAWA PAINTERS",
      deposited_on: "2026-08-20",
      cancellable_when_observed: false,
    },
  },
  {
    accountSlug: "td-visa-6650",
    posted_on: "2026-08-05",
    description: "PAYMENT - THANK YOU",
    amount_cents: 500_000,
    running_balance_cents: 348_368,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: "2026-08-06",
      reason:
        "EasyWeb shows the $5,000 payment as posted on August 5, but warns that recently posted payments may be omitted from the CSV download.",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR ***8WE",
    amount_cents: -50_000,
    running_balance_cents: 5_053_220,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-06",
      status: "Request deposited",
      recipient: "Jad Slim",
      recipient_destination: "Shakepay funding e-transfer address",
      confirmation_masked: "C1FBpG***8WE",
      method: "Accept Request",
      sent_by: "OTTAWA PAINTERS",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR FEE",
    amount_cents: -150,
    running_balance_cents: 5_103_220,
    evidence: { source: "TD EasyWeb visible posted activity", observed_on: "2026-08-06" },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR ***wJA",
    amount_cents: -83_620,
    running_balance_cents: 5_103_370,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-06",
      status: "Sent",
      recipient: "grutenco",
      recipient_destination: "hello@grutenco.ca",
      confirmation_masked: "CA***wJA",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
      cancellable_when_observed: true,
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR FEE",
    amount_cents: -150,
    running_balance_cents: 5_186_990,
    evidence: { source: "TD EasyWeb visible posted activity", observed_on: "2026-08-06" },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR ***GfG",
    amount_cents: -35_000,
    running_balance_cents: 5_187_140,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-06",
      status: "Autodeposited",
      recipient: "curb appeal softwash",
      recipient_destination: "payments@curbappealprowash.ca",
      confirmation_masked: "C1ArN2***GfG",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR FEE",
    amount_cents: -150,
    running_balance_cents: 5_222_140,
    evidence: { source: "TD EasyWeb visible posted activity", observed_on: "2026-08-06" },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR ***N2Q",
    amount_cents: -88_140,
    running_balance_cents: 5_222_290,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-06",
      status: "Sent",
      recipient: "Michael Matambo",
      recipient_destination: "xdesign.ottawa@gmail.com",
      confirmation_masked: "CA***N2Q",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
      cancellable_when_observed: true,
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR FEE",
    amount_cents: -150,
    running_balance_cents: 5_310_430,
    evidence: { source: "TD EasyWeb visible posted activity", observed_on: "2026-08-06" },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR ***fwu",
    amount_cents: -47_460,
    running_balance_cents: 5_310_580,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-06",
      status: "Sent",
      recipient: "Michael Matambo",
      recipient_destination: "xdesign.ottawa@gmail.com",
      confirmation_masked: "CA***fwu",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
      cancellable_when_observed: true,
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR ***9rR",
    amount_cents: -244_500,
    running_balance_cents: 5_358_040,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-06",
      status: "Autodeposited",
      recipient: "Bilal akkacha",
      recipient_destination: "bilal.akkacha2@outlook.com",
      confirmation_masked: "C1Afac***9rR",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-06",
    description: "SEND E-TFR ***Pud",
    amount_cents: -142_380,
    running_balance_cents: 5_602_540,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: "2026-08-06",
      status: "Sent",
      recipient: "Darlene",
      recipient_destination: "darlene@dressingrooms.ca",
      confirmation_masked: "CA***Pud",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
      cancellable_when_observed: true,
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-07-28",
    description: "SEND E-TFR ***GaR",
    amount_cents: -153_342,
    running_balance_cents: 5_084_432,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: OBSERVED_ON,
      status: "Deposited",
      date_sent: "2026-07-28",
      recipient: "elaine custkmer",
      recipient_destination: "elainekeveney@gmail.com",
      confirmation_masked: "CA***GaR",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
      reason: "Recipient identity is preserved, but the business purpose remains for review.",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-10",
    description: "SEND E-TFR ***qzd",
    amount_cents: -1_000_000,
    running_balance_cents: 4_566_149,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: OBSERVED_ON,
      status: "Autodeposited",
      date_sent: "2026-08-09",
      recipient: "Scott Madden",
      recipient_destination: "scott@caledonianpainting.ca",
      confirmation_masked: "C1AeYs***qzd",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-17",
    description: "E-TRANSFER ***k9J",
    amount_cents: 163_399,
    running_balance_cents: 6_033_893,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: OBSERVED_ON,
      reason: "Bank-dated August 17 deposit visible in EasyWeb but not yet included in the previous-business-day CSV download.",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-17",
    description: "E-TFR ***dFN EPAY",
    amount_cents: 91_153,
    running_balance_cents: 5_870_494,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: OBSERVED_ON,
      reason: "Bank-dated August 17 deposit visible in EasyWeb but not yet included in the previous-business-day CSV download.",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-17",
    description: "E-TRANSFER ***eJR",
    amount_cents: 114_610,
    running_balance_cents: 5_779_341,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: OBSERVED_ON,
      reason: "Bank-dated August 17 deposit visible in EasyWeb but not yet included in the previous-business-day CSV download.",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-17",
    description: "E-TFR ***wxT EPAY",
    amount_cents: 200_000,
    running_balance_cents: 5_664_731,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: OBSERVED_ON,
      reason: "Bank-dated August 17 deposit visible in EasyWeb but not yet included in the previous-business-day CSV download.",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-17",
    description: "SEND E-TFR *QaV SUPP",
    amount_cents: -95_352,
    running_balance_cents: 5_938_541,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: OBSERVED_ON,
      status: "Autodeposited",
      date_sent: "2026-08-17",
      recipient: "Scott Madden",
      recipient_destination: "scott@caledonianpainting.ca",
      message: "Caledonian invoice 239609 balance",
      confirmation_masked: "C1AjG8***QaV",
      purpose: "SUPP - Supplier Payment",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-17",
    description: "SEND E-TFR *WkE SUPP",
    amount_cents: -541_691,
    running_balance_cents: 5_396_700,
    evidence: {
      source: "TD EasyWeb visible posted activity and transfer detail",
      observed_on: OBSERVED_ON,
      status: "Deposited",
      date_sent: "2026-08-17",
      deposited_on: "2026-08-18",
      recipient: "grutenco",
      recipient_destination: "hello@grutenco.ca",
      message: "GT-INV-202608-01 + GT-INV-202608-02",
      confirmation_masked: "CA***WkE",
      purpose: "SUPP - Supplier Payment",
      method: "Email",
      sent_by: "OTTAWA PAINTERS",
    },
  },
  {
    accountSlug: "td-chequing-6970",
    posted_on: "2026-08-20",
    description: "E-TRANSFER ***uwW",
    amount_cents: 150_862,
    running_balance_cents: 5_580_465,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: OBSERVED_ON,
      reason: "Bank-dated August 20 deposit visible in EasyWeb but not yet included in the previous-business-day CSV download.",
    },
  },
  {
    accountSlug: "td-visa-6650",
    posted_on: "2026-08-14",
    description: "PAYMENT - THANK YOU",
    amount_cents: 708_475,
    running_balance_cents: 126_500,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: OBSERVED_ON,
      reason: "EasyWeb shows the payment as posted, but warns that recently posted payments may be omitted from CSV downloads.",
    },
  },
  {
    accountSlug: "td-visa-3660",
    posted_on: "2026-08-14",
    description: "PAYMENT - THANK YOU",
    amount_cents: 74_513,
    running_balance_cents: 0,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: OBSERVED_ON,
      reason: "EasyWeb shows the payment as posted, but warns that recently posted payments may be omitted from CSV downloads.",
    },
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
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim()));
}

function cents(value) {
  const text = String(value ?? "").trim().replace(/[$,]/g, "");
  if (!text) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount)) throw new Error(`Invalid money value ${value}.`);
  return Math.round(amount * 100);
}

function isoDate(value) {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Invalid EasyWeb date ${value}.`);
  return `${match[3]}-${match[1]}-${match[2]}`;
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

function normalizedDescription(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function classify(description, amountCents, accountType, evidence = {}) {
  const upper = description.toLocaleUpperCase("en-CA");
  const lower = description.toLocaleLowerCase("en-CA");
  const destination = `${evidence.recipient ?? ""} ${evidence.recipient_destination ?? ""}`
    .toLocaleLowerCase("en-CA");
  if (amountCents < 0 && (lower.includes("shakepay") || destination.includes("shakepay"))) {
    return {
      transaction_type: "expense",
      category: "Virtual assistant salaries",
      is_transfer: false,
      review_status: "reconciled",
      notes: "Ottawa Painters confirmed that payments to a Shakepay funding destination are virtual-assistant payments; no HST ITC is claimed.",
    };
  }
  if (accountType === "credit_card") {
    if (upper.includes("PAYMENT - THANK YOU")) {
      return {
        transaction_type: "transfer",
        category: "Credit card payment",
        is_transfer: true,
        review_status: "reconciled",
        notes: "Posted credit-card payment; no supplier invoice is required.",
      };
    }
    if (upper.includes("ANNUAL FEE") || upper.includes("OVERLIMIT FEE")) {
      return {
        transaction_type: amountCents > 0 ? "credit" : "expense",
        category: "Bank fees",
        is_transfer: false,
        review_status: "reconciled",
        notes: "Posted credit-card fee; the bank record is the supporting document.",
      };
    }
    const recurringRules = [
      ["facebook", ["facebk", "facebook"], "Advertising & marketing"],
      ["google workspace", ["workspace_pain", "google workspace"], "Software & subscriptions"],
      ["companycam", ["companycam"], "Software & subscriptions"],
      ["dripjobs", ["dripjobs"], "Software & subscriptions"],
      ["quo", ["openphone", "quo ("], "Phone & communication"],
      ["linkedin", ["linkedin"], "Professional subscriptions"],
      ["zapier", ["zapier"], "Software & subscriptions"],
      ["perspective software", ["perspective software"], "Software & subscriptions"],
      ["slack", ["slack"], "Software & subscriptions"],
      ["imperial pfs", ["imperial pfs"], "Insurance"],
    ];
    const recurring = recurringRules.find(([, terms]) =>
      terms.some((term) => lower.includes(term)),
    );
    if (recurring) {
      return {
        transaction_type: amountCents > 0 ? "credit" : "expense",
        category: recurring[2],
        is_transfer: false,
        review_status: "reconciled",
        notes: `${recurring[0]} recurring business charge verified by the posted card record; no HST ITC is claimed without a supplier tax document.`,
      };
    }
    if (
      lower.includes("sherwin") ||
      lower.includes("paint") ||
      lower.includes("home depot") ||
      lower.includes("rona") ||
      lower.includes("randalls")
    ) {
      return {
        transaction_type: amountCents > 0 ? "credit" : "expense",
        category: "Paint & materials",
        is_transfer: false,
        review_status: "needs_review",
        notes: "Posted material charge; supplier invoice and job allocation are required.",
      };
    }
    return {
      transaction_type: amountCents > 0 ? "credit" : "expense",
      category: "Uncategorized",
      is_transfer: false,
      review_status: "needs_review",
      notes: "Posted credit-card activity; category and source document require review.",
    };
  }

  if (upper.includes("TFR-TO C/C")) {
    return {
      transaction_type: "transfer",
      category: "Credit card payment",
      is_transfer: true,
      review_status: "reconciled",
      notes: "Transfer to an Ottawa Painters credit-card account; not a business expense.",
    };
  }
  if (
    upper.includes("SEND E-TFR FEE") ||
    upper.includes("MONTHLY PLAN FEE") ||
    upper.includes("SERVICE CHARGE")
  ) {
    return {
      transaction_type: "expense",
      category: "Bank fees",
      is_transfer: false,
      review_status: "reconciled",
      notes: "Posted bank fee; the bank record is the supporting document.",
    };
  }
  if (upper.includes("ACCT BAL REBATE")) {
    return {
      transaction_type: "credit",
      category: "Bank rebates",
      is_transfer: false,
      review_status: "reconciled",
      notes: "Posted account rebate; the bank record is the supporting document.",
    };
  }
  if (amountCents > 0) {
    return {
      transaction_type: "income",
      category: "Painting revenue",
      is_transfer: false,
      review_status: "needs_review",
      notes: "Posted bank deposit; customer revenue allocation requires exact evidence.",
    };
  }
  return {
    transaction_type: "expense",
    category: "Uncategorized",
    is_transfer: false,
    review_status: "needs_review",
    notes: "Posted bank withdrawal; recipient and invoice evidence require review.",
  };
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

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

for (const source of sources) {
  if (!existsSync(source.filePath)) throw new Error(`Missing EasyWeb CSV ${source.filePath}.`);
}

const [accounts, existingTransactions, existingDocuments] = await Promise.all([
  fetchAll(() =>
    db
      .from("accounts")
      .select(
        "id,slug,name,account_type,last_four,current_balance_cents,available_balance_cents,balance_as_of,updated_at",
      ),
  ),
  fetchAll(() =>
    db
      .from("transactions")
      .select("id,account_id,source_key,posted_on,transaction_on,description,amount_cents"),
  ),
  fetchAll(() => db.from("documents").select("id,content_sha256,metadata")),
]);
const accountBySlug = new Map(accounts.map((account) => [account.slug, account]));
for (const slug of Object.keys(accountSnapshots)) {
  if (!accountBySlug.has(slug)) throw new Error(`Database account ${slug} is missing.`);
}

const documents = [];
const parsedRows = [];
for (const source of sources) {
  const account = accountBySlug.get(source.accountSlug);
  const bytes = readFileSync(source.filePath);
  const contentHash = sha256(bytes);
  const values = parseCsv(bytes.toString("utf8"));
  const sourceRows = values.map((columns, index) => {
    if (columns.length !== 5) {
      throw new Error(`${source.evidenceFilename} row ${index + 1} has ${columns.length} columns.`);
    }
    const debitCents = cents(columns[2]);
    const creditCents = cents(columns[3]);
    if ((debitCents == null) === (creditCents == null)) {
      throw new Error(`${source.evidenceFilename} row ${index + 1} needs one debit or credit.`);
    }
    const postedOn = isoDate(columns[0]);
    const description = normalizedDescription(columns[1]);
    const amountCents = creditCents ?? -debitCents;
    const runningBalanceCents = cents(columns[4]);
    const sourceKey = sha256(
      `td-easyweb-v2:${source.accountSlug}:${postedOn}:${description}:${amountCents}:${runningBalanceCents}`,
    );
    return {
      account,
      source,
      rowNumber: index + 1,
      posted_on: postedOn,
      description,
      amount_cents: amountCents,
      running_balance_cents: runningBalanceCents,
      source_key: sourceKey,
      raw: columns,
      contentHash,
    };
  });
  const dates = sourceRows.map((row) => row.posted_on).sort();
  documents.push({
    id: stableUuid(`document:td-easyweb:${source.accountSlug}:${contentHash}`),
    kind: "bank_activity_csv",
    original_filename: source.evidenceFilename,
    mime_type: "text/csv",
    size_bytes: bytes.length,
    content_sha256: contentHash,
    storage_bucket: null,
    storage_path: null,
    source_url: "https://easyweb.td.com/",
    captured_at: CAPTURED_AT,
    metadata: {
      source: "TD EasyWeb direct CSV download",
      account_id: account.id,
      account_slug: source.accountSlug,
      period_start: dates[0],
      period_end: dates.at(-1),
      row_count: sourceRows.length,
      original_download_name: path.basename(source.filePath),
      raw_csv: bytes.toString("utf8"),
    },
  });
  parsedRows.push(...sourceRows);
}

const visibleEvidencePayload = JSON.stringify(visiblePostedRows);
const visibleEvidenceHash = sha256(visibleEvidencePayload);
const visibleDocument = {
  id: stableUuid(`document:td-easyweb:visible:${visibleEvidenceHash}`),
  kind: "bank_activity_observation",
  original_filename: `TD EasyWeb visible posted activity observed ${OBSERVED_ON}.json`,
  mime_type: "application/json",
  size_bytes: Buffer.byteLength(visibleEvidencePayload),
  content_sha256: visibleEvidenceHash,
  storage_bucket: null,
  storage_path: null,
  source_url: "https://easyweb.td.com/waw/webui/acct/#/",
  captured_at: CAPTURED_AT,
  metadata: {
    source: "TD EasyWeb visible posted activity",
    rows: visiblePostedRows,
  },
};
documents.push(visibleDocument);

const documentByAccountSlug = new Map(
  documents
    .filter((document) => document.kind === "bank_activity_csv")
    .map((document) => [document.metadata.account_slug, document]),
);
const maxExistingDateByAccount = new Map();
for (const account of accounts) {
  const dates = existingTransactions
    .filter((transaction) => transaction.account_id === account.id)
    .map((transaction) => transaction.posted_on)
    .sort();
  maxExistingDateByAccount.set(account.id, dates.at(-1) ?? null);
}
const existingSourceKeys = new Set(existingTransactions.map((row) => row.source_key));
const exactTransactionKey = (accountId, postedOn, description, amountCents) =>
  [accountId, postedOn, normalizedDescription(description), Number(amountCents)].join("|");
const transferReference = (description) =>
  normalizedDescription(description).match(/\*{3}([a-z0-9]{3})/i)?.[1]?.toUpperCase() ?? null;
const dayNumber = (value) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
const remainingExistingExactCounts = new Map();
for (const transaction of existingTransactions) {
  const key = exactTransactionKey(
    transaction.account_id,
    transaction.posted_on,
    transaction.description,
    transaction.amount_cents,
  );
  remainingExistingExactCounts.set(
    key,
    (remainingExistingExactCounts.get(key) ?? 0) + 1,
  );
}
const remainingExistingReferenceMatches = existingTransactions
  .map((transaction) => ({
    transaction,
    reference: transferReference(transaction.description),
  }))
  .filter((row) => row.reference);
const candidates = [];
for (const row of parsedRows) {
  const exactKey = exactTransactionKey(
    row.account.id,
    row.posted_on,
    row.description,
    row.amount_cents,
  );
  const existingExactCount = remainingExistingExactCounts.get(exactKey) ?? 0;
  if (existingSourceKeys.has(row.source_key) || existingExactCount > 0) {
    if (existingExactCount > 0) {
      remainingExistingExactCounts.set(exactKey, existingExactCount - 1);
    }
    continue;
  }
  const reference = transferReference(row.description);
  if (reference) {
    const referenceMatchIndex = remainingExistingReferenceMatches.findIndex(
      (existing) =>
        existing.reference === reference &&
        existing.transaction.account_id === row.account.id &&
        Number(existing.transaction.amount_cents) === row.amount_cents &&
        Math.abs(
          dayNumber(existing.transaction.posted_on) - dayNumber(row.posted_on),
        ) <= 1,
    );
    if (referenceMatchIndex >= 0) {
      remainingExistingReferenceMatches.splice(referenceMatchIndex, 1);
      continue;
    }
  }
  const observedEvidence = visiblePostedRows.find(
    (visible) =>
      visible.accountSlug === row.source.accountSlug &&
      visible.posted_on === row.posted_on &&
      visible.description === row.description &&
      visible.amount_cents === row.amount_cents,
  )?.evidence;
  const classification = classify(
    row.description,
    row.amount_cents,
    row.account.account_type,
    observedEvidence,
  );
  candidates.push({
    id: stableUuid(`transaction:${row.account.id}:${row.source_key}`),
    account_id: row.account.id,
    import_document_id: documentByAccountSlug.get(row.source.accountSlug).id,
    contact_id: null,
    source_key: row.source_key,
    posted_on: row.posted_on,
    transaction_on: row.posted_on,
    description: row.description,
    counterparty: observedEvidence?.recipient ?? null,
    amount_cents: row.amount_cents,
    tax_cents: 0,
    net_cents: row.amount_cents,
    currency: "CAD",
    ...classification,
    running_balance_cents: row.running_balance_cents,
    metadata: {
      ...(observedEvidence ?? {}),
      source: "td_easyweb_csv",
      source_document_sha256: row.contentHash,
      source_filename: row.source.evidenceFilename,
      source_row_number: row.rowNumber,
      raw_row: row.raw,
      pending: false,
      tax_evidence: { status: "unreviewed", tax_cents: 0 },
    },
    created_at: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  });
}

const remainingVisibleMatches = new Map();
for (const transaction of [...existingTransactions, ...candidates]) {
  const key = exactTransactionKey(
    transaction.account_id,
    transaction.posted_on,
    transaction.description,
    transaction.amount_cents,
  );
  remainingVisibleMatches.set(key, (remainingVisibleMatches.get(key) ?? 0) + 1);
}
for (const row of visiblePostedRows) {
  const account = accountBySlug.get(row.accountSlug);
  const sourceKey = sha256(
    `td-easyweb-visible:${row.accountSlug}:${row.posted_on}:${row.description}:${row.amount_cents}:${row.running_balance_cents}`,
  );
  const exactKey = exactTransactionKey(
    account.id,
    row.posted_on,
    row.description,
    row.amount_cents,
  );
  if (existingSourceKeys.has(sourceKey)) {
    const existingCount = remainingVisibleMatches.get(exactKey) ?? 0;
    if (existingCount > 0) remainingVisibleMatches.set(exactKey, existingCount - 1);
    continue;
  }
  const remainingMatchCount = remainingVisibleMatches.get(exactKey) ?? 0;
  if (remainingMatchCount > 0) {
    remainingVisibleMatches.set(exactKey, remainingMatchCount - 1);
    continue;
  }
  const classification = classify(
    row.description,
    row.amount_cents,
    account.account_type,
    row.evidence,
  );
  candidates.push({
    id: stableUuid(`transaction:${account.id}:${sourceKey}`),
    account_id: account.id,
    import_document_id: visibleDocument.id,
    contact_id: null,
    source_key: sourceKey,
    posted_on: row.posted_on,
    transaction_on: row.posted_on,
    description: row.description,
    counterparty: row.evidence?.recipient ?? null,
    amount_cents: row.amount_cents,
    tax_cents: 0,
    net_cents: row.amount_cents,
    currency: "CAD",
    ...classification,
    running_balance_cents: row.running_balance_cents,
    metadata: {
      ...row.evidence,
      source_document_sha256: visibleEvidenceHash,
      pending: false,
      tax_evidence: { status: "not_applicable", tax_cents: 0 },
    },
    created_at: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  });
}

const countsBy = (rows, key) =>
  Object.fromEntries(
    [...new Set(rows.map((row) => row[key]))]
      .map((value) => [value, rows.filter((row) => row[key] === value).length])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
const preview = {
  mode: APPLY ? "apply" : "dry-run",
  sourceDocuments: documents.map((document) => ({
    filename: document.original_filename,
    sha256: document.content_sha256,
    rowCount: document.metadata.row_count ?? document.metadata.rows?.length ?? 0,
  })),
  existingDocumentsMatched: documents.filter((document) =>
    existingDocuments.some((existing) => existing.content_sha256 === document.content_sha256),
  ).length,
  accountCutoffs: Object.fromEntries(
    accounts
      .filter((account) => accountSnapshots[account.slug])
      .map((account) => [account.slug, maxExistingDateByAccount.get(account.id)]),
  ),
  newTransactions: candidates.length,
  byAccount: Object.fromEntries(
    Object.keys(accountSnapshots).map((slug) => [
      slug,
      candidates.filter((row) => row.account_id === accountBySlug.get(slug).id).length,
    ]),
  ),
  byCategory: countsBy(candidates, "category"),
  byReviewStatus: countsBy(candidates, "review_status"),
  candidates: candidates.map((row) => ({
    account: accounts.find((account) => account.id === row.account_id).slug,
    date: row.posted_on,
    description: row.description,
    counterparty: row.counterparty,
    amount_cents: row.amount_cents,
    running_balance_cents: row.running_balance_cents,
    category: row.category,
    review_status: row.review_status,
  })),
  balanceSnapshots: accountSnapshots,
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

for (const document of documents) {
  const existing = existingDocuments.find(
    (item) => item.content_sha256 === document.content_sha256,
  );
  if (existing && existing.id !== document.id) {
    for (const candidate of candidates) {
      if (candidate.import_document_id === document.id) {
        candidate.import_document_id = existing.id;
      }
    }
    continue;
  }
  const result = await db
    .from("documents")
    .upsert(document, { onConflict: "id" })
    .select("id")
    .single();
  if (result.error) throw result.error;
}

let inserted = 0;
for (const candidate of candidates) {
  const result = await db.from("transactions").insert(candidate).select("id").single();
  if (result.error) throw result.error;
  inserted += 1;
}

for (const [slug, snapshot] of Object.entries(accountSnapshots)) {
  const account = accountBySlug.get(slug);
  const result = await db
    .from("accounts")
    .update({
      current_balance_cents: snapshot.current_balance_cents,
      available_balance_cents: snapshot.available_balance_cents,
      balance_as_of: CAPTURED_AT,
      updated_at: CAPTURED_AT,
    })
    .eq("id", account.id)
    .eq("updated_at", account.updated_at)
    .select("id")
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error(`Concurrent account update detected for ${slug}.`);
  const eventResult = await db.from("verification_events").upsert({
    id: stableUuid(`verification:account-balance:${account.id}:${CAPTURED_AT}`),
    entity_type: "account_balance",
    entity_id: account.id,
    action: "balance_observed",
    reason: snapshot.note,
    old_values: {
      current_balance_cents: account.current_balance_cents,
      available_balance_cents: account.available_balance_cents,
      balance_as_of: account.balance_as_of,
    },
    new_values: {
      current_balance_cents: snapshot.current_balance_cents,
      available_balance_cents: snapshot.available_balance_cents,
      pending_cents: snapshot.pending_cents,
      balance_as_of: CAPTURED_AT,
    },
    evidence: {
      source: "TD EasyWeb visible account activity",
      observed_on: OBSERVED_ON,
      note: snapshot.note,
    },
    occurred_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (eventResult.error) throw eventResult.error;
}

const insertedIds = candidates.map((row) => row.id);
const verificationResult = insertedIds.length
  ? await db.from("transactions").select("id").in("id", insertedIds)
  : { data: [], error: null };
if (verificationResult.error) throw verificationResult.error;
if ((verificationResult.data ?? []).length !== insertedIds.length) {
  throw new Error(
    `Verification failed: expected ${insertedIds.length} inserted transactions, found ${verificationResult.data?.length ?? 0}.`,
  );
}

console.log(
  JSON.stringify(
    {
      inserted,
      verifiedInserted: verificationResult.data?.length ?? 0,
      accountsUpdated: Object.keys(accountSnapshots).length,
      documentsPreserved: documents.length,
      status: "verified",
    },
    null,
    2,
  ),
);
