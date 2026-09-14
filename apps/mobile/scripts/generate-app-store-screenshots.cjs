#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "qa-artifacts", "app-store-ios");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 1242;
const HEIGHT = 2688;

const theme = {
  ink: "#132522",
  muted: "#5f716c",
  teal: "#1f8f8c",
  deep: "#145f4f",
  mint: "#eaf6f3",
  line: "#cfe0db",
  gold: "#c98b28",
  coral: "#df6f55",
  navy: "#273b55",
};

const screens = [
  {
    file: "iphone-65-01-assignments.png",
    eyebrow: "DAILY CREW VIEW",
    title: "Run every job from one screen.",
    subtitle: "Assignments, project details, and clock-ins stay organized before the crew leaves the shop.",
    accent: theme.teal,
    phone: assignmentPhone(),
  },
  {
    file: "iphone-65-02-clockin.png",
    eyebrow: "LOCATION-AWARE TIME",
    title: "Clock in with job-site context.",
    subtitle: "Track hours against the right project with clear on-site status and one-tap clock out.",
    accent: theme.coral,
    phone: clockPhone(),
  },
  {
    file: "iphone-65-03-timesheets.png",
    eyebrow: "PAYROLL READY",
    title: "Timesheets without the mess.",
    subtitle: "Daily totals, week summaries, and time edits are easy to review from the field.",
    accent: theme.gold,
    phone: timesheetPhone(),
  },
  {
    file: "iphone-65-04-project-history.png",
    eyebrow: "PROJECT HISTORY",
    title: "See crew progress by job.",
    subtitle: "Project pages show clock-ins, painter hours, job details, and recent field activity.",
    accent: theme.navy,
    phone: projectPhone(),
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
      await page.screenshot({ path: path.join(OUT_DIR, screen.file), type: "png" });
      await page.close();
      console.log(`Wrote ${path.relative(ROOT, path.join(OUT_DIR, screen.file))}`);
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
      background:
        linear-gradient(135deg, #f5fbf9 0%, #edf7f4 46%, #f8f4ec 100%);
    }
    .stage {
      position: relative;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      padding: 138px 84px 84px;
    }
    .rail {
      position: absolute;
      left: 84px;
      top: 0;
      width: 12px;
      height: ${HEIGHT}px;
      background: linear-gradient(${screen.accent}, transparent 70%);
      opacity: .22;
    }
    .header {
      position: relative;
      z-index: 2;
      min-height: 650px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 18px;
      font-size: 28px;
      font-weight: 850;
      letter-spacing: 0;
      color: ${screen.accent};
      margin-bottom: 32px;
    }
    .eyebrow:before {
      content: "";
      width: 58px;
      height: 8px;
      border-radius: 8px;
      background: ${screen.accent};
    }
    h1 {
      width: 980px;
      margin: 0;
      color: ${theme.ink};
      font-size: 82px;
      line-height: 0.98;
      font-weight: 900;
      letter-spacing: 0;
    }
    .subtitle {
      width: 930px;
      margin: 34px 0 0;
      color: ${theme.muted};
      font-size: 34px;
      line-height: 1.34;
      font-weight: 590;
      letter-spacing: 0;
    }
    .brand {
      position: absolute;
      left: 84px;
      bottom: 72px;
      display: flex;
      align-items: center;
      gap: 20px;
      color: ${theme.deep};
      font-size: 36px;
      font-weight: 880;
      z-index: 3;
    }
    .brand-mark {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: ${theme.deep};
      position: relative;
      overflow: hidden;
    }
    .brand-mark:before,
    .brand-mark:after {
      content: "";
      position: absolute;
      left: 11px;
      right: 11px;
      height: 8px;
      border-radius: 99px;
      background: #fff;
      transform: rotate(18deg);
    }
    .brand-mark:before { top: 17px; }
    .brand-mark:after { top: 31px; }
    .phone-wrap {
      position: absolute;
      left: 50%;
      bottom: 188px;
      width: 760px;
      transform: translateX(-50%);
      filter: drop-shadow(0 48px 64px rgba(19, 37, 34, .18));
      z-index: 2;
    }
    .phone {
      position: relative;
      width: 760px;
      height: 1540px;
      border-radius: 92px;
      border: 6px solid rgba(19, 37, 34, .08);
      background: #fff;
      overflow: hidden;
    }
    .speaker {
      position: absolute;
      top: 31px;
      left: 50%;
      width: 170px;
      height: 44px;
      transform: translateX(-50%);
      border-radius: 0 0 28px 28px;
      background: #fff;
      z-index: 4;
    }
    .status {
      height: 80px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      padding: 0 50px 12px;
      font-size: 24px;
      font-weight: 850;
      color: ${theme.ink};
    }
    .sig {
      display: flex;
      align-items: flex-end;
      gap: 7px;
    }
    .sig span {
      display: block;
      width: 9px;
      border-radius: 8px;
      background: ${theme.ink};
    }
    .sig span:nth-child(1) { height: 14px; opacity: .65; }
    .sig span:nth-child(2) { height: 22px; opacity: .82; }
    .sig span:nth-child(3) { height: 30px; }
    .battery {
      width: 46px;
      height: 24px;
      border: 4px solid ${theme.ink};
      border-radius: 8px;
      position: relative;
      margin-left: 18px;
    }
    .battery:before {
      content: "";
      position: absolute;
      right: -9px;
      top: 6px;
      width: 5px;
      height: 9px;
      border-radius: 3px;
      background: ${theme.ink};
    }
    .battery:after {
      content: "";
      position: absolute;
      left: 5px;
      top: 5px;
      width: 25px;
      height: 7px;
      border-radius: 4px;
      background: ${theme.ink};
    }
    .screen {
      height: calc(100% - 80px);
      padding: 36px 48px 0;
      background: #fff;
    }
    .app-title {
      color: ${theme.teal};
      font-size: 24px;
      font-weight: 850;
      margin-bottom: 18px;
    }
    .screen h2 {
      margin: 0;
      color: ${theme.ink};
      font-size: 52px;
      line-height: 1.02;
      font-weight: 900;
      letter-spacing: 0;
    }
    .tabbar {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 118px;
      border-top: 2px solid ${theme.line};
      background: rgba(255,255,255,.94);
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      align-items: center;
      padding: 10px 30px 18px;
    }
    .tab {
      text-align: center;
      color: #8b9995;
      font-size: 20px;
      font-weight: 780;
    }
    .tab .dot {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: currentColor;
      margin: 0 auto 12px;
    }
    .tab.active { color: ${theme.deep}; }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 126px;
      padding: 13px 20px;
      border-radius: 999px;
      color: #fff;
      background: ${theme.teal};
      font-size: 17px;
      font-weight: 850;
      white-space: nowrap;
    }
    .pill.gold { background: ${theme.gold}; }
    .pill.coral { background: ${theme.coral}; }
    .card {
      border: 2px solid ${theme.line};
      background: ${theme.mint};
      border-radius: 30px;
    }
    .muted { color: ${theme.muted}; }
    .bottom-safe { height: 132px; }
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
    <section class="phone-wrap">
      <div class="phone">
        <div class="speaker"></div>
        <div class="status">
          <span>9:41</span>
          <span style="display:flex;align-items:center"><span class="sig"><span></span><span></span><span></span></span><span class="battery"></span></span>
        </div>
        ${screen.phone}
      </div>
    </section>
    <div class="brand"><span class="brand-mark"></span><span>ServiceFlow Operations</span></div>
  </main>
</body>
</html>`;
}

function assignmentPhone() {
  return `<div class="screen">
  <div class="app-title">ServiceFlow</div>
  <h2>Today</h2>
  <div style="height:26px"></div>
  <div class="card" style="height:82px;border-color:transparent;background:#f5f8f7;display:flex;align-items:center;padding:0 30px;color:#97a5a1;font-size:28px;font-weight:560">Search jobs</div>
  <div style="height:54px"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
    <div style="font-size:30px;font-weight:900">Assigned today</div>
    <div class="pill gold">3 jobs</div>
  </div>
  ${jobRow("JT", "Riverside repaint", "8:00 AM", "En route", "teal")}
  ${jobRow("MK", "Unit 4B walkthrough", "10:30 AM", "Ready", "coral")}
  ${jobRow("AL", "Exterior prep", "2:00 PM", "Scheduled", "teal")}
  <div style="height:40px"></div>
  <div style="border-radius:32px;background:${theme.deep};color:#fff;padding:34px 34px">
    <div style="font-size:22px;font-weight:750;opacity:.78;margin-bottom:13px">Day summary</div>
    <div style="font-size:32px;font-weight:900">6.2 scheduled hours</div>
    <div style="font-size:22px;font-weight:650;opacity:.72;margin-top:11px">2 active job sites nearby</div>
  </div>
  <div class="tabbar">
    <div class="tab active"><div class="dot"></div>Today</div><div class="tab"><div class="dot"></div>Jobs</div><div class="tab"><div class="dot"></div>Time</div><div class="tab"><div class="dot"></div>More</div>
  </div>
</div>`;
}

function clockPhone() {
  return `<div class="screen">
  <div class="app-title">Crew Member</div>
  <h2>Time tracking</h2>
  <div style="height:34px"></div>
  <div class="card" style="padding:24px 28px;display:flex;align-items:center;justify-content:space-between">
    <div><div style="font-size:28px;font-weight:900">Riverside repaint</div><div class="muted" style="font-size:22px;margin-top:8px;font-weight:640">Zone 2 · Active job</div></div>
    <div class="pill">On site</div>
  </div>
  <div style="height:34px"></div>
  <div class="card" style="height:330px;position:relative;overflow:hidden;background:#edf7f4">
    <div class="map-grid"></div>
    <div style="position:absolute;left:50%;top:49%;width:74px;height:74px;border-radius:50%;background:${theme.teal};transform:translate(-50%,-50%);box-shadow:0 0 0 18px rgba(31,143,140,.15)"></div>
    <div style="position:absolute;left:50%;top:49%;width:17px;height:17px;border-radius:50%;background:white;transform:translate(-50%,-50%)"></div>
    <svg width="100%" height="100%" style="position:absolute;inset:0" viewBox="0 0 660 330">
      <path d="M-40 260 C150 190 285 112 520 20 L720 -60" stroke="#abcfc7" stroke-width="5" fill="none"/>
      <path d="M-40 273 C150 203 285 125 520 33 L720 -47" stroke="#d9ebe6" stroke-width="5" fill="none"/>
      <path d="M-20 390 C155 315 362 245 680 170" stroke="#abcfc7" stroke-width="5" fill="none"/>
      <path d="M-20 404 C155 329 362 259 680 184" stroke="#d9ebe6" stroke-width="5" fill="none"/>
    </svg>
  </div>
  <style>.map-grid{position:absolute;inset:26px 24px;background-image:linear-gradient(#cfe0db 3px,transparent 3px),linear-gradient(90deg,#cfe0db 3px,transparent 3px);background-size:72px 64px;opacity:.8}</style>
  <div style="height:34px"></div>
  <div style="border-radius:32px;background:${theme.deep};color:white;padding:38px 40px">
    <div style="font-size:26px;font-weight:800;opacity:.78">Clocked in</div>
    <div style="font-size:64px;font-weight:950;line-height:1;margin-top:22px">02:14:36</div>
    <div style="font-size:24px;font-weight:680;opacity:.76;margin-top:16px">Started 7:58 AM · On site</div>
  </div>
  <div style="height:34px"></div>
  <div style="height:86px;border-radius:999px;background:${theme.teal};color:white;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900">Clock out</div>
  <div class="tabbar">
    <div class="tab"><div class="dot"></div>Today</div><div class="tab"><div class="dot"></div>Jobs</div><div class="tab active"><div class="dot"></div>Time</div><div class="tab"><div class="dot"></div>More</div>
  </div>
</div>`;
}

function timesheetPhone() {
  return `<div class="screen">
  <div class="app-title">ServiceFlow</div>
  <h2>Timesheet</h2>
  <div style="height:32px"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
    <div style="border-radius:28px;background:${theme.deep};color:#fff;padding:28px">
      <div style="font-size:20px;font-weight:740;opacity:.75">This week</div>
      <div style="font-size:44px;font-weight:950;margin-top:12px">32.5h</div>
    </div>
    <div style="border-radius:28px;background:#fff5e7;border:2px solid #efd3a1;color:${theme.ink};padding:28px">
      <div style="font-size:20px;font-weight:760;color:${theme.gold}">Entries</div>
      <div style="font-size:44px;font-weight:950;margin-top:12px">9</div>
    </div>
  </div>
  <div style="height:36px"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px">
    <div style="font-size:30px;font-weight:900">Recent clock-ins</div>
    <div class="pill coral">Review</div>
  </div>
  ${timeRow("Today", "Riverside repaint", "7:58 AM - 10:12 AM", "2.2h", theme.teal)}
  ${timeRow("Today", "Unit 4B walkthrough", "10:45 AM - 1:30 PM", "2.8h", theme.gold)}
  ${timeRow("Friday", "Exterior prep", "8:02 AM - 3:22 PM", "7.3h", theme.navy)}
  ${timeRow("Thursday", "Riverside repaint", "8:15 AM - 4:05 PM", "7.8h", theme.teal)}
  <div style="height:28px"></div>
  <div style="border-radius:30px;background:#f5f8f7;border:2px solid ${theme.line};padding:26px 30px;display:flex;align-items:center;gap:22px">
    <div style="width:48px;height:48px;border-radius:50%;background:${theme.gold}"></div>
    <div><div style="font-size:23px;font-weight:900">Edits are marked</div><div class="muted" style="font-size:19px;font-weight:650;margin-top:5px">Adjusted entries stay visible for review.</div></div>
  </div>
  <div class="tabbar">
    <div class="tab"><div class="dot"></div>Today</div><div class="tab"><div class="dot"></div>Jobs</div><div class="tab active"><div class="dot"></div>Time</div><div class="tab"><div class="dot"></div>More</div>
  </div>
</div>`;
}

function projectPhone() {
  return `<div class="screen">
  <div class="app-title">Projects</div>
  <h2>Riverside repaint</h2>
  <div class="muted" style="font-size:22px;font-weight:660;margin-top:14px">245 Riverside Dr · Ottawa</div>
  <div style="height:30px"></div>
  <div style="height:260px;border-radius:32px;overflow:hidden;background:#e8f2ef;position:relative;border:2px solid ${theme.line}">
    <svg width="100%" height="100%" viewBox="0 0 660 260">
      <rect width="660" height="260" fill="#eaf4f1"/>
      <path d="M10 205 L250 90 L470 118 L650 34" stroke="#b4d0c9" stroke-width="16" fill="none"/>
      <path d="M-20 92 L190 126 L390 62 L690 105" stroke="#d7e8e3" stroke-width="22" fill="none"/>
      <circle cx="352" cy="116" r="35" fill="${theme.teal}"/>
      <circle cx="352" cy="116" r="11" fill="#fff"/>
    </svg>
  </div>
  <div style="height:28px"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
    ${statBox("12", "clock-ins")}
    ${statBox("41.4", "crew hours")}
    ${statBox("8", "photos")}
  </div>
  <div style="height:34px"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <div style="font-size:30px;font-weight:900">Crew activity</div>
    <div class="pill">Open</div>
  </div>
  ${activityRow("JT", "Clocked in on site", "Today · 7:58 AM", theme.teal)}
  ${activityRow("MK", "Uploaded progress photos", "Today · 9:26 AM", theme.navy)}
  ${activityRow("AL", "Completed prep task", "Yesterday · 3:18 PM", theme.gold)}
  <div style="height:30px"></div>
  <div style="height:82px;border-radius:999px;background:${theme.deep};color:white;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900">Clock in to this job</div>
  <div class="tabbar">
    <div class="tab"><div class="dot"></div>Today</div><div class="tab active"><div class="dot"></div>Jobs</div><div class="tab"><div class="dot"></div>Time</div><div class="tab"><div class="dot"></div>More</div>
  </div>
</div>`;
}

function jobRow(initials, title, time, status, color) {
  const pillClass = color === "coral" ? "coral" : "";
  return `<div class="card" style="height:118px;padding:0 24px 0 26px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:22px;min-width:0">
      <div style="width:58px;height:58px;border-radius:50%;background:${theme.deep};color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900">${initials}</div>
      <div style="min-width:0"><div style="font-size:26px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px">${title}</div><div class="muted" style="font-size:21px;font-weight:650;margin-top:7px">${time}</div></div>
    </div>
    <div class="pill ${pillClass}">${status}</div>
  </div>`;
}

function timeRow(day, project, range, total, color) {
  return `<div style="height:112px;border-radius:26px;border:2px solid ${theme.line};background:#fff;padding:20px 24px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;gap:20px;align-items:center;min-width:0">
      <div style="width:12px;height:70px;border-radius:99px;background:${color}"></div>
      <div style="min-width:0"><div style="font-size:18px;font-weight:850;color:${color};margin-bottom:5px">${day}</div><div style="font-size:24px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px">${project}</div><div class="muted" style="font-size:18px;font-weight:650;margin-top:5px">${range}</div></div>
    </div>
    <div style="font-size:24px;font-weight:950;color:${theme.ink}">${total}</div>
  </div>`;
}

function statBox(value, label) {
  return `<div style="border-radius:24px;background:#f5f8f7;border:2px solid ${theme.line};padding:22px 18px;text-align:center">
    <div style="font-size:32px;font-weight:950">${value}</div>
    <div class="muted" style="font-size:16px;font-weight:760;margin-top:7px">${label}</div>
  </div>`;
}

function activityRow(initials, title, meta, color) {
  return `<div style="height:104px;border-radius:26px;border:2px solid ${theme.line};background:#fff;padding:18px 22px;margin-bottom:16px;display:flex;align-items:center;gap:20px">
    <div style="width:56px;height:56px;border-radius:50%;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:900">${initials}</div>
    <div><div style="font-size:23px;font-weight:900">${title}</div><div class="muted" style="font-size:18px;font-weight:660;margin-top:6px">${meta}</div></div>
  </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
