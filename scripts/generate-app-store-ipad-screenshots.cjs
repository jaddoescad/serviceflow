#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "qa-artifacts", "app-store-ios");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 2048;
const HEIGHT = 2732;

const theme = {
  ink: "#132522",
  muted: "#60746e",
  teal: "#1f8f8c",
  deep: "#145f4f",
  mint: "#eaf6f3",
  line: "#cfe0db",
  gold: "#c98b28",
  coral: "#df6f55",
  navy: "#273b55",
  paper: "#fbfdfb",
};

const screens = [
  {
    file: "ipad-13-01-assignments.png",
    eyebrow: "DAILY CREW VIEW",
    title: "Plan jobs, crews, and clock-ins together.",
    subtitle: "A clean operations view keeps assignments, job details, and crew status easy to scan before the day starts.",
    accent: theme.teal,
    preview: assignmentsPreview(),
  },
  {
    file: "ipad-13-02-clockin.png",
    eyebrow: "LOCATION-AWARE TIME",
    title: "Verify time at the right job site.",
    subtitle: "Field teams can clock in with project context, live location status, and a clear active-shift timer.",
    accent: theme.coral,
    preview: clockPreview(),
  },
  {
    file: "ipad-13-03-timesheets.png",
    eyebrow: "PAYROLL READY",
    title: "Review timesheets without chasing updates.",
    subtitle: "Weekly totals, daily entries, and adjusted time stay visible for faster review and payroll prep.",
    accent: theme.gold,
    preview: timesheetPreview(),
  },
  {
    file: "ipad-13-04-project-history.png",
    eyebrow: "PROJECT HISTORY",
    title: "See crew progress by project.",
    subtitle: "Project pages connect clock-ins, job-site status, hours, and recent field activity in one place.",
    accent: theme.navy,
    preview: projectPreview(),
  },
];

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (const screen of screens) {
      const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
      await page.setContent(renderScreen(screen), { waitUntil: "networkidle" });
      const outPath = path.join(OUT_DIR, screen.file);
      await page.screenshot({ path: outPath, type: "png" });
      await page.close();
      console.log(`Wrote ${path.relative(ROOT, outPath)}`);
    }
  } finally {
    await browser.close();
  }
}

function renderScreen(screen) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    body {
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      color: ${theme.ink};
      background: linear-gradient(135deg, #f4fbf8 0%, #eef7f4 45%, #f8f2e8 100%);
    }
    .stage {
      position: relative;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      padding: 142px 136px 118px;
    }
    .rail {
      position: absolute;
      left: 136px;
      top: 0;
      width: 15px;
      height: ${HEIGHT}px;
      background: linear-gradient(${screen.accent}, transparent 72%);
      opacity: .22;
    }
    .header {
      position: relative;
      z-index: 2;
      min-height: 720px;
      padding-left: 0;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 24px;
      font-size: 34px;
      font-weight: 850;
      letter-spacing: 0;
      color: ${screen.accent};
      margin-bottom: 38px;
    }
    .eyebrow:before {
      content: "";
      width: 76px;
      height: 9px;
      border-radius: 9px;
      background: ${screen.accent};
    }
    h1 {
      width: 1600px;
      margin: 0;
      color: ${theme.ink};
      font-size: 104px;
      line-height: 1;
      font-weight: 920;
      letter-spacing: 0;
    }
    .subtitle {
      width: 1490px;
      margin: 38px 0 0;
      color: ${theme.muted};
      font-size: 44px;
      line-height: 1.34;
      font-weight: 610;
      letter-spacing: 0;
    }
    .preview-wrap {
      position: absolute;
      left: 136px;
      right: 136px;
      bottom: 246px;
      height: 1358px;
      filter: drop-shadow(0 54px 74px rgba(19, 37, 34, .18));
      z-index: 2;
    }
    .tablet {
      width: 100%;
      height: 100%;
      border-radius: 78px;
      border: 7px solid rgba(19, 37, 34, .09);
      background: #fff;
      overflow: hidden;
      position: relative;
    }
    .tablet-top {
      height: 94px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      padding: 0 58px 18px;
      color: ${theme.ink};
      font-size: 28px;
      font-weight: 850;
      border-bottom: 2px solid rgba(207, 224, 219, .55);
      background: rgba(255, 255, 255, .96);
    }
    .status-icons {
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .sig {
      display: flex;
      align-items: flex-end;
      gap: 7px;
    }
    .sig span {
      display: block;
      width: 10px;
      border-radius: 8px;
      background: ${theme.ink};
    }
    .sig span:nth-child(1) { height: 15px; opacity: .65; }
    .sig span:nth-child(2) { height: 24px; opacity: .82; }
    .sig span:nth-child(3) { height: 33px; }
    .battery {
      width: 54px;
      height: 28px;
      border: 4px solid ${theme.ink};
      border-radius: 9px;
      position: relative;
    }
    .battery:before {
      content: "";
      position: absolute;
      right: -10px;
      top: 7px;
      width: 6px;
      height: 10px;
      border-radius: 3px;
      background: ${theme.ink};
    }
    .battery:after {
      content: "";
      position: absolute;
      left: 6px;
      top: 6px;
      width: 31px;
      height: 8px;
      border-radius: 5px;
      background: ${theme.ink};
    }
    .app {
      height: calc(100% - 94px);
      display: grid;
      grid-template-columns: 326px 1fr;
      background: #fff;
    }
    .sidebar {
      border-right: 2px solid ${theme.line};
      background: #f7fbfa;
      padding: 46px 36px;
    }
    .app-brand {
      display: flex;
      align-items: center;
      gap: 16px;
      color: ${theme.deep};
      font-size: 27px;
      font-weight: 900;
      margin-bottom: 58px;
    }
    .mark {
      width: 52px;
      height: 52px;
      border-radius: 15px;
      background: ${theme.deep};
      position: relative;
      overflow: hidden;
      flex: 0 0 auto;
    }
    .mark:before,
    .mark:after {
      content: "";
      position: absolute;
      left: 10px;
      right: 10px;
      height: 8px;
      border-radius: 99px;
      background: #fff;
      transform: rotate(18deg);
    }
    .mark:before { top: 16px; }
    .mark:after { top: 30px; }
    .nav-item {
      height: 74px;
      border-radius: 21px;
      display: flex;
      align-items: center;
      gap: 17px;
      padding: 0 20px;
      color: #7b8d88;
      font-size: 24px;
      font-weight: 830;
      margin-bottom: 17px;
    }
    .nav-item.active {
      color: #fff;
      background: ${theme.deep};
    }
    .nav-dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: currentColor;
      opacity: .95;
    }
    .content {
      padding: 48px 58px 44px;
      min-width: 0;
      position: relative;
    }
    .kicker {
      color: ${theme.teal};
      font-size: 24px;
      font-weight: 880;
      margin-bottom: 14px;
    }
    .content h2 {
      margin: 0 0 30px;
      font-size: 58px;
      line-height: 1;
      letter-spacing: 0;
      font-weight: 920;
      color: ${theme.ink};
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 22px;
    }
    .panel {
      border-radius: 32px;
      border: 2px solid ${theme.line};
      background: ${theme.paper};
      padding: 30px;
    }
    .panel.mint { background: ${theme.mint}; }
    .panel.dark {
      background: ${theme.deep};
      color: #fff;
      border-color: ${theme.deep};
    }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 22px;
      font-size: 31px;
      font-weight: 920;
      margin: 40px 0 22px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 134px;
      height: 50px;
      padding: 0 22px;
      border-radius: 999px;
      color: #fff;
      background: ${theme.teal};
      font-size: 19px;
      font-weight: 900;
      white-space: nowrap;
    }
    .pill.gold { background: ${theme.gold}; }
    .pill.coral { background: ${theme.coral}; }
    .row {
      min-height: 104px;
      border-radius: 27px;
      border: 2px solid ${theme.line};
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 22px;
      padding: 22px 26px;
      margin-bottom: 16px;
    }
    .avatar {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: ${theme.deep};
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 930;
      flex: 0 0 auto;
    }
    .row-main {
      min-width: 0;
      flex: 1 1 auto;
    }
    .row-title {
      font-size: 27px;
      font-weight: 920;
      color: ${theme.ink};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-meta {
      color: ${theme.muted};
      font-size: 21px;
      font-weight: 690;
      margin-top: 8px;
    }
    .map-card {
      position: relative;
      overflow: hidden;
      background: #eaf4f1;
      border-radius: 32px;
      border: 2px solid ${theme.line};
    }
    .map-card:before {
      content: "";
      position: absolute;
      inset: 24px;
      background-image:
        linear-gradient(#cfe0db 3px, transparent 3px),
        linear-gradient(90deg, #cfe0db 3px, transparent 3px);
      background-size: 92px 82px;
      opacity: .72;
    }
    .brand {
      position: absolute;
      left: 136px;
      bottom: 98px;
      display: flex;
      align-items: center;
      gap: 20px;
      color: ${theme.deep};
      font-size: 39px;
      font-weight: 900;
      z-index: 3;
    }
    .brand .mark {
      width: 58px;
      height: 58px;
      border-radius: 17px;
    }
  </style>
</head>
<body>
  <main class="stage">
    <div class="rail"></div>
    <section class="header">
      <div class="eyebrow">${escapeHtml(screen.eyebrow)}</div>
      <h1>${escapeHtml(screen.title)}</h1>
      <p class="subtitle">${escapeHtml(screen.subtitle)}</p>
    </section>
    <section class="preview-wrap">
      <div class="tablet">
        <div class="tablet-top">
          <span>9:41</span>
          <span class="status-icons"><span class="sig"><span></span><span></span><span></span></span><span class="battery"></span></span>
        </div>
        <div class="app">
          <aside class="sidebar">
            <div class="app-brand"><span class="mark"></span><span>ServiceFlow</span></div>
            ${navItem("Today", screen.file.includes("assignments"))}
            ${navItem("Projects", screen.file.includes("project"))}
            ${navItem("Clock In", screen.file.includes("clockin"))}
            ${navItem("Timesheet", screen.file.includes("timesheets"))}
          </aside>
          <section class="content">${screen.preview}</section>
        </div>
      </div>
    </section>
    <div class="brand"><span class="mark"></span><span>ServiceFlow Operations</span></div>
  </main>
</body>
</html>`;
}

function assignmentsPreview() {
  return `<div class="kicker">Crew operations</div>
  <h2>Today</h2>
  <div class="grid-3">
    ${metric("Assigned jobs", "3", theme.teal)}
    ${metric("Scheduled hours", "6.2", theme.gold)}
    ${metric("On-site crews", "2", theme.coral)}
  </div>
  <div class="section-title"><span>Assigned today</span><span class="pill gold">3 jobs</span></div>
  <div class="grid-2">
    <div>
      ${jobRow("JT", "Riverside repaint", "8:00 AM", "En route", "teal")}
      ${jobRow("MK", "Unit 4B walkthrough", "10:30 AM", "Ready", "coral")}
      ${jobRow("AL", "Exterior prep", "2:00 PM", "Scheduled", "teal")}
    </div>
    <div class="panel dark" style="height:344px">
      <div style="font-size:25px;font-weight:800;opacity:.78;margin-bottom:24px">Day summary</div>
      <div style="font-size:58px;font-weight:950;line-height:1.04">Everything due today stays visible.</div>
      <div style="font-size:25px;font-weight:680;opacity:.74;margin-top:24px">Search jobs, open project details, and start time tracking from the same place.</div>
    </div>
  </div>`;
}

function clockPreview() {
  return `<div class="kicker">Active shift</div>
  <h2>Riverside repaint</h2>
  <div class="grid-2" style="align-items:stretch">
    <div class="map-card" style="height:572px">
      <svg width="100%" height="100%" viewBox="0 0 820 572" style="position:absolute;inset:0">
        <path d="M-60 430 C160 335 360 170 760 35 L900 -30" stroke="#a9cec6" stroke-width="12" fill="none"/>
        <path d="M-60 460 C160 365 360 200 760 65 L900 0" stroke="#d9ebe6" stroke-width="12" fill="none"/>
        <path d="M-40 650 C205 510 454 438 880 292" stroke="#a9cec6" stroke-width="12" fill="none"/>
        <path d="M-40 680 C205 540 454 468 880 322" stroke="#d9ebe6" stroke-width="12" fill="none"/>
      </svg>
      <div style="position:absolute;left:50%;top:50%;width:96px;height:96px;border-radius:50%;background:${theme.teal};transform:translate(-50%,-50%);box-shadow:0 0 0 24px rgba(31,143,140,.16)"></div>
      <div style="position:absolute;left:50%;top:50%;width:22px;height:22px;border-radius:50%;background:white;transform:translate(-50%,-50%)"></div>
      <div style="position:absolute;left:42px;bottom:42px" class="pill">On site</div>
    </div>
    <div>
      <div class="panel mint" style="margin-bottom:26px">
        <div style="font-size:28px;font-weight:930">Job-site status</div>
        <div style="font-size:23px;font-weight:680;color:${theme.muted};margin-top:12px">Location captured near 245 Riverside Dr.</div>
      </div>
      <div class="panel dark" style="height:312px">
        <div style="font-size:27px;font-weight:800;opacity:.78">Clocked in</div>
        <div style="font-size:74px;font-weight:950;line-height:1;margin-top:31px">02:14:36</div>
        <div style="font-size:25px;font-weight:700;opacity:.75;margin-top:22px">Started 7:58 AM</div>
      </div>
      <div style="height:82px;border-radius:999px;background:${theme.coral};color:white;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:930;margin-top:28px">Clock out</div>
    </div>
  </div>`;
}

function timesheetPreview() {
  return `<div class="kicker">Timesheet review</div>
  <h2>This week</h2>
  <div class="grid-3">
    ${metric("Hours logged", "32.5", theme.deep)}
    ${metric("Entries", "9", theme.gold)}
    ${metric("Edited", "1", theme.coral)}
  </div>
  <div class="section-title"><span>Recent clock-ins</span><span class="pill coral">Review</span></div>
  ${timeRow("Today", "Riverside repaint", "7:58 AM - 10:12 AM", "2.2h", theme.teal)}
  ${timeRow("Today", "Unit 4B walkthrough", "10:45 AM - 1:30 PM", "2.8h", theme.gold)}
  ${timeRow("Friday", "Exterior prep", "8:02 AM - 3:22 PM", "7.3h", theme.navy)}
  ${timeRow("Thursday", "Riverside repaint", "8:15 AM - 4:05 PM", "7.8h", theme.teal)}
  <div class="panel mint" style="margin-top:26px;display:flex;align-items:center;gap:24px">
    <div style="width:56px;height:56px;border-radius:50%;background:${theme.gold}"></div>
    <div><div style="font-size:27px;font-weight:930">Edits are marked for review</div><div style="font-size:21px;font-weight:680;color:${theme.muted};margin-top:7px">Adjusted entries keep original time context visible to managers.</div></div>
  </div>`;
}

function projectPreview() {
  return `<div class="kicker">Project details</div>
  <h2>Riverside repaint</h2>
  <div class="grid-2" style="align-items:start">
    <div>
      <div class="map-card" style="height:338px;margin-bottom:24px">
        <svg width="100%" height="100%" viewBox="0 0 820 338" style="position:absolute;inset:0">
          <path d="M-30 266 L305 112 L575 148 L850 44" stroke="#b4d0c9" stroke-width="19" fill="none"/>
          <path d="M-60 118 L238 158 L498 84 L890 136" stroke="#d7e8e3" stroke-width="25" fill="none"/>
          <circle cx="437" cy="151" r="43" fill="${theme.teal}"/>
          <circle cx="437" cy="151" r="13" fill="#fff"/>
        </svg>
      </div>
      <div class="grid-3">
        ${metric("Clock-ins", "12", theme.teal)}
        ${metric("Crew hours", "41.4", theme.gold)}
        ${metric("Photos", "8", theme.navy)}
      </div>
    </div>
    <div>
      <div class="section-title" style="margin-top:0"><span>Crew activity</span><span class="pill">Open</span></div>
      ${activityRow("JT", "Clocked in on site", "Today - 7:58 AM", theme.teal)}
      ${activityRow("MK", "Uploaded progress photos", "Today - 9:26 AM", theme.navy)}
      ${activityRow("AL", "Completed prep task", "Yesterday - 3:18 PM", theme.gold)}
      <div style="height:82px;border-radius:999px;background:${theme.deep};color:white;display:flex;align-items:center;justify-content:center;font-size:29px;font-weight:930;margin-top:30px">Clock in to this job</div>
    </div>
  </div>`;
}

function navItem(label, active) {
  return `<div class="nav-item ${active ? "active" : ""}"><span class="nav-dot"></span><span>${label}</span></div>`;
}

function metric(label, value, color) {
  return `<div class="panel" style="padding:26px 28px">
    <div style="font-size:21px;font-weight:820;color:${color};margin-bottom:12px">${label}</div>
    <div style="font-size:49px;font-weight:950;color:${theme.ink};line-height:1">${value}</div>
  </div>`;
}

function jobRow(initials, title, time, status, color) {
  const pillClass = color === "coral" ? "coral" : "";
  return `<div class="row">
    <div class="avatar">${initials}</div>
    <div class="row-main"><div class="row-title">${title}</div><div class="row-meta">${time}</div></div>
    <div class="pill ${pillClass}">${status}</div>
  </div>`;
}

function timeRow(day, project, range, total, color) {
  return `<div class="row">
    <div style="width:13px;height:70px;border-radius:99px;background:${color};flex:0 0 auto"></div>
    <div class="row-main">
      <div style="font-size:20px;font-weight:900;color:${color};margin-bottom:6px">${day}</div>
      <div class="row-title">${project}</div>
      <div class="row-meta">${range}</div>
    </div>
    <div style="font-size:28px;font-weight:950">${total}</div>
  </div>`;
}

function activityRow(initials, title, meta, color) {
  return `<div class="row">
    <div class="avatar" style="background:${color}">${initials}</div>
    <div class="row-main"><div class="row-title">${title}</div><div class="row-meta">${meta}</div></div>
  </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
