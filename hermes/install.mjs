#!/usr/bin/env node

import { constants } from "node:fs";
import { access, chmod, copyFile, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const result = { prefix: "/opt/data", force: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--prefix") result.prefix = path.resolve(argv[++index] ?? "");
    else if (argv[index] === "--force") result.force = true;
    else if (argv[index] === "--dry-run") result.dryRun = true;
    else throw new Error(`Unknown option: ${argv[index]}`);
  }
  if (!result.prefix || result.prefix === path.parse(result.prefix).root) {
    throw new Error("--prefix must be a specific directory, not a filesystem root");
  }
  return result;
}

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function install(argv) {
  const options = parseArgs(argv);
  const bin = path.join(options.prefix, "bin");
  const skills = path.join(options.prefix, "skills");
  const skillNames = [
    "ottawa-operations",
    "ottawa-communications-readonly",
    "ottawa-painters-db-cli",
    "ottawa-painters-apis",
  ];
  const targets = [
    path.join(bin, "ottawa"),
    path.join(bin, "ottawa-source"),
    ...skillNames.map((name) => path.join(skills, name)),
  ];

  if (!options.force) {
    const conflicts = [];
    for (const target of targets) if (await exists(target)) conflicts.push(target);
    if (conflicts.length > 0) throw new Error(`Refusing to overwrite existing paths:\n${conflicts.join("\n")}\nRe-run with --force after reviewing them.`);
  }

  const actions = [
    `create ${bin}`,
    `install ottawa and ottawa-source -> ${bin}`,
    `copy scripts/lib -> ${path.join(bin, "lib")}`,
    `copy Hermes skills -> ${skills}`,
  ];
  if (options.dryRun) return { prefix: options.prefix, actions };

  await mkdir(path.join(bin, "lib"), { recursive: true });
  await mkdir(skills, { recursive: true });
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa"), path.join(bin, "ottawa"));
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa-source"), path.join(bin, "ottawa-source"));
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-cli.mjs"), path.join(bin, "ottawa-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-source-cli.mjs"), path.join(bin, "ottawa-source-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-report-contract.mjs"), path.join(bin, "lib/ottawa-report-contract.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-read-sources.mjs"), path.join(bin, "lib/ottawa-read-sources.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-customer-rag.mjs"), path.join(bin, "lib/ottawa-customer-rag.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-quo-scope.mjs"), path.join(bin, "lib/ottawa-quo-scope.mjs"));
  for (const skillName of skillNames) {
    await cp(path.join(repositoryRoot, `hermes/skills/${skillName}`), path.join(skills, skillName), { recursive: true, force: options.force });
  }
  await chmod(path.join(bin, "ottawa"), 0o755);
  await chmod(path.join(bin, "ottawa-source"), 0o755);
  return { prefix: options.prefix, actions };
}

try {
  const result = await install(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Install failed: ${error.message}\n`);
  process.exitCode = 1;
}
