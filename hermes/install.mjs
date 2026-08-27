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
  const pdfJsVendor = path.join(bin, "vendor", "pdfjs-dist");
  const cronScripts = path.join(options.prefix, "scripts");
  const emailProfile = path.join(options.prefix, "profiles", "email");
  const emailProfileScripts = path.join(emailProfile, "scripts");
  const emailProfileHooks = path.join(emailProfile, "agent-hooks");
  const emailProfileSkills = path.join(emailProfile, "skills");
  const hermesState = options.prefix;
  const agentHooks = path.join(hermesState, "agent-hooks");
  const hermesScripts = cronScripts;
  const skills = path.join(options.prefix, "skills");
  const skillNames = [
    "ottawa-operations",
    "ottawa-communications-readonly",
    "ottawa-email-triage",
    "ottawa-gmail-labeling",
    "ottawa-painters-db-cli",
    "ottawa-painters-apis",
    "ottawa-time-entry-admin",
    "ottawa-meta-ads-reporting",
  ];
  const targets = [
    path.join(bin, "ottawa"),
    path.join(bin, "ottawa-source"),
    path.join(bin, "ottawa-time"),
    path.join(bin, "ottawa-gmail-read"),
    path.join(bin, "ottawa-gmail-label"),
    path.join(bin, "ottawa-email-intake"),
    path.join(bin, "ottawa-contractor-invoice"),
    path.join(bin, "ottawa-invoice-vision.py"),
    path.join(bin, "dripjobs-daily-sync-runner.mjs"),
    path.join(bin, "import-invoice-list-job-amounts.mjs"),
    path.join(bin, "import-dripjobs-sales-list.mjs"),
    path.join(bin, "meta-marketing-daily-sync.mjs"),
    path.join(bin, "lib", "dripjobs-invoice-list.mjs"),
    path.join(bin, "lib", "dripjobs-jobs-list.mjs"),
    path.join(bin, "lib", "dripjobs-sales-list.mjs"),
    path.join(bin, "lib", "dripjobs-job-authority.mjs"),
    path.join(bin, "lib", "meta-marketing-sync.mjs"),
    pdfJsVendor,
    path.join(cronScripts, "meta-ads-daily-report.sh"),
    path.join(cronScripts, "meta-ads-backend-sync.sh"),
    path.join(cronScripts, "email-intake-precheck.sh"),
    path.join(emailProfileScripts, "email-intake-precheck.sh"),
    path.join(cronScripts, "contractor-invoice-precheck.sh"),
    path.join(cronScripts, "dripjobs-daily-sync.sh"),
    path.join(emailProfileScripts, "contractor-invoice-precheck.sh"),
    path.join(cronScripts, "ops-health-monitor.mjs"),
    path.join(hermesScripts, "ops-health-monitor.sh"),
    path.join(agentHooks, "ottawa-tool-policy.py"),
    path.join(agentHooks, "ottawa-email-tool-policy.py"),
    path.join(emailProfileHooks, "ottawa-email-tool-policy.py"),
    path.join(emailProfileSkills, "ottawa-email-triage"),
    ...skillNames.map((name) => path.join(skills, name)),
  ];

  if (!options.force) {
    const conflicts = [];
    for (const target of targets) if (await exists(target)) conflicts.push(target);
    if (conflicts.length > 0) throw new Error(`Refusing to overwrite existing paths:\n${conflicts.join("\n")}\nRe-run with --force after reviewing them.`);
  }

  const actions = [
    `create ${bin}`,
    `install ottawa, ottawa-source, ottawa-time, and Ottawa Gmail tools -> ${bin}`,
    `install Meta Ads and DripJobs scheduled scripts -> ${cronScripts}`,
    `install the Gmail intake pre-check, policy hook, and triage skill -> ${emailProfile}`,
    `install ops health monitor -> ${cronScripts} and ${hermesScripts}`,
    `install Ottawa tool policy hook -> ${agentHooks}`,
    `copy scripts/lib -> ${path.join(bin, "lib")}`,
    `copy the bounded PDF text parser -> ${pdfJsVendor}`,
    `copy Hermes skills -> ${skills}`,
  ];
  if (options.dryRun) return { prefix: options.prefix, actions };

  await mkdir(path.join(bin, "lib"), { recursive: true });
  await mkdir(pdfJsVendor, { recursive: true });
  await mkdir(cronScripts, { recursive: true });
  await mkdir(agentHooks, { recursive: true });
  await mkdir(emailProfileScripts, { recursive: true });
  await mkdir(emailProfileHooks, { recursive: true });
  await mkdir(emailProfileSkills, { recursive: true });
  await mkdir(hermesScripts, { recursive: true });
  await mkdir(skills, { recursive: true });
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa"), path.join(bin, "ottawa"));
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa-source"), path.join(bin, "ottawa-source"));
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa-time"), path.join(bin, "ottawa-time"));
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa-gmail-read"), path.join(bin, "ottawa-gmail-read"));
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa-gmail-label"), path.join(bin, "ottawa-gmail-label"));
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa-email-intake"), path.join(bin, "ottawa-email-intake"));
  await copyFile(path.join(repositoryRoot, "hermes/bin/ottawa-contractor-invoice"), path.join(bin, "ottawa-contractor-invoice"));
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-invoice-vision.py"), path.join(bin, "ottawa-invoice-vision.py"));
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/meta-ads-daily-report.sh"),
    path.join(cronScripts, "meta-ads-daily-report.sh"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/meta-ads-backend-sync.sh"),
    path.join(cronScripts, "meta-ads-backend-sync.sh"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/email-intake-precheck.sh"),
    path.join(cronScripts, "email-intake-precheck.sh"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/email-intake-precheck.sh"),
    path.join(emailProfileScripts, "email-intake-precheck.sh"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/contractor-invoice-precheck.sh"),
    path.join(cronScripts, "contractor-invoice-precheck.sh"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/dripjobs-daily-sync.sh"),
    path.join(cronScripts, "dripjobs-daily-sync.sh"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/contractor-invoice-precheck.sh"),
    path.join(emailProfileScripts, "contractor-invoice-precheck.sh"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/ops-health-monitor.mjs"),
    path.join(cronScripts, "ops-health-monitor.mjs"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/scripts/ops-health-monitor.sh"),
    path.join(hermesScripts, "ops-health-monitor.sh"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/agent-hooks/ottawa-tool-policy.py"),
    path.join(agentHooks, "ottawa-tool-policy.py"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/agent-hooks/ottawa-email-tool-policy.py"),
    path.join(agentHooks, "ottawa-email-tool-policy.py"),
  );
  await copyFile(
    path.join(repositoryRoot, "hermes/agent-hooks/ottawa-email-tool-policy.py"),
    path.join(emailProfileHooks, "ottawa-email-tool-policy.py"),
  );
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-cli.mjs"), path.join(bin, "ottawa-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-source-cli.mjs"), path.join(bin, "ottawa-source-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/hermes-time-entry-cli.mjs"), path.join(bin, "hermes-time-entry-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-gmail-read-cli.mjs"), path.join(bin, "ottawa-gmail-read-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-gmail-label-cli.mjs"), path.join(bin, "ottawa-gmail-label-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-email-intake-cli.mjs"), path.join(bin, "ottawa-email-intake-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/ottawa-contractor-invoice-cli.mjs"), path.join(bin, "ottawa-contractor-invoice-cli.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/dripjobs-daily-sync-runner.mjs"), path.join(bin, "dripjobs-daily-sync-runner.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/import-invoice-list-job-amounts.mjs"), path.join(bin, "import-invoice-list-job-amounts.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/import-dripjobs-sales-list.mjs"), path.join(bin, "import-dripjobs-sales-list.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/meta-marketing-daily-sync.mjs"), path.join(bin, "meta-marketing-daily-sync.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-report-contract.mjs"), path.join(bin, "lib/ottawa-report-contract.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/meta-marketing-sync.mjs"), path.join(bin, "lib/meta-marketing-sync.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-read-sources.mjs"), path.join(bin, "lib/ottawa-read-sources.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-customer-rag.mjs"), path.join(bin, "lib/ottawa-customer-rag.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-gmail-read.mjs"), path.join(bin, "lib/ottawa-gmail-read.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-gmail-labeling.mjs"), path.join(bin, "lib/ottawa-gmail-labeling.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-email-intake.mjs"), path.join(bin, "lib/ottawa-email-intake.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-contractor-invoice.mjs"), path.join(bin, "lib/ottawa-contractor-invoice.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/dripjobs-invoice-list.mjs"), path.join(bin, "lib/dripjobs-invoice-list.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/dripjobs-jobs-list.mjs"), path.join(bin, "lib/dripjobs-jobs-list.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/dripjobs-sales-list.mjs"), path.join(bin, "lib/dripjobs-sales-list.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/dripjobs-job-authority.mjs"), path.join(bin, "lib/dripjobs-job-authority.mjs"));
  await copyFile(path.join(repositoryRoot, "node_modules/pdfjs-dist/legacy/build/pdf.mjs"), path.join(pdfJsVendor, "pdf.mjs"));
  await copyFile(path.join(repositoryRoot, "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"), path.join(pdfJsVendor, "pdf.worker.mjs"));
  await copyFile(path.join(repositoryRoot, "scripts/lib/ottawa-quo-scope.mjs"), path.join(bin, "lib/ottawa-quo-scope.mjs"));
  for (const skillName of skillNames) {
    await cp(path.join(repositoryRoot, `hermes/skills/${skillName}`), path.join(skills, skillName), { recursive: true, force: options.force });
  }
  await cp(
    path.join(repositoryRoot, "hermes/skills/ottawa-email-triage"),
    path.join(emailProfileSkills, "ottawa-email-triage"),
    { recursive: true, force: options.force },
  );
  await chmod(path.join(bin, "ottawa"), 0o755);
  await chmod(path.join(bin, "ottawa-source"), 0o755);
  await chmod(path.join(bin, "ottawa-time"), 0o755);
  await chmod(path.join(bin, "ottawa-gmail-read"), 0o755);
  await chmod(path.join(bin, "ottawa-gmail-label"), 0o755);
  await chmod(path.join(bin, "ottawa-email-intake"), 0o755);
  await chmod(path.join(bin, "ottawa-contractor-invoice"), 0o755);
  await chmod(path.join(bin, "ottawa-invoice-vision.py"), 0o755);
  await chmod(path.join(cronScripts, "meta-ads-daily-report.sh"), 0o755);
  await chmod(path.join(cronScripts, "email-intake-precheck.sh"), 0o755);
  await chmod(path.join(emailProfileScripts, "email-intake-precheck.sh"), 0o755);
  await chmod(path.join(cronScripts, "contractor-invoice-precheck.sh"), 0o755);
  await chmod(path.join(cronScripts, "dripjobs-daily-sync.sh"), 0o755);
  await chmod(path.join(bin, "dripjobs-daily-sync-runner.mjs"), 0o755);
  await chmod(path.join(bin, "import-invoice-list-job-amounts.mjs"), 0o755);
  await chmod(path.join(bin, "import-dripjobs-sales-list.mjs"), 0o755);
  await chmod(path.join(emailProfileScripts, "contractor-invoice-precheck.sh"), 0o755);
  await chmod(path.join(cronScripts, "ops-health-monitor.mjs"), 0o755);
  await chmod(path.join(hermesScripts, "ops-health-monitor.sh"), 0o755);
  await chmod(path.join(agentHooks, "ottawa-tool-policy.py"), 0o755);
  await chmod(path.join(agentHooks, "ottawa-email-tool-policy.py"), 0o755);
  await chmod(path.join(emailProfileHooks, "ottawa-email-tool-policy.py"), 0o755);
  return { prefix: options.prefix, actions };
}

try {
  const result = await install(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Install failed: ${error.message}\n`);
  process.exitCode = 1;
}
