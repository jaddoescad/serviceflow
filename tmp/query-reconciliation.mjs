import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase credentials");
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoices, paymentRecords, allocations, contractors, imports, accounts] =
  await Promise.all([
    db
      .from("labour_invoices")
      .select("*")
      .or(
        "supplier_name.ilike.%Polaris%,supplier_name.ilike.%Painttastic%,supplier_name.ilike.%Marcelo%,supplier_name.ilike.%Prudhomme%,supplier_name.ilike.%AMG%,supplier_name.ilike.%Fennec%,supplier_name.ilike.%Grutenco%,invoice_number.eq.276606",
      )
      .order("invoice_date"),
    db
      .from("labour_payment_records")
      .select("*")
      .in("financial_transaction_id", [
        "b618bd08-cf00-4403-9a4b-53eb1fdd58c4",
        "9030c57f-2b73-4963-9844-8bf756113a6b",
        "d8015be6-2972-471d-a284-ca02a8117136",
        "b5a41b11-e61b-4ca8-a6af-0fe1f00bc537",
        "0a400bd8-0f3e-49c7-afea-e84225051d67",
        "3c852f1b-ccd5-43fc-9708-958fd6e12774",
        "bd8f903c-b121-49d0-8b8d-3580e9688ce0",
        "d6bc90f6-f0a4-4d2e-8fcc-6bacdb69eecd",
      ]),
    db
      .from("labour_payment_allocations")
      .select("*")
      .in("financial_transaction_id", [
        "b618bd08-cf00-4403-9a4b-53eb1fdd58c4",
        "9030c57f-2b73-4963-9844-8bf756113a6b",
        "d8015be6-2972-471d-a284-ca02a8117136",
        "b5a41b11-e61b-4ca8-a6af-0fe1f00bc537",
        "0a400bd8-0f3e-49c7-afea-e84225051d67",
        "3c852f1b-ccd5-43fc-9708-958fd6e12774",
        "bd8f903c-b121-49d0-8b8d-3580e9688ce0",
        "d6bc90f6-f0a4-4d2e-8fcc-6bacdb69eecd",
      ])
      .is("reversed_at", null),
    db.from("labour_contractors").select("*").order("supplier_name"),
    db.from("financial_imports").select("*").order("imported_at", { ascending: false }).limit(20),
    db.from("financial_accounts").select("*"),
  ]);
for (const [name, result] of Object.entries({
  invoices,
  paymentRecords,
  allocations,
  contractors,
  imports,
  accounts,
})) {
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
}

console.log(
  JSON.stringify(
    {
      invoices: invoices.data,
      paymentRecords: paymentRecords.data,
      allocations: allocations.data,
      contractors: contractors.data.filter((c) =>
        /Polaris|Painttastic|Marcelo|Prudhomme|AMG|Fennec|Grutenco|Phillip|Phil/i.test(
          c.supplier_name,
        ),
      ),
      imports: imports.data,
      accounts: accounts.data,
    },
    null,
    2,
  ),
);
