const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "src");
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
}
collect(root);
const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

for (const legacyRelation of [
  "companycam_projects",
  "project_assignments",
  "employee_profiles",
  "employee_push_tokens",
  "project_budgets",
  "project_labour_tasks",
  "project_labour_task_time_entries",
  "project_over_budget_reasons",
  "location_tracking_alerts",
]) {
  assert.doesNotMatch(source, new RegExp(`["']${legacyRelation}["']`), `legacy relation remains: ${legacyRelation}`);
}

for (const requiredRelation of ["job_feed", "job_assignments", "job_budgets", "job_tasks", "time_entries"]) {
  assert.match(source, new RegExp(`["']${requiredRelation}["']`), `missing V2 relation: ${requiredRelation}`);
}
for (const requiredCommand of ["record_time_entry_command", "record_location_update", "register_push_token"]) {
  assert.match(source, new RegExp(`["']${requiredCommand}["']`), `missing V2 command: ${requiredCommand}`);
}

assert.doesNotMatch(source, /functions\.invoke\(["']sync-companycam-projects["']/);
console.log(`V2 client checks passed across ${files.length} source files.`);
