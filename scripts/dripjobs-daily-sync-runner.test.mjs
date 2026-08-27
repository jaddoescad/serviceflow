import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDailySync } from "./dripjobs-daily-sync-runner.mjs";

const headers = "Status,Label,Job,Customer Name,Email,Phone Number,Salesperson,Project Manager,Crew,Proposal ID,Invoice ID,Invoice Status,Amount,Paid,Balance,Deal Stage,Deal Stage Date,Proposal Signed Date,Job Scheduled Date,Job Start Date,Job Completion Date";
const salesHeaders = ["Status", "Label", "Customer Name", "Email", "Phone Number", "Lead Source", "Deal Name", "Deal Stage", "Deal Amount", "Last Change", "Deal Age", "Salesperson"];

function jobsCsv(view, count = 50) {
  const rows = [headers];
  for (let index = 0; index < count; index += 1) {
    const proposal = (view === "active" ? 3_000_000 : 2_000_000) + index;
    const status = view === "active" ? "COMPLETED" : "ARCHIVED";
    rows.push(`${status},,Customer ${index + 1},Customer ${index + 1},customer@example.com,6135551212,Scott Madden,Scott Madden,No crew,${proposal},#${500_000 + proposal},Paid,"$1,130.00","$1,130.00",$0.00,Project Complete,"Saturday, August 15, 2026",8/1/2026 1:00:00 PM,,08/01/2026,08/15/2026`);
  }
  return `${rows.join("\r\n")}\r\n`;
}

function salesSnapshot(view, count) {
  return {
    schema_version: 3,
    source_type: "dripjobs_sales_list_changed_rows_dom_v3",
    captured_at: "2026-08-16T18:00:00.000Z",
    view,
    filters: { created: "anytime", changed: "last_7_days", page_length: "-1", applied: true },
    headers: salesHeaders,
    total: count,
    datatable_total: count,
    rows: Array.from({ length: count }, (_, index) => {
      const dealId = `${view === "active" ? "a" : "b"}${String(index).padStart(31, "0")}`;
      return {
        row_number: index + 1,
        deal_id: dealId,
        deal_id_from_href: dealId,
        contact_id: `c${String(index).padStart(31, "0")}`,
        Status: view === "active" ? "Pending" : "Archived",
        Label: "",
        "Customer Name": `Customer ${index + 1}`,
        Email: "customer@example.com",
        "Phone Number": "6135551212",
        "Lead Source": index % 2 ? "/Contact" : "Meta Ads - Interior",
        "Deal Name": `Deal ${index + 1}`,
        "Deal Stage": "Proposal(s) Sent",
        "Deal Amount": "$1,130.00",
        "Last Change": "2d",
        "Deal Age": "5d",
        Salesperson: "Scott Madden",
      };
    }),
  };
}

async function fixture({ active = jobsCsv("active"), archived = jobsCsv("archived"), importerStatus = "verified", loginRequired = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dripjobs-sync-test-"));
  const importer = path.join(root, "importer.mjs");
  const salesImporter = path.join(root, "sales-importer.mjs");
  const envFile = path.join(root, "supabase.env");
  await writeFile(importer, "// fixture\n");
  await writeFile(salesImporter, "// fixture\n");
  await writeFile(envFile, "SUPABASE_URL=https://example.supabase.co\n");
  let importerCalls = 0;
  let loggedIn = !loginRequired;
  let selectedView = "active";
  let currentPage = "jobs";
  const agentCommands = [];
  const execFile = async (executable, args, options = {}) => {
    if (executable === "agent-browser") {
      agentCommands.push(args);
      if (args.includes("open") && args.some((value) => String(value).includes("/saleslist"))) currentPage = "sales";
      if (args.includes("snapshot")) return {
        stdout: loggedIn ? '- generic "Jobs List"\n- generic "Show Archived"\n- link "Export CSV"' : '- textbox "Your Email Address"\n- textbox "Password"\n- button "Sign In"',
        stderr: "",
      };
      if (args.includes("get") && args.includes("url")) return { stdout: loggedIn ? (currentPage === "sales" ? "https://app.dripjobs.com/saleslist" : "https://app.dripjobs.com/jobs/list") : "https://app.dripjobs.com/login", stderr: "" };
      if (args.includes("get") && args.includes("title")) return { stdout: loggedIn ? (currentPage === "sales" ? "Sales Pipeline - DripJobs" : "Jobs List - DripJobs") : "Sign In - DripJobs", stderr: "" };
      if (args.includes("Sign In") || args.includes("button[type='submit']")) loggedIn = true;
      if (args.includes("eval")) {
        const script = args.at(-1);
        if (script.includes("dripjobs_sales_list_changed_rows_dom_v3")) return { stdout: JSON.stringify(salesSnapshot(selectedView, selectedView === "active" ? 12 : 18)), stderr: "" };
        if (currentPage === "sales" && script.includes("return 'toggled'")) {
          selectedView = script.includes("toggle.checked !== true") ? "archived" : "active";
          return { stdout: "toggled", stderr: "" };
        }
        if (currentPage === "sales" && script.includes("go.click()")) {
          selectedView = script.includes("toggle.checked !== true") ? "archived" : "active";
          return { stdout: "submitted", stderr: "" };
        }
        if (currentPage === "sales" && script.includes("#created-date-dropdown") && script.includes("return 'all'")) {
          return { stdout: "all", stderr: "" };
        }
        if (script.includes("sortable-list-table_length")) return { stdout: "all", stderr: "" };
        if (script.includes("rendered:") && script.includes("selected:")) {
          const view = script.includes("view: 'archived'") ? "archived" : "active";
          selectedView = view;
          return { stdout: JSON.stringify({ view, archived: view === "archived", total: 50, rendered: 50, selected: 50 }), stderr: "" };
        }
        if (script.includes("exportCSVSelected")) {
          const directory = options.env?.AGENT_BROWSER_DOWNLOAD_PATH;
          await writeFile(path.join(directory, `Jobs_List_${selectedView}.csv`), selectedView === "active" ? active : archived);
          return { stdout: "started", stderr: "" };
        }
        return { stdout: "ready", stderr: "" };
      }
      return { stdout: "ok", stderr: "" };
    }
    importerCalls += 1;
    if (args[0] === salesImporter) return {
      stdout: JSON.stringify({ status: importerStatus, applied_leads: 3, applied_value_changes: 2, persisted_deals: 30, canonical_deal_count: 1_469, unlinked_deals: 5, missing_archived_unchanged: 5 }),
      stderr: "",
    };
    return {
      stdout: JSON.stringify({
        status: importerStatus,
        applied_jobs: 2,
        applied_amount_changes: 1,
        applied_production_month_changes: 1,
        historical_locked_unchanged: 10,
        unresolved_unchanged: 2,
      }),
      stderr: "",
    };
  };
  return {
    root,
    env: {
      HERMES_DRIPJOBS_SYNC_ROOT: path.join(root, "state"),
      HERMES_DRIPJOBS_BROWSER_PROFILE: path.join(root, "browser-profile"),
      HERMES_DRIPJOBS_IMPORTER: importer,
      HERMES_DRIPJOBS_SALES_IMPORTER: salesImporter,
      HERMES_DRIPJOBS_SUPABASE_ENV: envFile,
      HERMES_AGENT_BROWSER_BIN: "agent-browser",
    },
    dependencies: { execFile, pause: async () => {} },
    importerCalls: () => importerCalls,
    agentCommands,
  };
}

test("daily runner exports both All views, validates, imports, and stores a baseline", async () => {
  const testFixture = await fixture();
  try {
    const result = await runDailySync({ argv: ["--yes"], env: testFixture.env, now: new Date("2026-08-16T18:00:00Z"), dependencies: testFixture.dependencies });
    assert.equal(result.exitCode, 0);
    assert.equal(testFixture.importerCalls(), 2);
    const manifest = JSON.parse(await readFile(path.join(testFixture.env.HERMES_DRIPJOBS_SYNC_ROOT, "accepted-manifest.json"), "utf8"));
    const health = JSON.parse(await readFile(path.join(testFixture.env.HERMES_DRIPJOBS_SYNC_ROOT, "health.json"), "utf8"));
    const salesManifest = JSON.parse(await readFile(path.join(testFixture.env.HERMES_DRIPJOBS_SYNC_ROOT, "accepted-sales-manifest.json"), "utf8"));
    assert.equal(manifest.row_count, 100);
    assert.equal(manifest.active_row_count, 50);
    assert.equal(manifest.archived_row_count, 50);
    assert.equal(health.last_applied_production_month_changes, 1);
    assert.equal(health.schema_version, 5);
    assert.equal(health.last_sales_row_count, 30);
    assert.equal(health.last_persisted_sales_deals, 30);
    assert.equal(health.last_canonical_sales_deals, 1_469);
    assert.equal(health.last_applied_leads, 3);
    assert.equal(salesManifest.distinct_deals, 30);
    assert.equal(health.consecutive_errors, 0);
  } finally {
    await rm(testFixture.root, { recursive: true, force: true });
  }
});

test("legacy Invoice List manifest is ignored during the first Jobs List migration run", async () => {
  const testFixture = await fixture();
  try {
    const stateDirectory = testFixture.env.HERMES_DRIPJOBS_SYNC_ROOT;
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path.join(stateDirectory, "accepted-manifest.json"), JSON.stringify({
      source_type: "dripjobs_invoice_list_csv",
      row_count: 227,
      source_sha256: "legacy-invoice-list-manifest",
    }));

    const result = await runDailySync({
      argv: ["--dry-run"],
      env: testFixture.env,
      now: new Date("2026-08-16T18:00:00Z"),
      dependencies: testFixture.dependencies,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(testFixture.importerCalls(), 2);
    const preserved = JSON.parse(await readFile(path.join(stateDirectory, "accepted-manifest.json"), "utf8"));
    assert.equal(preserved.source_type, "dripjobs_invoice_list_csv");
  } finally {
    await rm(testFixture.root, { recursive: true, force: true });
  }
});

test("wrong Jobs List fails closed and never invokes the importer", async () => {
  const testFixture = await fixture({ active: `${"Name,Email\r\n"}${"wrong,value\r\n".repeat(60)}` });
  try {
    const result = await runDailySync({ argv: ["--yes"], env: testFixture.env, now: new Date("2026-08-16T18:00:00Z"), dependencies: testFixture.dependencies });
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /No validated DripJobs data was changed/);
    assert.equal(testFixture.importerCalls(), 0);
    const health = JSON.parse(await readFile(path.join(testFixture.env.HERMES_DRIPJOBS_SYNC_ROOT, "health.json"), "utf8"));
    assert.equal(health.validation_status, "failed");
    assert.equal(health.consecutive_errors, 1);
  } finally {
    await rm(testFixture.root, { recursive: true, force: true });
  }
});

test("daily runner signs in and keeps the persistent browser profile", async () => {
  const testFixture = await fixture({ loginRequired: true });
  try {
    const result = await runDailySync({
      argv: ["--dry-run"],
      env: { ...testFixture.env, HERMES_DRIPJOBS_LOGIN_EMAIL: "qa@example.com", HERMES_DRIPJOBS_LOGIN_PASSWORD: "not-a-real-password" },
      now: new Date("2026-08-16T18:00:00Z"),
      dependencies: testFixture.dependencies,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(testFixture.importerCalls(), 2);
    assert.ok(testFixture.agentCommands.some((args) => args.includes("input[type='email']")));
    assert.ok(testFixture.agentCommands.some((args) => args.includes("input[type='password']")));
  } finally {
    await rm(testFixture.root, { recursive: true, force: true });
  }
});
