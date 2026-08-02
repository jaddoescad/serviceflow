#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const YEAR = Number(process.argv.find((value) => /^20\d{2}$/.test(value)) ?? 2026);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

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
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
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
  throw new Error("Audit pagination exceeded 100,000 rows.");
}

function money(value) {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function sum(rows, field) {
  return money(rows.reduce((total, row) => total + Number(row[field] ?? 0), 0));
}

function searchableText(transaction) {
  return [
    transaction.description,
    transaction.counterparty,
    transaction.source_data?.merchant_name,
    transaction.source_data?.original_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-CA");
}

function vendorLabel(transaction) {
  const text = searchableText(transaction);
  if (/facebk|facebook|meta ads/.test(text)) return "Meta Ads";
  return transaction.counterparty || transaction.description || "Unknown";
}

function summarizeExpenses(rows) {
  return {
    rows: rows.length,
    before_hst: money(-sum(rows, "net_amount")),
    hst: money(-sum(rows, "tax_amount")),
    gross: money(-sum(rows, "amount")),
  };
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing audit for unexpected Supabase project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const start = `${YEAR}-01-01`;
const end = `${YEAR}-12-31`;

const [transactions, invoices, allocations, attributions, platformRows] = await Promise.all([
  fetchAll(() =>
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,tax_amount,net_amount,transaction_type,category,is_transfer,review_status,source_data",
      )
      .gte("posted_on", start)
      .lte("posted_on", end),
  ),
  fetchAll(() =>
    db
      .from("customer_invoices")
      .select(
        "id,invoice_number,companycam_project_id,external_proposal_id,external_proposal_uuid,invoice_date,subtotal,tax_amount,total_amount,source_paid_amount,source_balance,source_status,source_payload",
      )
      .gte("invoice_date", start)
      .lte("invoice_date", end),
  ),
  fetchAll(() =>
    db
      .from("customer_invoice_bank_allocations")
      .select(
        "financial_transaction_id,customer_invoice_id,allocated_amount,invoice_applied_amount,reversed_at",
      )
      .is("reversed_at", null),
  ),
  fetchAll(() =>
    db
      .from("customer_invoice_marketing_attribution")
      .select(
        "customer_invoice_id,invoice_date,normalized_channel,lead_created_at,booked_revenue_before_hst,bank_backed_revenue_before_hst",
      )
      .gte("invoice_date", start)
      .lte("invoice_date", end),
  ),
  fetchAll(() =>
    db
      .from("marketing_platform_performance")
      .select(
        "account_id,entity_level,entity_name,purpose,reporting_start,reporting_end,currency,results,amount_spent,source_filename,source_payload,captured_at",
      )
      .eq("platform", "meta")
      .gte("reporting_end", start)
      .lte("reporting_start", end),
  ),
]);

const expenses = transactions.filter(
  (row) => row.transaction_type !== "income" && !row.is_transfer,
);
const advertising = expenses.filter(
  (row) => row.category === "Advertising & marketing",
);
const metaByDescription = expenses.filter((row) =>
  /facebk|facebook|meta ads/.test(searchableText(row)),
);
const classifiedNonMeta = advertising.filter(
  (row) => !/facebk|facebook|meta ads/.test(searchableText(row)),
);
const metaOutsideAdvertising = metaByDescription.filter(
  (row) => row.category !== "Advertising & marketing",
);
const metaBeforeCurrentCampaign = metaByDescription.filter(
  (row) => row.posted_on < `${YEAR}-05-15`,
);
const metaDuringCurrentCampaign = metaByDescription.filter(
  (row) => row.posted_on >= `${YEAR}-05-15`,
);

const vendorGroups = Object.entries(Object.groupBy(advertising, vendorLabel))
  .map(([vendor, rows]) => ({ vendor, ...summarizeExpenses(rows) }))
  .sort((left, right) => right.before_hst - left.before_hst);
const monthlyMeta = Object.entries(
  Object.groupBy(metaByDescription, (row) => row.posted_on.slice(0, 7)),
)
  .map(([month, rows]) => ({ month, ...summarizeExpenses(rows) }))
  .sort((left, right) => left.month.localeCompare(right.month));

const paidSocialAttributions = attributions.filter(
  (row) => row.normalized_channel === "paid_social",
);
const apiPlatformRows = platformRows.filter((row) =>
  row.source_filename.startsWith("insights-"),
);
const latestCaptureByAccount = new Map();
for (const row of apiPlatformRows) {
  const latest = latestCaptureByAccount.get(row.account_id);
  if (!latest || row.captured_at > latest) {
    latestCaptureByAccount.set(row.account_id, row.captured_at);
  }
}
const latestCampaignRows = apiPlatformRows.filter(
  (row) =>
    row.entity_level === "campaign" &&
    row.captured_at === latestCaptureByAccount.get(row.account_id),
);
const platformAccounts = Object.entries(
  Object.groupBy(latestCampaignRows, (row) => row.account_id),
).map(([accountId, rows]) => ({
  account_id: accountId,
  account_name: rows[0].source_payload?.account_name ?? accountId,
  currency: rows[0].currency,
  captured_at: rows[0].captured_at,
  customer_acquisition: {
    spend: sum(
      rows.filter((row) => row.purpose === "customer_acquisition"),
      "amount_spent",
    ),
    results: sum(
      rows.filter((row) => row.purpose === "customer_acquisition"),
      "results",
    ),
  },
  recruiting: {
    spend: sum(
      rows.filter((row) => row.purpose === "recruiting"),
      "amount_spent",
    ),
    results: sum(
      rows.filter((row) => row.purpose === "recruiting"),
      "results",
    ),
  },
}));

const allocationByInvoice = new Map();
for (const allocation of allocations) {
  allocationByInvoice.set(
    allocation.customer_invoice_id,
    money(
      (allocationByInvoice.get(allocation.customer_invoice_id) ?? 0) +
        Number(allocation.invoice_applied_amount ?? 0),
    ),
  );
}

console.log(
  JSON.stringify(
    {
      project_ref: projectRef,
      year: YEAR,
      accounting_advertising: summarizeExpenses(advertising),
      meta_by_bank_description: summarizeExpenses(metaByDescription),
      meta_before_current_campaign: summarizeExpenses(metaBeforeCurrentCampaign),
      meta_during_current_campaign: summarizeExpenses(metaDuringCurrentCampaign),
      advertising_vendors: vendorGroups,
      monthly_meta_bank_spend: monthlyMeta,
      paid_social_customer_invoices: {
        count: paidSocialAttributions.length,
        booked_revenue_before_hst: sum(
          paidSocialAttributions,
          "booked_revenue_before_hst",
        ),
        bank_backed_revenue_before_hst: sum(
          paidSocialAttributions,
          "bank_backed_revenue_before_hst",
        ),
      },
      latest_meta_platform_report: {
        rows: latestCampaignRows.length,
        accounts: platformAccounts,
      },
      classified_advertising_but_not_meta: classifiedNonMeta.map((row) => ({
        id: row.id,
        posted_on: row.posted_on,
        counterparty: row.counterparty,
        description: row.description,
        category: row.category,
        amount: Number(row.amount),
      })),
      meta_description_outside_advertising: metaOutsideAdvertising.map((row) => ({
        id: row.id,
        posted_on: row.posted_on,
        counterparty: row.counterparty,
        description: row.description,
        category: row.category,
        amount: Number(row.amount),
      })),
      customer_invoices: {
        count: invoices.length,
        subtotal: sum(invoices, "subtotal"),
        total: sum(invoices, "total_amount"),
        source_paid: sum(invoices, "source_paid_amount"),
        bank_allocated: money(
          invoices.reduce(
            (total, invoice) => total + (allocationByInvoice.get(invoice.id) ?? 0),
            0,
          ),
        ),
        with_external_proposal_uuid: invoices.filter(
          (invoice) => invoice.external_proposal_uuid,
        ).length,
      },
    },
    null,
    2,
  ),
);
