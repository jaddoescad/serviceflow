#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

loadEnvFile(".env");
loadEnvFile(".env.local");

const ROOT = process.cwd();
const APP_URL = process.env.QA_WEB_URL || "http://localhost:19006";
const QA_EMAIL = process.env.QA_EMAIL || "";
const QA_PASSWORD = process.env.QA_PASSWORD || "";
const QA_PROJECT_SEARCH = process.env.QA_PROJECT_SEARCH || "";
const QA_DESTRUCTIVE_PROJECT_SEARCH =
  process.env.QA_DESTRUCTIVE_PROJECT_SEARCH || QA_PROJECT_SEARCH;
const QA_DESTRUCTIVE_PROJECT_NAME =
  process.env.QA_DESTRUCTIVE_PROJECT_NAME || "QA Web Smoke Test Project - Do Not Use";
const ALLOW_DESTRUCTIVE = process.env.QA_ALLOW_DESTRUCTIVE === "1";
const FAIL_ON_WARNINGS = process.env.QA_FAIL_ON_WARNINGS === "1";
const CHROME_CHANNEL = process.env.QA_CHROME_CHANNEL || "chrome";
const ARTIFACT_ROOT = path.join(ROOT, "qa-artifacts");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const ARTIFACT_DIR = path.join(ARTIFACT_ROOT, `web-smoke-${RUN_ID}`);

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  appUrl: APP_URL,
  chromeChannel: CHROME_CHANNEL,
  authenticated: Boolean(QA_EMAIL && QA_PASSWORD),
  destructiveEnabled: ALLOW_DESTRUCTIVE,
  results: [],
  console: [],
  pageErrors: [],
  requestFailures: [],
  screenshots: [],
};

main().catch(async (error) => {
  addResult("fatal", "failed", error.message || String(error));
  await writeReport();
  console.error(error.stack || error.message || error);
  process.exit(1);
});

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: CHROME_CHANNEL, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    geolocation: { latitude: 45.4215, longitude: -75.6972 },
    permissions: ["geolocation"],
  });

  const page = await context.newPage();
  attachDiagnostics(page);

  try {
    await runUnauthenticatedChecks(page);

    if (QA_EMAIL && QA_PASSWORD) {
      await runAuthenticatedChecks(page);
    } else {
      addResult(
        "authenticated checks",
        "skipped",
        "Set QA_EMAIL and QA_PASSWORD for a dedicated production QA user.",
      );
    }

    await runResponsiveChecks(browser);
  } finally {
    await browser.close();
  }

  const hasErrors =
    report.results.some((result) => result.status === "failed") ||
    report.pageErrors.length > 0 ||
    report.console.some((entry) => entry.type === "error" && !entry.expected) ||
    (FAIL_ON_WARNINGS && report.console.some((entry) => entry.type === "warning"));

  await writeReport();
  printSummary();
  process.exit(hasErrors ? 1 : 0);
}

async function runUnauthenticatedChecks(page) {
  await gotoApp(page);
  await expectVisible(page, "Email Address", "login email field");
  await expectVisible(page, "Password", "login password field");
  await expectVisible(page, "Log In", "login button");
  await screenshot(page, "login");

  await fillLogin(page, `qa-invalid-${Date.now()}@paintersottawa.com`, "not-a-real-password");
  await clickText(page, "Log In");
  const invalidVisible = await waitForText(page, /Invalid|credential|not confirmed|unable/i, 12_000);
  addResult(
    "invalid login",
    invalidVisible ? "passed" : "failed",
    invalidVisible
      ? "Invalid credentials surfaced an error message."
      : "No invalid-login error appeared before timeout.",
  );
  await screenshot(page, "invalid-login");
}

async function runAuthenticatedChecks(page) {
  await fillLogin(page, QA_EMAIL, QA_PASSWORD);
  await clickText(page, "Log In");

  const reachedApp = await waitForAnyText(page, [
    /Clock In/i,
    /Projects/i,
    /Timesheet/i,
  ], 30_000);

  addResult(
    "valid login",
    reachedApp ? "passed" : "failed",
    reachedApp ? "QA user reached an app state." : "QA user did not leave the login flow.",
  );
  await screenshot(page, "after-login");

  await expectVisible(page, "Clock In", "clock tab");
  await expectVisible(page, "Projects", "projects tab");
  await expectVisible(page, "Timesheet", "timesheet tab");
  await expectVisible(page, "More", "more tab");

  await screenshot(page, "clock-tab");
  await optionalProjectSearch(page);
  await clickTab(page, "Projects");
  await expectVisible(page, "Projects", "projects screen");
  await screenshot(page, "projects-tab");

  await clickTab(page, "Timesheet");
  await expectVisible(page, "This Week", "timesheet screen");
  await screenshot(page, "timesheet-tab");

  await clickTab(page, "More");
  await expectVisible(page, "Signed in as", "more screen");
  await screenshot(page, "more-tab");

  await page.reload({ waitUntil: "domcontentloaded" });
  const sessionPersisted = await waitForAnyText(page, [/Clock In/i, /Projects/i], 20_000);
  addResult(
    "session persistence",
    sessionPersisted ? "passed" : "failed",
    sessionPersisted ? "Reload kept the QA session." : "Reload returned to an unexpected state.",
  );
  await screenshot(page, "after-reload");

  if (ALLOW_DESTRUCTIVE) {
    await runDestructiveClockInCheck(page);
  } else {
    addResult(
      "clock in/out write path",
      "skipped",
      "Set QA_ALLOW_DESTRUCTIVE=1 with a QA-only account to create and delete production test time entries.",
    );
  }
}

async function optionalProjectSearch(page) {
  if (!QA_PROJECT_SEARCH) {
    addResult("project search", "skipped", "Set QA_PROJECT_SEARCH to exercise project search.");
    return;
  }

  await clickTab(page, "Clock In");
  const search = page.getByPlaceholder("Search projects").first();
  if (!(await search.isVisible().catch(() => false))) {
    addResult("project search", "skipped", "Clock-in project search input was not visible.");
    return;
  }

  await search.fill(QA_PROJECT_SEARCH);
  await page.waitForTimeout(900);
  await screenshot(page, "clock-project-search");
  addResult("project search", "passed", `Searched for "${QA_PROJECT_SEARCH}".`);
}

async function runDestructiveClockInCheck(page) {
  if (!/qa|test/i.test(QA_EMAIL) && process.env.QA_ALLOW_NON_QA_DESTRUCTIVE !== "1") {
    addResult(
      "clock in/out write path",
      "skipped",
      "QA_EMAIL does not look like a QA/test account. Set QA_ALLOW_NON_QA_DESTRUCTIVE=1 to override.",
    );
    return;
  }

  if (!/qa|test/i.test(QA_DESTRUCTIVE_PROJECT_NAME) || !QA_DESTRUCTIVE_PROJECT_SEARCH) {
    addResult(
      "clock in/out write path",
      "skipped",
      "Destructive checks require QA_DESTRUCTIVE_PROJECT_SEARCH and a QA/test project name.",
    );
    return;
  }

  await clickTab(page, "Clock In");
  const selected = await selectDestructiveProject(page);
  if (!selected) {
    addResult(
      "clock in/out write path",
      "failed",
      `Could not select QA project "${QA_DESTRUCTIVE_PROJECT_NAME}".`,
    );
    await screenshot(page, "destructive-project-select-failed");
    return;
  }

  await page.getByLabel("Start clock in").click({ timeout: 10_000 });
  const clockedIn = await waitForText(page, /Clock Out/i, 20_000);
  addResult(
    "clock in",
    clockedIn ? "passed" : "failed",
    clockedIn ? "Clock-in created an active shift." : "Clock Out did not appear after clock-in.",
  );
  await screenshot(page, "after-clock-in");

  if (!clockedIn) return;

  await page.getByLabel("Clock out current shift").click({ timeout: 10_000 });
  const clockedOut = await waitForText(page, /Clock In/i, 20_000);
  addResult(
    "clock out",
    clockedOut ? "passed" : "failed",
    clockedOut ? "Clock-out returned to the clock-in state." : "Clock-in state did not clear after clock-out.",
  );
  await screenshot(page, "after-clock-out");
}

async function selectDestructiveProject(page) {
  const search = page.getByPlaceholder("Search projects").first();
  if (!(await search.isVisible().catch(() => false))) return false;

  await search.fill(QA_DESTRUCTIVE_PROJECT_SEARCH);
  const found = await waitForText(page, new RegExp(escapeRegExp(QA_DESTRUCTIVE_PROJECT_NAME)), 15_000);
  if (!found) return false;

  await page.getByText(QA_DESTRUCTIVE_PROJECT_NAME, { exact: true }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  return textVisible(page, QA_DESTRUCTIVE_PROJECT_NAME, 5_000);
}

async function runResponsiveChecks(browser) {
  const viewports = [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    attachDiagnostics(page);
    await gotoApp(page);
    const visible = await textVisible(page, "Email Address");
    addResult(
      `responsive login ${viewport.name}`,
      visible ? "passed" : "failed",
      `${viewport.width}x${viewport.height}`,
    );
    await screenshot(page, `responsive-${viewport.name}-login`);
    await context.close();
  }
}

async function gotoApp(page) {
  const response = await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!response || !response.ok()) {
    throw new Error(`Unable to load ${APP_URL}. Start the app with npm run qa:web first.`);
  }
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}

function attachDiagnostics(page) {
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const entry = {
      type: message.type(),
      text: message.text(),
      location: message.location(),
    };
    entry.expected = isExpectedConsoleDiagnostic(entry);
    report.console.push(entry);
  });

  page.on("pageerror", (error) => {
    report.pageErrors.push(error.message || String(error));
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure();
    report.requestFailures.push({
      url: request.url(),
      method: request.method(),
      errorText: failure?.errorText || "request failed",
    });
  });
}

function isExpectedConsoleDiagnostic(entry) {
  return (
    entry.type === "error" &&
    entry.text.includes("Failed to load resource") &&
    String(entry.location?.url || "").includes("/auth/v1/token?grant_type=password")
  );
}

async function fillLogin(page, email, password) {
  await page.getByPlaceholder("name@paintersottawa.com").fill(email);
  await page.getByPlaceholder("Password").fill(password);
}

async function clickTab(page, label) {
  await clickText(page, label);
  await page.waitForTimeout(500);
}

async function clickText(page, label) {
  await page.getByText(label, { exact: true }).last().click({ timeout: 10_000 });
}

async function expectVisible(page, text, label) {
  const visible = await textVisible(page, text, 15_000);
  addResult(label, visible ? "passed" : "failed", visible ? `${text} visible.` : `${text} not visible.`);
  return visible;
}

async function textVisible(page, text, timeout = 1_000) {
  const locator = page.getByText(text, { exact: true });
  await locator.last().waitFor({ state: "visible", timeout }).catch(() => null);
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function waitForText(page, pattern, timeout) {
  return page
    .waitForFunction(
      (source) => new RegExp(source, "i").test(document.body.innerText || ""),
      pattern.source,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

async function waitForAnyText(page, patterns, timeout) {
  return page
    .waitForFunction(
      (sources) => sources.some((source) => new RegExp(source, "i").test(document.body.innerText || "")),
      patterns.map((pattern) => pattern.source),
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

async function screenshot(page, name) {
  const fileName = `${slug(name)}.png`;
  const filePath = path.join(ARTIFACT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  report.screenshots.push(filePath);
}

function addResult(name, status, detail) {
  report.results.push({
    name,
    status,
    detail,
    at: new Date().toISOString(),
  });
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.summary = summarizeResults();
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

function printSummary() {
  const summary = summarizeResults();
  console.log(`Web smoke report: ${path.join(ARTIFACT_DIR, "report.json")}`);
  console.log(
    `Results: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped.`,
  );
  console.log(
    `Diagnostics: ${report.console.length} console warnings/errors, ${report.pageErrors.length} page errors, ${report.requestFailures.length} failed requests.`,
  );
}

function summarizeResults() {
  return report.results.reduce(
    (summary, result) => {
      summary[result.status] = (summary[result.status] || 0) + 1;
      return summary;
    },
    { passed: 0, failed: 0, skipped: 0 },
  );
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
