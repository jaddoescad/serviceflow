#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

globalThis.WebSocket = WebSocket;
const { createClient } = await import("@supabase/supabase-js");

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
const supabaseUrl =
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [projectsResult, entriesResult, expensesResult, employeesResult] = await Promise.all([
  db
    .from("companycam_projects")
    .select(
      "companycam_id,name,street_address_1,street_address_2,city,state,postal_code,formatted_address,is_archived,is_lead,is_deleted,companycam_created_at,companycam_updated_at,raw",
    )
    .order("companycam_updated_at", { ascending: false, nullsFirst: false })
    .limit(1000),
  db
    .from("time_entries")
    .select(
      "id,companycam_project_id,project_name,project_address,user_id,user_name,started_at,ended_at,status",
    )
    .order("started_at", { ascending: false })
    .limit(5000),
  db
    .from("project_labour_expenses")
    .select(
      "id,companycam_project_id,worker_user_id,worker_name,supplier_name,invoice_number,invoice_date,amount_before_tax,tax_amount,notes",
    )
    .order("invoice_date", { ascending: false }),
  db
    .from("employee_profiles")
    .select("user_id,email,full_name,role,is_active")
    .order("full_name", { ascending: true, nullsFirst: false }),
]);

for (const [label, result] of Object.entries({
  projects: projectsResult,
  timeEntries: entriesResult,
  labourExpenses: expensesResult,
  employees: employeesResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const outputPath = path.resolve(repoRoot, "tmp/invoice-reconciliation/project-context.json");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  JSON.stringify(
    {
      project_ref: env.SUPABASE_PROJECT_REF ?? new URL(supabaseUrl).hostname.split(".")[0],
      exported_at: new Date().toISOString(),
      projects: projectsResult.data ?? [],
      time_entries: entriesResult.data ?? [],
      labour_expenses: expensesResult.data ?? [],
      employees: employeesResult.data ?? [],
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      outputPath,
      projects: projectsResult.data?.length ?? 0,
      timeEntries: entriesResult.data?.length ?? 0,
      labourExpenses: expensesResult.data?.length ?? 0,
      employees: employeesResult.data?.length ?? 0,
    },
    null,
    2,
  ),
);
