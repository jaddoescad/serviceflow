#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const INCLUDE_LOCAL_ENV = process.env.QA_SCAN_LOCAL_ENV === "1";
const SAFE_EMPTY_OR_PLACEHOLDER =
  /^(|your[_-].*|replace_me|replace_with_.*|change.?me|example.*|placeholder.*|todo|<.*>)$/i;
const SENSITIVE_KEY =
  /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|ADMIN_TOKEN|API_KEY|CLIENT_SECRET)/i;
const PUBLIC_KEY = /^(EXPO_PUBLIC_|SUPABASE_PUBLISHABLE_KEY$|SUPABASE_ANON_KEY$)/i;
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".env",
  ".example",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".plist",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yml",
  ".yaml",
]);

main();

function main() {
  const files = new Set(listTrackedFiles());

  if (INCLUDE_LOCAL_ENV) {
    for (const fileName of [".env", ".env.local"]) {
      if (fs.existsSync(path.join(ROOT, fileName))) files.add(fileName);
    }
  }

  const findings = [];
  for (const filePath of files) {
    if (!shouldScan(filePath)) continue;

    if (isTrackedEnvFile(filePath)) {
      findings.push({
        file: filePath,
        line: 1,
        rule: "tracked-env-file",
        detail: "Environment files with real credentials must not be tracked.",
      });
    }

    const absolutePath = path.join(ROOT, filePath);
    if (!fs.existsSync(absolutePath)) continue;

    const text = fs.readFileSync(absolutePath, "utf8");
    scanTextFile(filePath, text, findings);
  }

  if (findings.length) {
    console.error("Secret scan failed. Review these findings before deploying:");
    for (const finding of findings) {
      console.error(
        `- ${finding.file}:${finding.line} [${finding.rule}] ${finding.detail}`,
      );
    }
    process.exit(1);
  }

  console.log(
    INCLUDE_LOCAL_ENV
      ? "No tracked or local env secret findings detected."
      : "No tracked secret findings detected. Set QA_SCAN_LOCAL_ENV=1 to scan ignored local env files too.",
  );
}

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output.split("\0").filter(Boolean);
}

function shouldScan(filePath) {
  const baseName = path.basename(filePath);
  if (baseName === ".env.example") return true;
  if (baseName.startsWith(".env")) return true;
  if (filePath.includes("/Pods/")) return false;
  if (filePath.includes("/node_modules/")) return false;
  if (filePath.endsWith("package-lock.json")) return false;
  return TEXT_EXTENSIONS.has(path.extname(filePath));
}

function isTrackedEnvFile(filePath) {
  const baseName = path.basename(filePath);
  return baseName.startsWith(".env") && baseName !== ".env.example";
}

function scanTextFile(filePath, text, findings) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const assignment = line.match(/^\s*([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|ADMIN_TOKEN|API_KEY|CLIENT_SECRET)[A-Z0-9_]*)\s*=\s*['"]?([^'"#\s]+)?/);
    if (!assignment) return;

    const key = assignment[1];
    const value = assignment[2] || "";
    if (PUBLIC_KEY.test(key)) return;
    if (!SENSITIVE_KEY.test(key)) return;
    if (SAFE_EMPTY_OR_PLACEHOLDER.test(value)) return;

    findings.push({
      file: filePath,
      line: index + 1,
      rule: "sensitive-env-assignment",
      detail: `${key} has a non-placeholder value.`,
    });
  });
}
