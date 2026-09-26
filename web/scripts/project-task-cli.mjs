#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ACTOR_EMAIL = "info@paintersottawa.com";

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ");
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function parseCliArgs(argv) {
  const args = {
    command: null,
    project: null,
    projectId: null,
    taskSpecs: [],
    file: null,
    actorEmail: null,
    envFile: null,
    yes: false,
    dryRun: false,
    help: false,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-h" || token === "--help") {
      args.help = true;
      continue;
    }
    if (token === "-y" || token === "--yes") {
      args.yes = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    const [flag, inlineValue] = token.startsWith("--") ? token.split(/=(.*)/s, 2) : [null, null];
    if (flag) {
      const value = inlineValue ?? argv[++index];
      if (value == null || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--project") args.project = value;
      else if (flag === "--project-id") args.projectId = value;
      else if (flag === "--task") args.taskSpecs.push(value);
      else if (flag === "--file") args.file = value;
      else if (flag === "--actor-email") args.actorEmail = value;
      else if (flag === "--env-file") args.envFile = value;
      else throw new Error(`Unknown option: ${flag}`);
      continue;
    }

    positionals.push(token);
  }

  args.command = positionals.shift() ?? null;
  if (!args.project && !args.projectId) args.project = positionals.shift() ?? null;
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  return args;
}

export function parseTaskSpec(spec) {
  const [rawTitle, rawHours, ...noteParts] = String(spec).split("|");
  const title = rawTitle?.trim();
  const hours = Number(rawHours);
  const notes = noteParts.join("|").trim() || null;

  if (!title) throw new Error(`Invalid task "${spec}": title is required.`);
  if (rawHours == null || rawHours.trim() === "" || !Number.isFinite(hours) || hours < 0) {
    throw new Error(`Invalid task "${spec}": hours must be zero or greater.`);
  }

  return { title, budgetedHours: Math.round(hours * 100) / 100, notes };
}

function validateTask(task, source) {
  const title = String(task?.title ?? "").trim();
  const hours = Number(task?.budgetedHours);
  const notes = String(task?.notes ?? "").trim() || null;
  if (!title) throw new Error(`Invalid task in ${source}: title is required.`);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`Invalid task "${title || "(untitled)"}" in ${source}: budgetedHours must be zero or greater.`);
  }
  return { title, budgetedHours: Math.round(hours * 100) / 100, notes };
}

export function validateTaskBatch(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("At least one task is required.");
  const clean = tasks.map((task, index) => validateTask(task, `item ${index + 1}`));
  const seen = new Set();
  for (const task of clean) {
    const key = normalize(task.title);
    if (seen.has(key)) throw new Error(`Duplicate task title in batch: "${task.title}".`);
    seen.add(key);
  }
  return clean;
}

export function selectProject(projects, query, projectId = null) {
  if (projectId) {
    const exactId = projects.filter((project) => project.companycam_id === projectId);
    if (exactId.length === 1) return exactId[0];
    throw new Error(`Project ID not found: "${projectId}".`);
  }

  const needle = normalize(query);
  if (!needle) throw new Error("Project name is required.");
  const usable = projects.filter((project) => !project.is_deleted);
  const exact = usable.filter((project) => normalize(project.name) === needle);
  if (exact.length === 1) return exact[0];

  const partial = usable.filter(
    (project) =>
      normalize(project.name).includes(needle) ||
      normalize(project.formatted_address).includes(needle),
  );
  if (partial.length === 1) return partial[0];
  let ambiguous = partial;
  if (partial.length === 0) {
    const fuzzy = usable
      .map((project) => ({ project, distance: editDistance(normalize(project.name), needle) }))
      .filter((candidate) => candidate.distance <= 2)
      .sort((left, right) => left.distance - right.distance);
    if (fuzzy.length === 1 || (fuzzy.length > 1 && fuzzy[0].distance < fuzzy[1].distance)) {
      return fuzzy[0].project;
    }
    if (fuzzy.length === 0) throw new Error(`No project matched "${query}".`);
    ambiguous = fuzzy.map((candidate) => candidate.project);
  }

  const options = ambiguous
    .map((project) => `${project.name} — ${project.formatted_address || "no address"} [${project.companycam_id}]`)
    .join("\n  - ");
  throw new Error(`More than one project matched. Use --project-id to choose one:\n  - ${options}`);
}

export function findDuplicateTasks(existingTasks, requestedTasks) {
  const existing = new Set(existingTasks.filter((task) => task.is_active).map((task) => normalize(task.title)));
  return requestedTasks.filter((task) => existing.has(normalize(task.title)));
}

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadConfiguration(args) {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = [
    path.resolve(scriptRoot, "../Ottawa Painters App/.env.local"),
    path.resolve(scriptRoot, ".env.local"),
    path.resolve(process.cwd(), ".env.local"),
  ];
  if (args.envFile) {
    const explicit = path.resolve(process.cwd(), args.envFile);
    if (!existsSync(explicit)) throw new Error(`Environment file not found: ${explicit}`);
    candidates.push(explicit);
  }

  const fileValues = Object.assign({}, ...[...new Set(candidates)].map(parseEnvFile));
  const values = { ...fileValues, ...process.env };
  const supabaseUrl = values.SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL || values.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).");
  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Put it in .env.local or pass --env-file. It is used only by this server-side CLI.",
    );
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    serviceRoleKey,
    actorEmail: args.actorEmail || values.PROJECT_TASK_ADMIN_EMAIL || DEFAULT_ACTOR_EMAIL,
  };
}

async function request(config, table, { method = "GET", params = {}, body = null, prefer = null } = {}) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.message || payload?.error || `${response.status} ${response.statusText}`;
    throw new Error(`Supabase request failed: ${detail}`);
  }
  return payload;
}

async function resolveProject(config, args) {
  if (args.projectId) {
    const projects = await request(config, "companycam_projects", {
      params: {
        select: "companycam_id,name,formatted_address,is_deleted,is_archived",
        companycam_id: `eq.${args.projectId}`,
      },
    });
    return selectProject(projects, null, args.projectId);
  }

  if (!args.project) throw new Error("Pass --project or --project-id.");
  const projects = await request(config, "companycam_projects", {
    params: {
      select: "companycam_id,name,formatted_address,is_deleted,is_archived",
      limit: "5000",
    },
  });
  return selectProject(projects, args.project);
}

async function loadTasksFromArgs(args) {
  const tasks = args.taskSpecs.map(parseTaskSpec);
  if (args.file) {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!existsSync(filePath)) throw new Error(`Task file not found: ${filePath}`);
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    const fileTasks = Array.isArray(payload) ? payload : payload.tasks;
    if (!Array.isArray(fileTasks)) throw new Error(`Task file must contain an array or a {"tasks": [...]} object.`);
    tasks.push(...fileTasks);
  }
  return validateTaskBatch(tasks);
}

async function findActor(config) {
  const profiles = await request(config, "employee_profiles", {
    params: {
      select: "user_id,email,full_name,role,is_active",
      email: `ilike.${config.actorEmail}`,
      limit: "2",
    },
  });
  const actor = profiles.find(
    (profile) =>
      normalize(profile.email) === normalize(config.actorEmail) &&
      profile.is_active &&
      ["admin", "manager"].includes(profile.role),
  );
  if (!actor) {
    throw new Error(`Active admin/manager actor not found for "${config.actorEmail}". Pass --actor-email.`);
  }
  return actor;
}

async function getExistingTasks(config, projectId) {
  return request(config, "project_labour_tasks", {
    params: {
      select: "id,title,notes,budgeted_hours,status,is_active,sort_order,source_kind",
      companycam_project_id: `eq.${projectId}`,
      is_active: "eq.true",
      order: "sort_order.asc,inserted_at.asc",
    },
  });
}

async function getOrCreateActiveBudget(config, projectId, actorId) {
  const budgets = await request(config, "project_labour_budgets", {
    params: {
      select: "id,source_quote_id,revision,budgeted_hours,is_active",
      companycam_project_id: `eq.${projectId}`,
      is_active: "eq.true",
      order: "revision.desc",
      limit: "1",
    },
  });
  if (budgets.length === 1) return { budget: budgets[0], created: false };

  const revisions = await request(config, "project_labour_budgets", {
    params: {
      select: "revision",
      companycam_project_id: `eq.${projectId}`,
      order: "revision.desc",
      limit: "1",
    },
  });
  const revision = Number(revisions[0]?.revision ?? 0) + 1;
  const now = new Date().toISOString();
  const created = await request(config, "project_labour_budgets", {
    method: "POST",
    body: {
      companycam_project_id: projectId,
      source_quote_id: "manual-tasks",
      source_quote_name: "Manual tasks",
      source_quote_updated_at: now,
      instructions: null,
      calculated_hours: 0,
      budgeted_hours: 0,
      revision,
      is_active: true,
      published_by: actorId,
      published_at: now,
    },
    prefer: "return=representation",
  });
  return { budget: created[0], created: true };
}

async function rollbackCreatedRows(config, progressIds, createdBudgetId) {
  if (progressIds.length > 0) {
    await request(config, "project_labour_task_progress", {
      method: "DELETE",
      params: { id: `in.(${progressIds.join(",")})` },
      prefer: "return=minimal",
    }).catch(() => null);
  }
  if (createdBudgetId) {
    await request(config, "project_labour_budgets", {
      method: "DELETE",
      params: { id: `eq.${createdBudgetId}` },
      prefer: "return=minimal",
    }).catch(() => null);
  }
}

async function insertTaskBatch(config, project, actor, tasks, existingTasks) {
  const { budget, created: createdBudget } = await getOrCreateActiveBudget(
    config,
    project.companycam_id,
    actor.user_id,
  );
  const identities = tasks.map(() => ({ sourceItemId: randomUUID(), progressId: randomUUID() }));
  const progressRows = identities.map((identity) => ({
    id: identity.progressId,
    companycam_project_id: project.companycam_id,
    source_kind: "custom",
    source_item_id: identity.sourceItemId,
  }));
  let progressIds = [];

  try {
    const progress = await request(config, "project_labour_task_progress", {
      method: "POST",
      body: progressRows,
      prefer: "return=representation",
    });
    progressIds = progress.map((row) => row.id);

    const maxSort = existingTasks.reduce((maximum, task) => Math.max(maximum, Number(task.sort_order) || 0), 0);
    const rows = tasks.map((task, index) => ({
      labour_budget_id: budget.id,
      progress_id: identities[index].progressId,
      companycam_project_id: project.companycam_id,
      source_quote_id: budget.source_quote_id,
      source_kind: "custom",
      source_item_id: identities[index].sourceItemId,
      title: task.title,
      notes: task.notes,
      calculated_hours: task.budgetedHours,
      manual_budgeted_hours: null,
      budgeted_hours: task.budgetedHours,
      sort_order: maxSort + index + 1,
      status: "pending",
      is_active: true,
      budget_revision: budget.revision,
      metadata: {},
    }));
    return await request(config, "project_labour_tasks", {
      method: "POST",
      body: rows,
      prefer: "return=representation",
    });
  } catch (error) {
    await rollbackCreatedRows(config, progressIds, createdBudget ? budget.id : null);
    throw error;
  }
}

async function confirm(message) {
  if (!process.stdin.isTTY) throw new Error("Confirmation requires an interactive terminal. Re-run with --yes.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${message} [y/N] `);
    return /^y(?:es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

function printTasks(project, tasks) {
  console.log(`${project.name} — ${project.formatted_address || "no address"} [${project.companycam_id}]`);
  if (tasks.length === 0) {
    console.log("No active tasks.");
    return;
  }
  for (const task of tasks) {
    console.log(`- ${task.title}: ${Number(task.budgeted_hours).toFixed(2)} hours (${task.status})`);
  }
  const total = tasks.reduce((sum, task) => sum + Number(task.budgeted_hours), 0);
  console.log(`Total: ${total.toFixed(2)} hours`);
}

function printHelp() {
  console.log(`Project task CLI

Usage:
  npm run tasks -- list --project "Customer or address"
  npm run tasks -- add-batch --project "Customer" --task "Title|Hours|Optional painter note" --yes
  npm run tasks -- add-batch --project-id ID --file tasks.json --dry-run

Task JSON:
  [{"title":"Entranceway - walls and trim","budgetedHours":6.46,"notes":null}]

Safety:
  add-batch requires confirmation or --yes, rejects duplicate active titles,
  and supports --dry-run. Use --actor-email when the default admin actor differs.`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    printHelp();
    return;
  }
  if (!["list", "add-batch"].includes(args.command)) throw new Error(`Unknown command: ${args.command}`);

  const config = loadConfiguration(args);
  const project = await resolveProject(config, args);
  const existingTasks = await getExistingTasks(config, project.companycam_id);

  if (args.command === "list") {
    printTasks(project, existingTasks);
    return;
  }

  const tasks = await loadTasksFromArgs(args);
  const duplicates = findDuplicateTasks(existingTasks, tasks);
  if (duplicates.length > 0) {
    throw new Error(`Active task already exists: ${duplicates.map((task) => `"${task.title}"`).join(", ")}.`);
  }
  const actor = await findActor(config);
  const total = tasks.reduce((sum, task) => sum + task.budgetedHours, 0);

  console.log(`${args.dryRun ? "Dry run for" : "Ready to add tasks to"} ${project.name}`);
  console.log(`${project.formatted_address || "No address"} [${project.companycam_id}]`);
  for (const task of tasks) console.log(`- ${task.title}: ${task.budgetedHours.toFixed(2)} hours`);
  console.log(`Total: ${total.toFixed(2)} hours`);
  console.log(`Actor: ${actor.full_name || actor.email} (${actor.role})`);

  if (args.dryRun) return;
  if (!args.yes && !(await confirm(`Add ${tasks.length} tasks?`))) {
    console.log("Cancelled.");
    return;
  }

  await insertTaskBatch(config, project, actor, tasks, existingTasks);
  const verified = await getExistingTasks(config, project.companycam_id);
  printTasks(project, verified);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
