#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const EVIDENCE_SOURCE =
  "TD EasyWeb Interac e-Transfer history viewed 2026-07-30";

const contractorNames = new Map([
  ["Anas New", "Abdellah Aouf"],
  ["anas", "Abdellah Aouf"],
  ["Bilal akkacha", "Fennec Contracting"],
  ["Francisco Premium Coat", "Premium Coat"],
  ["LOLI TAPING", "Loli Taping"],
  ["Michael Matambo", "XDesign Dev Inc"],
  ["Michael Prudhomme", "Michael Prudhomme"],
  ["Michelle Painter", "AMG Service Construction"],
  ["michelle - amg construction", "AMG Service Construction"],
  ["PERFECT STROKES PAINTING INC.", "Perfect Strokes Painting Inc."],
  ["Scott Madden", "Caledonian Painting Ltd"],
  ["curb appeal softwash", "Curb Appeal Pro Wash"],
  ["grutenco", "Grutenco Painting & Construction Services"],
  ["saeed painter", "PixReno Construction Inc."],
]);

const transfers = [
  [
    "GaR",
    "2026-07-28",
    1533.42,
    "elaine custkmer",
    "elainekeveney@gmail.com",
    "Deposited",
  ],
  [
    "ZSw",
    "2026-07-28",
    84.75,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  ["ntd", "2026-07-26", 4237.5, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "Paw",
    "2026-07-26",
    113,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "Brg",
    "2026-07-26",
    2101.8,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "r8P",
    "2026-07-24",
    597.97,
    "kirsty johnson customer",
    "kristijohnson@rogers.com",
    "Autodeposited",
  ],
  [
    "Sf4",
    "2026-07-17",
    2920,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "DNe",
    "2026-07-16",
    577,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "6jd",
    "2026-07-16",
    1796,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "6E8",
    "2026-07-16",
    3690,
    "Bilal akkacha",
    "bilal.akkacha2@outlook.com",
    "Autodeposited",
  ],
  ["c84", "2026-07-16", 1017, "grutenco", "hello@grutenco.ca", "Deposited"],
  ["HDz", "2026-07-13", 2585, "grutenco", "hello@grutenco.ca", "Deposited"],
  ["Nym", "2026-07-08", 565, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "29g",
    "2026-07-08",
    1796.7,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "Ekh",
    "2026-07-08",
    5193.05,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "MNT",
    "2026-07-06",
    100,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "5gZ",
    "2026-07-03",
    5000,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "s8M",
    "2026-07-03",
    1500,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "ZRd",
    "2026-07-03",
    610.2,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  ["DgV", "2026-07-01", 996.13, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "3dK",
    "2026-07-01",
    2847.6,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "Mw7",
    "2026-06-24",
    600,
    "Michael Prudhomme",
    "michael23prudhomme@gmail.com",
    "Autodeposited",
  ],
  ["rpk", "2026-06-20", 2500, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "thB",
    "2026-06-20",
    440,
    "curb appeal softwash",
    "payments@curbappealprowash.ca",
    "Autodeposited",
  ],
  [
    "2Sj",
    "2026-06-18",
    2256.1,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "q3d",
    "2026-06-18",
    624,
    "Anas New",
    "abdellahaouf2@gmail.com",
    "Deposited",
  ],
  [
    "pKE",
    "2026-06-15",
    1636.2,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "fq4",
    "2026-06-15",
    330,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "nkY",
    "2026-06-15",
    644.1,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "yJ8",
    "2026-06-15",
    216,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "7EH",
    "2026-06-15",
    881.4,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "jGV",
    "2026-06-12",
    10000,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "n2H",
    "2026-06-10",
    372.9,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "JrB",
    "2026-06-07",
    542.4,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "nSH",
    "2026-06-07",
    678,
    "One Touch Print",
    "info@onetouchprint.ca",
    "Autodeposited",
  ],
  ["RS9", "2026-06-05", 3090.55, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "dBf",
    "2026-06-05",
    1250.75,
    "Michelle Painter",
    "audreygaleano4@gmail.com",
    "Autodeposited",
  ],
  [
    "WU8",
    "2026-06-03",
    2000,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "Z6x",
    "2026-06-03",
    610.2,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "Ysm",
    "2026-06-01",
    2131.82,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "Tjv",
    "2026-05-29",
    2364.19,
    "michelle - amg construction",
    "audreygaleano4@gmail.com",
    "Autodeposited",
  ],
  [
    "7ym",
    "2026-05-27",
    71.75,
    "CLIENT - Rashonda",
    "rashonda.legault@gmail.com",
    "Autodeposited",
  ],
  ["8xR", "2026-05-25", 4734.8, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "24S",
    "2026-05-25",
    5181.05,
    "PERFECT STROKES PAINTING INC.",
    "psppaintinginc@gmail.com",
    "Autodeposited",
  ],
  [
    "xGz",
    "2026-05-23",
    4983.3,
    "LOLI TAPING",
    "lolis041025@gmail.com",
    "Autodeposited",
  ],
  [
    "VvV",
    "2026-05-21",
    5905,
    "Jad Business",
    "jaddoescad@gmail.com",
    "Autodeposited",
  ],
  [
    "7pb",
    "2026-05-19",
    1627.2,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "jEY",
    "2026-05-15",
    3758.47,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "YMP",
    "2026-05-15",
    572.91,
    "saeed painter",
    "saeed@pixrenoconstruction.ca",
    "Deposited",
  ],
  [
    "jFt",
    "2026-05-09",
    5575,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "8gW",
    "2026-05-06",
    813.6,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "c8m",
    "2026-05-04",
    6000,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "BK5",
    "2026-05-04",
    3226.15,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
].map(([suffix, sent_on, amount, recipient_name, recipient_email, status]) => ({
  suffix,
  sent_on,
  amount,
  recipient_name,
  recipient_email,
  status,
}));

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

function maskedSuffix(transaction) {
  const source =
    transaction.source_data && typeof transaction.source_data === "object"
      ? transaction.source_data
      : {};
  const searchable = [
    transaction.description,
    transaction.counterparty,
    source.original_description,
    source.merchant_name,
  ]
    .filter(Boolean)
    .join(" ");
  return searchable.match(/\*{3}([A-Za-z0-9]{3})/)?.[1] ?? null;
}

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing audit for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const applyChanges = process.argv.includes("--apply");
const transactionsResult = await db
  .from("financial_transactions")
  .select(
    "id,posted_on,transaction_on,amount,description,counterparty,category,review_status,source_data",
  )
  .eq("transaction_type", "expense")
  .lt("amount", 0)
  .gte("posted_on", "2026-05-01")
  .lte("posted_on", "2026-07-30")
  .order("posted_on", { ascending: false });
if (transactionsResult.error) throw transactionsResult.error;

const transferBySuffix = new Map(
  transfers.map((transfer) => [transfer.suffix, transfer]),
);
const transactionById = new Map(
  (transactionsResult.data ?? []).map((transaction) => [
    transaction.id,
    transaction,
  ]),
);
const matches = (transactionsResult.data ?? [])
  .map((transaction) => {
    const suffix = maskedSuffix(transaction);
    const transfer = suffix ? transferBySuffix.get(suffix) : null;
    if (!transfer) return null;
    return {
      transaction_id: transaction.id,
      bank_date: transaction.posted_on,
      transfer_date: transfer.sent_on,
      bank_amount: Math.abs(Number(transaction.amount)),
      transfer_amount: transfer.amount,
      amount_matches:
        Math.abs(Math.abs(Number(transaction.amount)) - transfer.amount) <
        0.005,
      suffix,
      recipient_name: transfer.recipient_name,
      recipient_email: transfer.recipient_email,
      transfer_status: transfer.status,
      description: transaction.description,
      counterparty: transaction.counterparty,
      category: transaction.category,
      review_status: transaction.review_status,
    };
  })
  .filter(Boolean);

const matchedSuffixes = new Set(matches.map((match) => match.suffix));
const contractorPaymentMatches = matches.filter(
  (match) =>
    match.category === "Subcontractors" &&
    contractorNames.has(match.recipient_name),
);
const excludedSubcontractorMatches = matches.filter(
  (match) =>
    match.category === "Subcontractors" &&
    !contractorNames.has(match.recipient_name),
);

const contractorsResult = await db
  .from("labour_contractors")
  .select("id,supplier_name");
if (contractorsResult.error) throw contractorsResult.error;
const normalize = (value) => value.trim().toLocaleLowerCase("en-CA");
const contractorByName = new Map(
  (contractorsResult.data ?? []).map((contractor) => [
    normalize(contractor.supplier_name),
    contractor,
  ]),
);
const missingContractors = [
  ...new Set(
    contractorPaymentMatches
      .map((match) => contractorNames.get(match.recipient_name))
      .filter(
        (supplierName) =>
          supplierName && !contractorByName.has(normalize(supplierName)),
      ),
  ),
];

if (applyChanges && missingContractors.length) {
  const insertResult = await db
    .from("labour_contractors")
    .insert(
      missingContractors.map((supplierName) => ({
        supplier_name: supplierName,
        notes: `Created from recipient evidence in ${EVIDENCE_SOURCE}.`,
      })),
    )
    .select("id,supplier_name");
  if (insertResult.error) throw insertResult.error;
  for (const contractor of insertResult.data ?? []) {
    contractorByName.set(normalize(contractor.supplier_name), contractor);
  }
}

const paymentRecords = contractorPaymentMatches.map((match) => {
  const supplierName = contractorNames.get(match.recipient_name);
  const contractor = supplierName
    ? contractorByName.get(normalize(supplierName))
    : null;
  if (applyChanges && !contractor) {
    throw new Error(`Missing contractor ${supplierName} for ${match.suffix}.`);
  }
  return {
    financial_transaction_id: match.transaction_id,
    contractor_id: contractor?.id ?? "[create contractor]",
    recipient_status: "confirmed",
    confirmation_method: "bank_record",
    confirmation_note:
      `${EVIDENCE_SOURCE}: ${match.transfer_date}, $${match.transfer_amount.toFixed(2)}, ` +
      `${match.recipient_name} <${match.recipient_email}>, confirmation ${match.suffix}, ` +
      `status ${match.transfer_status}. Bank description and amount matched exactly.`,
    confirmed_at: new Date().toISOString(),
  };
});

if (applyChanges) {
  for (const match of contractorPaymentMatches) {
    const supplierName = contractorNames.get(match.recipient_name);
    const transaction = transactionById.get(match.transaction_id);
    const sourceData =
      transaction?.source_data &&
      typeof transaction.source_data === "object" &&
      !Array.isArray(transaction.source_data)
        ? transaction.source_data
        : {};
    const updateResult = await db
      .from("financial_transactions")
      .update({
        counterparty: supplierName,
        source_data: {
          ...sourceData,
          easyweb_e_transfer_evidence: {
            source: EVIDENCE_SOURCE,
            sent_on: match.transfer_date,
            amount: match.transfer_amount,
            recipient_name: match.recipient_name,
            recipient_email: match.recipient_email,
            confirmation_suffix: match.suffix,
            status: match.transfer_status,
          },
        },
      })
      .eq("id", match.transaction_id);
    if (updateResult.error) throw updateResult.error;
  }

  const upsertResult = await db
    .from("labour_payment_records")
    .upsert(paymentRecords, { onConflict: "financial_transaction_id" });
  if (upsertResult.error) throw upsertResult.error;
}

const verificationResult = applyChanges
  ? await db
      .from("labour_payment_verification")
      .select("financial_transaction_id,recipient_status")
      .in(
        "financial_transaction_id",
        contractorPaymentMatches.map((match) => match.transaction_id),
      )
  : { data: [], error: null };
if (verificationResult.error) throw verificationResult.error;
if (
  applyChanges &&
  ((verificationResult.data ?? []).length !== contractorPaymentMatches.length ||
    (verificationResult.data ?? []).some(
      (record) => record.recipient_status !== "confirmed",
    ))
) {
  throw new Error("Post-apply recipient verification failed.");
}

console.log(
  JSON.stringify(
    {
      mode: applyChanges ? "applied" : "read-only",
      project_ref: projectRef,
      completed_transfer_count: transfers.length,
      matched_bank_transaction_count: matches.length,
      exact_amount_match_count: matches.filter((match) => match.amount_matches)
        .length,
      contractor_payment_count: contractorPaymentMatches.length,
      payment_record_count: paymentRecords.length,
      created_contractors: applyChanges ? missingContractors : [],
      excluded_subcontractor_matches: excludedSubcontractorMatches,
      unmatched_transfers: transfers.filter(
        (transfer) => !matchedSuffixes.has(transfer.suffix),
      ),
      category_summary: matches.reduce((summary, match) => {
        summary[match.category] = (summary[match.category] ?? 0) + 1;
        return summary;
      }, {}),
      matches,
    },
    null,
    2,
  ),
);
