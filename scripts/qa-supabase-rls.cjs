#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

loadEnvFile(".env");
loadEnvFile(".env.local");

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;
const QA_EMAIL = process.env.QA_EMAIL;
const QA_PASSWORD = process.env.QA_PASSWORD;
const QA_OTHER_EMAIL = process.env.QA_OTHER_EMAIL;
const QA_OTHER_PASSWORD = process.env.QA_OTHER_PASSWORD;
const QA_PROJECT_ID = process.env.QA_DESTRUCTIVE_PROJECT_ID || "qa-web-smoke-project";

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  requireEnv();

  const owner = await signIn(QA_EMAIL, QA_PASSWORD);
  const other = await signIn(QA_OTHER_EMAIL, QA_OTHER_PASSWORD);
  const entries = await restSelect(owner.access_token, "time_entries", {
    select: "id,user_id,project_name,status,started_at",
    companycam_project_id: `eq.${QA_PROJECT_ID}`,
    user_id: `eq.${owner.user.id}`,
    order: "started_at.desc",
    limit: "1",
  });

  const entry = entries[0];
  if (!entry) {
    throw new Error(
      `No QA time entry found for ${QA_EMAIL} on ${QA_PROJECT_ID}. Run QA_ALLOW_DESTRUCTIVE=1 npm run qa:smoke:web first.`,
    );
  }

  const crossUserEntries = await restSelect(other.access_token, "time_entries", {
    select: "id,user_id,project_name,status,started_at",
    id: `eq.${entry.id}`,
  });

  if (crossUserEntries.length) {
    throw new Error("RLS select check failed: another QA user can read the owner's time entry.");
  }

  const crossUserProfiles = await restSelect(other.access_token, "employee_profiles", {
    select: "user_id,email,full_name,role,is_active",
    user_id: `eq.${owner.user.id}`,
  });

  if (crossUserProfiles.length) {
    throw new Error("RLS select check failed: another QA user can read the owner's employee profile.");
  }

  const crossUserAssignments = await restSelect(other.access_token, "project_assignments", {
    select: "id,user_id,companycam_project_id,status",
    user_id: `eq.${owner.user.id}`,
  });

  if (crossUserAssignments.length) {
    throw new Error("RLS select check failed: another QA user can read the owner's project assignments.");
  }

  const painterBudgets = await restSelect(other.access_token, "project_budgets", {
    select: "companycam_project_id,amount_including_tax,labour_allocation_percent",
    companycam_project_id: `eq.${QA_PROJECT_ID}`,
  });

  if (painterBudgets.length) {
    throw new Error("Budget RLS check failed: a painter can read raw project budget values.");
  }

  const painterPayRates = await restSelect(other.access_token, "employee_pay_rates", {
    select: "user_id,hourly_rate,effective_from",
    user_id: `eq.${owner.user.id}`,
  });

  if (painterPayRates.length) {
    throw new Error("Budget RLS check failed: a painter can read employee pay rates.");
  }

  const painterLabourExpenses = await restSelect(other.access_token, "project_labour_expenses", {
    select: "companycam_project_id,amount_before_tax,tax_amount",
    companycam_project_id: `eq.${QA_PROJECT_ID}`,
  });

  if (painterLabourExpenses.length) {
    throw new Error("Budget RLS check failed: a painter can read fixed labour expenses.");
  }

  const budgetProgressResponse = await restFetch(other.access_token, "rpc/get_project_budget_progress", {
    method: "POST",
    body: JSON.stringify({ requested_project_ids: [QA_PROJECT_ID] }),
  });
  const budgetProgress = await budgetProgressResponse.json().catch(() => []);
  if (!budgetProgressResponse.ok) {
    throw new Error(`Budget progress RPC failed for a painter: ${budgetProgressResponse.status}`);
  }

  const allowedBudgetProgressKeys = new Set([
    "companycam_project_id",
    "percent_used",
    "hours_used",
    "budget_status",
    "is_complete",
    "calculated_at",
  ]);
  for (const row of Array.isArray(budgetProgress) ? budgetProgress : []) {
    const leakedKeys = Object.keys(row).filter((key) => !allowedBudgetProgressKeys.has(key));
    if (leakedKeys.length) {
      throw new Error(`Budget progress RPC leaked unexpected fields: ${leakedKeys.join(", ")}`);
    }
  }

  const projectFeedResponse = await restFetch(other.access_token, "rpc/list_project_feed", {
    method: "POST",
    body: JSON.stringify({
      requested_page: 0,
      requested_page_size: 20,
      requested_search: "",
      requested_project_ids: null,
    }),
  });
  const projectFeed = await projectFeedResponse.json().catch(() => []);
  if (!projectFeedResponse.ok) {
    throw new Error(`Project feed RPC failed for a painter: ${projectFeedResponse.status}`);
  }
  if (!Array.isArray(projectFeed) || !projectFeed.length) {
    throw new Error("Project feed RPC returned no visible projects for a painter.");
  }

  const allowedProjectFeedKeys = new Set([
    "companycam_id",
    "name",
    "formatted_address",
    "city",
    "state",
    "postal_code",
    "is_archived",
    "is_deleted",
    "companycam_status",
    "is_lead",
    "last_synced_at",
    "companycam_updated_at",
    "budget_percent_used",
    "budget_hours_used",
    "budget_status",
    "budget_is_complete",
    "budget_calculated_at",
    "total_count",
  ]);
  for (const row of projectFeed) {
    const leakedKeys = Object.keys(row).filter((key) => !allowedProjectFeedKeys.has(key));
    if (leakedKeys.length) {
      throw new Error(`Project feed RPC leaked unexpected fields: ${leakedKeys.join(", ")}`);
    }
  }

  const crossUserTrackingStatus = await restSelect(other.access_token, "employee_tracking_status", {
    select: "user_id,last_location_at,tracking_mode",
    user_id: `eq.${owner.user.id}`,
  });

  if (crossUserTrackingStatus.length) {
    throw new Error("RLS select check failed: another painter can read the owner's tracking status.");
  }

  const crossUserLocationPoints = await restSelect(other.access_token, "employee_location_points", {
    select: "id,user_id,captured_at",
    user_id: `eq.${owner.user.id}`,
    limit: "1",
  });

  if (crossUserLocationPoints.length) {
    throw new Error("RLS select check failed: another painter can read the owner's location history.");
  }

  const spoofedLocationResponse = await restFetch(other.access_token, "employee_location_points", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      client_event_id: `rls-spoof-${Date.now()}`,
      user_id: owner.user.id,
      client_entry_id: "rls-spoof",
      latitude: 45.4215,
      longitude: -75.6972,
      tracking_mode: "unknown",
      event_type: "location",
      captured_at: new Date().toISOString(),
    }),
  });

  if (spoofedLocationResponse.ok) {
    const payload = await spoofedLocationResponse.json().catch(() => []);
    if (Array.isArray(payload) && payload.length) {
      throw new Error("RLS insert check failed: another painter inserted a location for the owner.");
    }
  } else if (![401, 403].includes(spoofedLocationResponse.status)) {
    throw new Error(`Unexpected location RLS insert response: ${spoofedLocationResponse.status}`);
  }

  const visibleProjects = await restSelect(other.access_token, "companycam_projects", {
    select: "companycam_id",
    limit: "1",
  });

  if (!visibleProjects.length) {
    throw new Error("RLS project visibility check failed: painters should still be able to read projects.");
  }

  const originalName = entry.project_name;
  const updateResponse = await restFetch(other.access_token, `time_entries?id=eq.${entry.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ project_name: "RLS SHOULD NOT UPDATE" }),
  });

  if (!updateResponse.ok) {
    if (![401, 403].includes(updateResponse.status)) {
      throw new Error(`Unexpected RLS update response: ${updateResponse.status}`);
    }
  } else {
    const payload = await updateResponse.json();
    if (Array.isArray(payload) && payload.length > 0) {
      throw new Error("RLS update check failed: another QA user updated the owner's time entry.");
    }
  }

  const [after] = await restSelect(owner.access_token, "time_entries", {
    select: "id,project_name",
    id: `eq.${entry.id}`,
  });

  if (!after || after.project_name !== originalName) {
    throw new Error("RLS update check failed: owner time entry changed unexpectedly.");
  }

  console.log("RLS checks passed: painters receive aggregate budget progress without raw financial or cross-user operational data.");
}

function requireEnv() {
  const missing = [];
  for (const [name, value] of Object.entries({
    SUPABASE_URL,
    SUPABASE_KEY,
    QA_EMAIL,
    QA_PASSWORD,
    QA_OTHER_EMAIL,
    QA_OTHER_PASSWORD,
  })) {
    if (!value) missing.push(name);
  }
  if (missing.length) throw new Error(`Missing QA RLS env values: ${missing.join(", ")}`);
}

async function signIn(email, password) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Sign-in failed for ${email}: ${payload.error_description || response.status}`);
  return payload;
}

async function restSelect(token, table, query) {
  const params = new URLSearchParams(query);
  const response = await restFetch(token, `${table}?${params.toString()}`);
  const payload = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`REST select failed for ${table}: ${response.status}`);
  return Array.isArray(payload) ? payload : [];
}

async function restFetch(token, pathName, options = {}) {
  return fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${pathName}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body,
  });
}

function loadEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
