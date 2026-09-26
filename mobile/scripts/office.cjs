#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

loadEnvFile(".env");
loadEnvFile(".env.local");

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  if (!command || args.help || args.h) {
    printUsage();
    return;
  }

  if (command === "list") {
    const context = await request("list");
    printContext(context);
    return;
  }

  if (command === "create-employee") {
    const fullName = args.name || args.fullName || args.full_name;
    const result = await request("createEmployee", {
      email: args.email,
      fullName,
      role: args.role || "painter",
      password: args.password,
    });

    console.log(`Created employee: ${formatEmployee(result.employee)}`);
    if (result.temporaryPassword) {
      console.log(`Temporary password: ${result.temporaryPassword}`);
    }
    return;
  }

  if (command === "assign" || command === "remove") {
    const context = await request("list");
    const employee = resolveEmployee(context.employees || [], args);
    const project = resolveProject(context.projects || [], args);
    const result = await request(command === "assign" ? "assign" : "remove", {
      userId: employee.user_id,
      projectId: project.companycam_id,
    });

    const verb = command === "assign" ? "Assigned" : "Removed";
    console.log(`${verb}: ${employee.full_name || employee.email} -> ${project.name}`);
    console.log(`Status: ${result.assignment?.status || "unknown"}`);
    return;
  }

  if (command === "set-budget") {
    const context = await request("list");
    const project = resolveProject(context.projects || [], args);
    const amountBeforeTax = parsePositiveNumber(
      args.amountBeforeTax ?? args.amount,
      "--amount-before-tax",
    );
    const allocationPercent = parsePercent(args.allocation ?? 39, "--allocation");
    await request("setBudget", {
      projectId: project.companycam_id,
      amountBeforeTax,
      allocationPercent,
      notes: args.notes,
    });

    console.log(`Budget saved: ${project.name}`);
    console.log(`Pre-tax job value: $${amountBeforeTax.toFixed(2)}`);
    console.log(`Labour allocation: ${allocationPercent.toFixed(2)}%`);
    return;
  }

  if (command === "set-actual-labour") {
    const context = await request("list");
    const project = resolveProject(context.projects || [], args);
    const clear = args.clear === true;
    if (clear && (args.amount !== undefined || args.actualLabourCost !== undefined)) {
      throw new Error("Use either --amount or --clear, not both.");
    }
    const actualLabourCost = clear
      ? null
      : parsePositiveNumber(args.amount ?? args.actualLabourCost, "--amount");

    await request("setActualLabourCost", {
      projectId: project.companycam_id,
      actualLabourCost,
    });

    console.log(`Actual labour cost ${clear ? "cleared" : "saved"}: ${project.name}`);
    if (!clear) console.log(`Complete labour cost: $${actualLabourCost.toFixed(2)}`);
    return;
  }

  if (command === "projects") {
    const context = await request("list");
    const search = String(args.search || args.s || "").toLowerCase();
    const projects = (context.projects || []).filter((project) => {
      if (!search) return true;
      return [
        project.companycam_id,
        project.name,
        project.formatted_address,
        project.city,
        project.postal_code,
      ].some((value) => String(value || "").toLowerCase().includes(search));
    });

    for (const project of projects) {
      console.log(`${project.companycam_id} | ${project.name} | ${project.formatted_address || ""}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function request(action, body = {}) {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const adminToken = process.env.ASSIGNMENT_ADMIN_TOKEN;
  const managerJwt = process.env.ASSIGNMENT_MANAGER_JWT;

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL.");
  if (!adminToken && !managerJwt) {
    throw new Error("Missing ASSIGNMENT_ADMIN_TOKEN or ASSIGNMENT_MANAGER_JWT.");
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (publishableKey) {
    headers.apikey = publishableKey;
    headers.Authorization = `Bearer ${managerJwt || publishableKey}`;
  } else if (managerJwt) {
    headers.Authorization = `Bearer ${managerJwt}`;
  }

  if (adminToken) headers["x-admin-token"] = adminToken;

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/project-assignments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...body }),
  });
  const text = await response.text();
  const payload = text ? parseJson(text) : {};

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with ${response.status}`);
  }

  return payload;
}

function resolveEmployee(employees, options) {
  if (options.userId || options.user_id) {
    const userId = options.userId || options.user_id;
    const employee = employees.find((item) => item.user_id === userId);
    if (employee) return employee;
    throw new Error(`No employee found for user ID: ${userId}`);
  }

  if (options.email) {
    const email = String(options.email).toLowerCase();
    const employee = employees.find((item) => String(item.email || "").toLowerCase() === email);
    if (employee) return employee;
    throw new Error(`No employee found for email: ${options.email}`);
  }

  if (options.name) {
    const name = String(options.name).toLowerCase();
    const matches = employees.filter((item) => String(item.full_name || "").toLowerCase().includes(name));
    return singleMatch(matches, `employee name "${options.name}"`, formatEmployee);
  }

  throw new Error("Provide --email, --name, or --user-id.");
}

function resolveProject(projects, options) {
  if (options.projectId || options.project_id || options.companycamProjectId || options.companycam_project_id) {
    const projectId = options.projectId || options.project_id || options.companycamProjectId || options.companycam_project_id;
    const project = projects.find((item) => item.companycam_id === String(projectId));
    if (project) return project;
    throw new Error(`No project found for CompanyCam ID: ${projectId}`);
  }

  if (options.project) {
    const search = String(options.project).toLowerCase();
    const matches = projects.filter((item) => [
      item.name,
      item.formatted_address,
      item.city,
      item.postal_code,
    ].some((value) => String(value || "").toLowerCase().includes(search)));
    return singleMatch(matches, `project "${options.project}"`, formatProject);
  }

  throw new Error("Provide --project or --project-id.");
}

function singleMatch(matches, label, formatter) {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No match found for ${label}.`);

  const choices = matches.slice(0, 10).map((item) => `- ${formatter(item)}`).join("\n");
  throw new Error(`Multiple matches found for ${label}. Use a more specific value:\n${choices}`);
}

function printContext(context) {
  const employees = context.employees || [];
  const projects = context.projects || [];
  const assignments = context.assignments || [];

  console.log(`Employees (${employees.length})`);
  for (const employee of employees) {
    console.log(`- ${formatEmployee(employee)}`);
  }

  console.log("");
  console.log(`Active assignments (${assignments.length})`);
  for (const assignment of assignments) {
    const employee = employees.find((item) => item.user_id === assignment.user_id);
    const project = projects.find((item) => item.companycam_id === assignment.companycam_project_id);
    console.log(`- ${employee?.full_name || employee?.email || assignment.user_id} -> ${project?.name || assignment.companycam_project_id}`);
  }
}

function formatEmployee(employee) {
  return `${employee.user_id} | ${employee.full_name || "Unnamed"} | ${employee.email || "no email"} | ${employee.role || "painter"}`;
}

function formatProject(project) {
  return `${project.companycam_id} | ${project.name} | ${project.formatted_address || ""}`;
}

function parsePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a number greater than zero.`);
  }
  return Math.round(number * 100) / 100;
}

function parsePercent(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100) {
    throw new Error(`${label} must be greater than zero and at most 100.`);
  }
  return Math.round(number * 100) / 100;
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }

    const rawKey = token.slice(2);
    const [key, inlineValue] = rawKey.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue == null && value && !String(value).startsWith("--")) {
      index += 1;
      parsed[toCamelCase(key)] = value;
    } else {
      parsed[toCamelCase(key)] = inlineValue ?? true;
    }
  }

  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
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

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function printUsage() {
  console.log(`Ottawa Painters office CLI

Usage:
  npm run office -- list
  npm run office -- create-employee --email painter@example.com --name "Painter Name" [--role painter] [--password TempPass123]
  npm run office -- assign --email painter@example.com --project "Tyler Duncan"
  npm run office -- remove --email painter@example.com --project "Tyler Duncan"
  npm run office -- projects --search "Duncan"
  npm run office -- set-budget --project "Tyler Duncan" --amount-before-tax 10000 [--allocation 39] [--notes "Original contract"]
  npm run office -- set-actual-labour --project "Sheila McSwiggan" --amount 450
  npm run office -- set-actual-labour --project "Sheila McSwiggan" --clear

Environment:
  ASSIGNMENT_ADMIN_TOKEN       Backend token configured in Supabase secrets
  ASSIGNMENT_MANAGER_JWT       Optional signed-in manager JWT instead of admin token
  EXPO_PUBLIC_SUPABASE_URL     Supabase project URL
  EXPO_PUBLIC_SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
`);
}
