#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildDripJobsProjectIdentity } from "./lib/dripjobs-job-identity.mjs";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const jobsArchivePath = path.resolve(
  repoRoot,
  "tmp/dripjobs-export/2026-07-31/jobs.normalized.json",
);
const apply = process.argv.includes("--apply");
const includeDetails = process.argv.includes("--details");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

function normalized(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bnorth\b/g, "n")
    .replace(
      /\b(street|st\.?|road|rd\.?|avenue|ave\.?|crescent|cres\.?|court|ct\.?|drive|dr\.?|boulevard|blvd\.?|private|pvt\.?|lane|ln\.?|way|terrace|terr\.?)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(left, right) {
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const upper = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = upper;
    }
  }
  return previous[right.length];
}

function isoDate(value) {
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function dateDistance(left, right) {
  return Math.round(
    (new Date(`${left}T12:00:00Z`) - new Date(`${right}T12:00:00Z`)) /
      86_400_000,
  );
}

function nameParts(job) {
  const full = normalized(job.customer_name || job.job_name);
  const words = full.split(" ").filter(Boolean);
  return {
    full,
    first: words[0] ?? "",
    last: words.at(-1) ?? "",
    address: normalized(job.address),
  };
}

function addressParts(value) {
  const tokens = normalized(value).split(" ").filter(Boolean);
  if (!/^\d+[a-z]?$/.test(tokens[0] ?? "")) {
    return { civic: "", streetTokens: [], compactStreet: "" };
  }
  const cityTokens = new Set([
    "ottawa",
    "gatineau",
    "orleans",
    "nepean",
    "russell",
    "casselman",
    "greely",
    "gloucester",
    "kanata",
    "stittsville",
    "rockland",
    "clarence",
  ]);
  const cityIndex = tokens.findIndex((token, index) => index > 0 && cityTokens.has(token));
  const streetTokens = tokens.slice(1, cityIndex > 1 ? cityIndex : undefined);
  return {
    civic: tokens[0],
    streetTokens,
    compactStreet: streetTokens.join(""),
  };
}

function addressScore(po, address) {
  const poAddress = addressParts(po);
  const jobAddress = addressParts(address);
  if (
    !poAddress.civic ||
    poAddress.civic !== jobAddress.civic ||
    poAddress.compactStreet.length < 3 ||
    jobAddress.compactStreet.length < 3
  ) {
    return 0;
  }
  const comparableJobStreet = jobAddress.streetTokens
    .slice(0, poAddress.streetTokens.length)
    .join("");
  if (
    poAddress.compactStreet === comparableJobStreet ||
    comparableJobStreet.includes(poAddress.compactStreet) ||
    poAddress.compactStreet.includes(comparableJobStreet)
  ) {
    return 100;
  }
  const distance = levenshtein(poAddress.compactStreet, comparableJobStreet);
  const maxDistance = Math.max(poAddress.compactStreet.length, comparableJobStreet.length) >= 8 ? 2 : 1;
  if (distance <= maxDistance) return 96;
  const sharedStreetToken = poAddress.streetTokens.some(
    (token) => token.length >= 4 && jobAddress.streetTokens.includes(token),
  );
  return sharedStreetToken ? 92 : 0;
}

function fuzzyFullNameScore(po, fullName) {
  const poTokens = po.split(" ").filter(Boolean);
  const nameTokens = fullName.split(" ").filter(Boolean);
  if (poTokens.length < 2 || nameTokens.length < 2) return 0;
  const distances = poTokens.map((poToken) =>
    Math.min(...nameTokens.map((nameToken) => levenshtein(poToken, nameToken))),
  );
  if (distances[0] <= 1 && distances.every((distance) => distance <= 1)) return 91;
  return 0;
}

function baseScore(po, job) {
  const names = nameParts(job);
  const compactPo = po.replace(/\s+/g, "");
  const compactLast = names.last.replace(/\s+/g, "");
  if (!po) return { score: 0, method: "customer_exact" };
  const matchedAddressScore = addressScore(po, job.address);
  if (matchedAddressScore) return { score: matchedAddressScore, method: "address_exact" };
  if (po === names.full) return { score: 100, method: "customer_exact" };
  if (po === names.last) return { score: 92, method: "customer_exact" };
  if (po === names.first && po.length >= 4) {
    return { score: 76, method: "customer_exact" };
  }
  if (
    po.length >= 5 &&
    (names.full.includes(po) ||
      po.includes(names.full) ||
      (names.last.length >= 4 && po.includes(names.last)))
  ) {
    return { score: 88, method: "customer_exact" };
  }
  if (
    compactPo.length >= 6 &&
    compactLast.length >= 6 &&
    levenshtein(compactPo, compactLast) <= 1
  ) {
    return { score: 86, method: "customer_exact" };
  }
  const fullNameFuzzy = fuzzyFullNameScore(po, names.full);
  if (fullNameFuzzy) return { score: fullNameFuzzy, method: "customer_exact" };
  const poLast = po.split(" ").at(-1) ?? "";
  if (poLast.length >= 5 && names.last.length >= 5) {
    const distance = levenshtein(poLast, names.last);
    if (distance === 1) return { score: 86, method: "customer_exact" };
    if (distance === 2 && Math.max(poLast.length, names.last.length) >= 7) {
      return { score: 80, method: "customer_exact" };
    }
  }
  return { score: 0, method: "customer_exact" };
}

function temporalScore(invoiceDate, job) {
  const started = isoDate(job.job_start_date);
  const completed = isoDate(job.job_completion_date);
  const created = isoDate(job.proposal_created_date);
  if (started && completed) {
    const fromStart = dateDistance(invoiceDate, started);
    const fromCompletion = dateDistance(invoiceDate, completed);
    if (fromStart >= 0 && fromCompletion <= 0) return 45;
    if (fromStart >= -7 && fromStart < 0) return 30;
    if (fromStart >= -21 && fromStart < -7) return 18;
    if (fromCompletion > 0 && fromCompletion <= 14) return 25;
    if (fromStart >= -45 && fromCompletion <= 45) return 10;
    return -35;
  }
  if (started) {
    const fromStart = dateDistance(invoiceDate, started);
    if (fromStart >= 0 && fromStart <= 60) return 35;
    if (fromStart >= -7 && fromStart < 0) return 25;
    if (fromStart >= -21 && fromStart < -7) return 15;
    if (fromStart < -45) return -20;
  }
  if (created) {
    const fromCreated = dateDistance(invoiceDate, created);
    if (fromCreated >= 0 && fromCreated <= 240) return 8;
    if (fromCreated < -14) return -25;
  }
  return 0;
}

function matchInvoice(invoice, jobs, projectIdByProposal, projectsById) {
  const po = normalized(invoice.po_number);
  if (!po) return { kind: "unmatched", reason: "PO missing", candidates: [] };
  if (["supplies", "shop supplies", "office supplies"].includes(po)) {
    return {
      kind: "overhead",
      category: "Shop supplies",
      method: "overhead_rule",
      confidence: 1,
      candidates: [],
    };
  }
  const auditedDirectProjects = new Map([
    [
      "sherwin_daily_email|8970-1|2026-07-31",
      {
        projectId: "105848213",
        customerName: "Shezara Ali",
        proposalId: "2873427",
        note:
          "Gmail 19fb9dc9e6a1c167 confirms DripJobs proposal 2873427 was accepted for Shezara Ali on 2026-07-31; this same-day Sherwin invoice uses PO ALI, while CompanyCam project 105848213 is the current unarchived Shezara Ali job at 314 Central Park Dr #805",
      },
    ],
  ]);
  const auditedDirectProject = auditedDirectProjects.get(
    `${invoice.source_system}|${invoice.invoice_number}|${invoice.invoice_date}`,
  );
  if (auditedDirectProject) {
    const project = projectsById.get(auditedDirectProject.projectId);
    if (
      !project ||
      normalized(project.name) !== normalized(auditedDirectProject.customerName) ||
      project.is_deleted ||
      project.is_lead ||
      project.is_archived
    ) {
      throw new Error(
        `Audited material invoice ${invoice.invoice_number} no longer has the expected active CompanyCam project ${auditedDirectProject.projectId}.`,
      );
    }
    const job = {
      customer_name: auditedDirectProject.customerName,
      address: project.formatted_address,
      proposal_id: auditedDirectProject.proposalId,
      proposal_uuid: null,
      job_start_date: "N/A",
      job_completion_date: "N/A",
    };
    return {
      kind: "matched",
      job,
      projectId: project.companycam_id,
      method: "manual",
      confidence: 1,
      source: "gmail_dripjobs_acceptance_and_companycam_project",
      sourcePayload: {
        gmail_message_id: "19fb9dc9e6a1c167",
        companycam_project_id: project.companycam_id,
      },
      base: 100,
      temporal: 27,
      score: 127,
      matchingNote: auditedDirectProject.note,
      candidates: [
        {
          job,
          projectId: project.companycam_id,
          method: "manual",
          base: 100,
          temporal: 27,
          score: 127,
        },
      ],
    };
  }
  const auditedInvoiceProjects = new Map([
    [
      "gmail_decorators_choice_receipt|401120|2026-05-12",
      {
        proposalId: "2649627",
        note:
          "Gmail 19e2142f0e120e13 confirms Joelle Moncrieff's May 13 change order for DripJobs proposal 2649627; this Benjamin Moore receipt and Sherwin invoice 4719-5 share PO JOELLE and OC-45 Swiss Coffee immediately before the May 14 job start",
      },
    ],
    [
      "sherwin_daily_email|4719-5|2026-05-13",
      {
        proposalId: "2649627",
        note:
          "Gmail 19e2142f0e120e13 confirms Joelle Moncrieff's May 13 change order for DripJobs proposal 2649627; this invoice and Decorator's Choice receipt 401120 share PO JOELLE and OC-45 Swiss Coffee immediately before the May 14 job start",
      },
    ],
    [
      "sherwin_daily_email|2957-6|2025-10-22",
      {
        proposalId: "2002074",
        note:
          "Gmail 1997c4a727e12927 confirms Michelle Fotheringham accepted DripJobs proposal 2002074; this Sherwin invoice uses PO MICHELLE on 2025-10-22, three days before the verified 2025-10-25 job date",
      },
    ],
    [
      "sherwin_daily_email|2676-3|2025-11-01",
      {
        proposalId: "1865720",
        note:
          "This Sherwin invoice uses PO NICOLE and SW6211 Rainwashed on 2025-11-01, two days before the verified Nicole Richard job for DripJobs proposal 1865720; Gmail 19a4b8331eedb626 confirms Nicole's completion and payment on 2025-11-03",
      },
    ],
    [
      "sherwin_daily_email|1269-2|2026-02-09",
      {
        proposalId: "2373270",
        note:
          "Gmail 19bebb99d7a1f0f4 is Darlene's colour consultation for Natasha Kawam and specifies SW6460 Kale Green; this Sherwin invoice uses PO NATASHA and contains Kale Green during the verified DripJobs proposal 2373270 job window",
      },
    ],
    [
      "sherwin_daily_email|9256-0|2026-03-05",
      {
        proposalId: "2492310",
        note:
          "Gmail 19c9a796bc1e3e56 sent the Justin Wagar work order at 56 Sandhurst Ct to Polaris/Reza for DripJobs proposal 2492310 on 2026-02-26; this Sherwin invoice uses PO JUSTIN, was received by REZA on 2026-03-05, and contains job-preparation supplies",
      },
    ],
    [
      "sherwin_daily_email|9410-7|2025-11-02",
      {
        proposalId: "2140736",
        note:
          "Gmail 199cad819892e31b confirms Sheila McSwiggan accepted DripJobs proposal 2140736 for exterior painting at 65 Arco Way; this Sherwin invoice uses PO SHEILA, contains Latitude exterior paint, and falls before the verified 2025-11-09 final payment and 2025-11-13 project completion",
      },
    ],
    [
      "sherwin_daily_email|9052-4|2025-11-05",
      {
        proposalId: "2196763",
        note:
          "Gmail 19a3093129dfbf10 confirms Isabelle Ares accepted DripJobs proposal 2196763 at 10 Panorama Private; this Sherwin invoice uses PO ISABELLE and was received by REZA between proposal acceptance and the Polaris labour invoice for Isabelle in Gmail 19a7a691753318b1",
      },
    ],
    [
      "sherwin_daily_email|9925-4|2025-11-19",
      {
        proposalId: "2230810",
        note:
          "Gmail 19a6efc671beaaf9 specifies SW6408 Wheat Grass for Elizabeth McCrea's hall and entrance at 201 Cairnsmore Circle; this invoice uses PO ELIZABETH and contains Wheat Grass, while proposal 2230810 covers the home's walls and proposal 2230796 covers only ensuite walls",
      },
    ],
    [
      "sherwin_daily_email|0753-8|2026-02-04",
      {
        proposalId: "2376166",
        note:
          "Gmail 19bbe9cea6453918 confirms Sonya Lee accepted DripJobs proposal 2376166 on 2026-01-14; this invoice uses PO SONIA LEE and contains primer tinted OC-65 Chantilly Lace, while Gmail 19e97e9c87dd472e confirms Chantilly Lace was used on Sonya's job",
      },
    ],
    [
      "sherwin_daily_email|4000-0|2026-03-24",
      {
        proposalId: "2496838",
        note:
          "Gmail 19c8a58b905fd576 confirms Paul Harrison accepted DripJobs proposal 2496838 at 576 Chardonnay Dr; this invoice uses PO HARRISON and was purchased on 2026-03-24, the verified first scheduled job day for proposal 2496838",
      },
    ],
    [
      "sherwin_daily_email|6912-2|2026-04-15",
      {
        proposalId: "2481008",
        note:
          "Gmail 19d065f4d273ee3b confirms Yacoub Abdulla accepted DripJobs proposal 2481008, scheduled for 2026-04-13 through 2026-04-16; Gmail 19d311738e8a1ec5 specifies SW7102 White Flour, which appears on this PO YACOUB ABDULLAH invoice during that job window",
      },
    ],
    [
      "sherwin_daily_email|7046-8|2026-04-20",
      {
        proposalId: "2481008",
        note:
          "Gmail 19d311738e8a1ec5 is the colour consultation for Yacoub Abdulla and specifies SW7102 White Flour; this follow-up invoice uses PO YACOUB ABDULLAH, contains White Flour, and follows the verified 2026-04-13 through 2026-04-16 DripJobs schedule for proposal 2481008",
      },
    ],
    [
      "sherwin_daily_email|7103-7|2026-04-22",
      {
        proposalId: "2481008",
        note:
          "This follow-up paint invoice uses the distinctive PO YACOUB ABDULHA immediately after the verified DripJobs proposal 2481008 job schedule; Gmail 19d311738e8a1ec5 provides the Yacoub Abdulla colour consultation and Gmail 19dd6b1ae555798e confirms the related Polaris labour invoice",
      },
    ],
    [
      "sherwin_daily_email|0434-2|2026-04-25",
      {
        proposalId: "2492310",
        note:
          "This Sherwin invoice uses PO JUSTIN and was received by REZA immediately before Justin Wagar accepted change order 95515 in Gmail 19dd401d212969c4 and the related Polaris labour invoice arrived in Gmail 19dd6ae4c885409e; the other Justin candidate was completed in January",
      },
    ],
    [
      "gmail_preston_material_receipt|OR019245|2026-06-01",
      {
        proposalId: "2726856",
        note:
          "Gmail 19dbf99c1a08cdd5 explicitly changes Christian Boulet's DripJobs proposal 2726856 to Benjamin Moore Regal paint; this Preston receipt uses PO BOULET and contains Regal Ulti-Matte for the same upcoming project",
      },
    ],
    [
      "gmail_preston_material_receipt|OR019342|2026-06-04",
      {
        proposalId: "2726856",
        note:
          "Gmail 19dbf99c1a08cdd5 explicitly changes Christian Boulet's DripJobs proposal 2726856 to Benjamin Moore Regal paint; this Preston receipt uses the misspelled PO GOULET and contains four Regal products for that same project",
      },
    ],
    [
      "gmail_preston_material_receipt|OR020440|2026-07-09",
      {
        proposalId: "2930976",
        note:
          "Gmail 19f438f7124473a8 confirms Daniel Leung selected Benjamin Moore Sea Salt on 2026-07-08; Preston invoice OR020440 contains CSP-95 Sea Salt, uses PO SCOTT for Daniel's project manager Scott Madden, and was purchased on the verified 2026-07-09 first job day for DripJobs proposal 2930976",
      },
    ],
    [
      "sherwin_daily_email|0780-2|2025-12-16",
      {
        proposalId: "2258601",
        note:
          "Gmail 19aa1acda9393187 confirms Rick Piche accepted DripJobs proposal 2258601; this invoice uses the misspelled PO RICKPINCH and was purchased during the verified 2025-12-15 through 2025-12-19 job window",
      },
    ],
    [
      "sherwin_daily_email|0485-5|2026-01-09",
      {
        proposalId: "2360010",
        note:
          "Gmail 19b8eba07a72cf6e confirms Justin Arcand accepted DripJobs proposal 2360010; this invoice uses the phonetic PO JUSTIN ARKENT and was purchased three days before the verified 2026-01-12 job start",
      },
    ],
    [
      "sherwin_daily_email|8494-8|2026-01-23",
      {
        proposalId: "2355250",
        note:
          "Gmail 19b945d8e0a984be confirms Jillian Morgan accepted DripJobs proposal 2355250 at 151 Bay St #602; this invoice uses PO BAY ST and was purchased one day before the verified job start",
      },
    ],
    [
      "sherwin_daily_email|6243-2|2026-03-23",
      {
        proposalId: "2366060",
        note:
          "Gmail 19c6c0845483cbeb confirms Noah Rossman accepted DripJobs proposal 2366060; this invoice uses the phonetic PO NOAH ROSEMOND and was purchased on the final scheduled day of the March 18 through March 23 job window",
      },
    ],
    [
      "sherwin_daily_email|0966-7|2026-03-27",
      {
        proposalId: "2492310",
        note:
          "This invoice uses the phonetic PO JUSTIN WAGNER and was purchased during the verified Justin Wagar job for DripJobs proposal 2492310; Gmail 19c9a796bc1e3e56 provides the related 56 Sandhurst Ct work order sent to Polaris/Reza",
      },
    ],
    [
      "sherwin_daily_email|7123-1|2026-05-05",
      {
        proposalId: "2641607",
        note:
          "Gmail 19d58adaec53f817 confirms Joelle Boutros accepted DripJobs proposal 2641607 at 236 Trailsedge Way; this invoice's PO 326 TRAILSEDGE contains a one-digit address error and was purchased on the verified first scheduled job day",
      },
    ],
    [
      "sherwin_daily_email|7631-7|2026-05-08",
      {
        proposalId: "2641607",
        note:
          "Gmail 19d58adaec53f817 confirms Joelle Boutros accepted DripJobs proposal 2641607 at 236 Trailsedge Way; this invoice's PO 234 TRAILSEDGE contains a one-digit address error and was purchased on the verified final scheduled job day",
      },
    ],
    [
      "sherwin_daily_email|4657-7|2026-05-08",
      {
        proposalId: "2641607",
        note:
          "Gmail 19d58adaec53f817 confirms Joelle Boutros accepted DripJobs proposal 2641607 at 236 Trailsedge Way; this invoice's PO 234 TRAILSEDGE WAY contains a one-digit address error and was purchased on the verified final scheduled job day",
      },
    ],
    [
      "sherwin_daily_email|7902-5|2026-05-13",
      {
        proposalId: "2656060",
        note:
          "Gmail 19d4527c9c7e5396 identifies Dever Jylha's DripJobs work order 2656060 at 64 Lillico Dr; this invoice uses the exact address PO 64 LILLICO DR and was purchased during the verified job window",
      },
    ],
    [
      "sherwin_daily_email|7921-5|2026-05-14",
      {
        proposalId: "2656060",
        note:
          "Gmail 19d4527c9c7e5396 identifies Dever Jylha's DripJobs work order 2656060 at 64 Lillico Dr; this invoice uses the exact address PO 64 LILLICO and was purchased on the verified first recorded job day",
      },
    ],
    [
      "sherwin_daily_email|7988-1|2026-05-19",
      {
        proposalId: "2597493",
        note:
          "Gmail 19d83fd2aa5a959d confirms Daniel Leblanc accepted DripJobs proposal 2597493 at 499 N Russell Rd; this invoice uses PO 499 NORTH RUSSEL RD and was purchased during the verified job window",
      },
    ],
    [
      "sherwin_daily_email|5873-0|2026-05-20",
      {
        proposalId: "2597493",
        note:
          "Gmail 19d83fd2aa5a959d confirms Daniel Leblanc accepted DripJobs proposal 2597493 at 499 N Russell Rd; this invoice uses the misspelled PO 499 RUSSLE ROAD and was purchased during the verified job window",
      },
    ],
    [
      "sherwin_daily_email|4845-8|2026-05-21",
      {
        proposalId: "2597493",
        note:
          "Gmail 19d83fd2aa5a959d confirms Daniel Leblanc accepted DripJobs proposal 2597493 at 499 N Russell Rd; this invoice uses the abbreviated PO 499 NORTH ROS and was purchased during the verified job window",
      },
    ],
    [
      "sherwin_daily_email|2616-9|2025-10-30",
      {
        proposalId: "1865720",
        note:
          "This invoice uses the misspelled PO NICOLI, was received by REZA, and contains SW6211 Rainwashed immediately before Nicole Richard's verified DripJobs proposal 1865720 job; Gmail 19a4b8331eedb626 confirms the completed job and final payment",
      },
    ],
    [
      "sherwin_daily_email|4134-8|2025-11-02",
      {
        proposalId: "2140736",
        note:
          "This invoice uses the phonetic PO SHERLA, was received by ANAS on the same date as the verified PO SHEILA purchase, and contains Latitude exterior paint for Sheila McSwiggan's exterior-painting proposal 2140736 confirmed in Gmail 199cad819892e31b",
      },
    ],
    [
      "sherwin_daily_email|9863-7|2025-11-17",
      {
        proposalId: "2230810",
        note:
          "Gmail 19a6efc671beaaf9 specifies Ionic Ivory, Wheat Grass, Ancestral Gold, Accessible Beige, and Pure White for Elizabeth McCrea's general walls and trim; this PO ELIZABETH MCRAY invoice contains those exact colours, identifying proposal 2230810 rather than the separate ensuite-only proposal",
      },
    ],
    [
      "sherwin_daily_email|2402-1|2026-02-13",
      {
        proposalId: "2374940",
        note:
          "Gmail 19bfa707b799816e confirms Marilyn Hingorani selected SW7566 Westhighland White throughout 68 Tartan Dr; this invoice uses the abbreviated PO MARLEN, contains Westhighland White, and was purchased immediately before the verified DripJobs proposal 2374940 job",
      },
    ],
    [
      "sherwin_daily_email|6836-3|2026-02-25",
      {
        proposalId: "2510231",
        note:
          "Gmail 19c8b864f8f6ccbc confirms Claire Colbert's DripJobs proposal 2510231, which includes popcorn-ceiling removal; this invoice uses PO CLAIRE-CORONATION, contains joint compound and preparation supplies, and was purchased on the verified first scheduled job day",
      },
    ],
    [
      "sherwin_daily_email|5689-3|2026-03-10",
      {
        proposalId: "2484669",
        note:
          "Gmail 19cbaa3e06fcbf8e is the Gregg Alexander colour consultation and specifies SW6672 Morning Sun; this invoice uses the phonetic PO ALEXANDRIA, contains Morning Sun, and was purchased during the verified DripJobs proposal 2484669 job window",
      },
    ],
  ]);
  const auditedProject = auditedInvoiceProjects.get(
    `${invoice.source_system}|${invoice.invoice_number}|${invoice.invoice_date}`,
  );
  if (auditedProject) {
    const auditedJob = jobs.find(
      (job) => String(job.proposal_id) === auditedProject.proposalId,
    );
    if (!auditedJob) {
      throw new Error(
        `Audited material invoice ${invoice.invoice_number} has no DripJobs proposal ${auditedProject.proposalId}.`,
      );
    }
    const temporal = temporalScore(invoice.invoice_date, auditedJob);
    return {
      kind: "matched",
      job: auditedJob,
      projectId: projectIdByProposal.get(auditedJob.proposal_uuid),
      method: "manual",
      confidence: 1,
      base: 100,
      temporal,
      score: 100 + temporal,
      matchingNote: auditedProject.note,
      candidates: [
        {
          job: auditedJob,
          projectId: projectIdByProposal.get(auditedJob.proposal_uuid),
          method: "manual",
          base: 100,
          temporal,
          score: 100 + temporal,
        },
      ],
    };
  }
  const auditedPoAliases = new Map([
    ["luke nickson", "2372277"],
    ["luck nickson", "2372277"],
    ["orokovsky", "2418171"],
    ["lecalire", "3006955"],
    ["loraine", "3022357"],
    ["lorraine don", "3022357"],
  ]);
  const aliasProposalId = auditedPoAliases.get(po);
  if (aliasProposalId) {
    const aliasJob = jobs.find((job) => String(job.proposal_id) === aliasProposalId);
    if (!aliasJob) throw new Error(`Audited PO alias ${po} has no DripJobs proposal ${aliasProposalId}.`);
    const temporal = temporalScore(invoice.invoice_date, aliasJob);
    return {
      kind: "matched",
      job: aliasJob,
      projectId: projectIdByProposal.get(aliasJob.proposal_uuid),
      method: "customer_exact",
      base: 100,
      temporal,
      score: 100 + temporal,
      matchingNote: `Audited PO spelling alias to DripJobs proposal ${aliasProposalId}`,
      candidates: [
        {
          job: aliasJob,
          projectId: projectIdByProposal.get(aliasJob.proposal_uuid),
          method: "customer_exact",
          base: 100,
          temporal,
          score: 100 + temporal,
        },
      ],
    };
  }
  const candidates = jobs
    .map((job) => {
      const base = baseScore(po, job);
      if (!base.score) return null;
      const temporal = temporalScore(invoice.invoice_date, job);
      return {
        job,
        projectId: projectIdByProposal.get(job.proposal_uuid),
        method: base.method,
        base: base.score,
        temporal,
        score: base.score + temporal,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) {
    return { kind: "unmatched", reason: `No DripJobs customer matched PO ${invoice.po_number}`, candidates: [] };
  }
  const best = candidates[0];
  const runnerUp = candidates[1];
  const strongName = best.base >= 86;
  const decisive = !runnerUp || best.score - runnerUp.score >= 12;
  const uniqueFirstName = best.base === 76 && (!runnerUp || runnerUp.base < 76);
  const decisiveFirstName =
    invoice.supplier_name === "The Home Depot" &&
    best.base === 76 &&
    decisive &&
    best.temporal >= 25 &&
    best.score >= 101;
  const uniqueFuzzy = best.base >= 80 && !runnerUp && best.temporal >= 20;
  if (
    (strongName && decisive && best.score >= 86) ||
    ((uniqueFirstName || decisiveFirstName) && best.score >= 84) ||
    (uniqueFuzzy && best.score >= 100)
  ) {
    return { kind: "matched", ...best, candidates: candidates.slice(0, 3) };
  }
  return {
    kind: "ambiguous",
    reason: `PO ${invoice.po_number} matches multiple DripJobs jobs`,
    candidates: candidates.slice(0, 3),
  };
}

function auditedLineOverheadPlan(invoice, invoiceLines) {
  if (
    invoice.source_system !== "gmail_home_depot_order" ||
    invoice.external_invoice_id !== "home-depot-order:240846171"
  ) {
    return null;
  }
  const categoryByProductCode = new Map([
    ["1000738387", "Shop supplies"],
    ["1001237109", "Tools & equipment"],
  ]);
  if (
    invoiceLines.length !== categoryByProductCode.size ||
    invoiceLines.some((line) => !categoryByProductCode.has(line.product_code))
  ) {
    throw new Error("Home Depot order 240846171 line evidence changed; refusing allocation.");
  }
  return {
    kind: "overhead",
    category: "Mixed overhead",
    method: "overhead_rule",
    confidence: 1,
    lineOverheadCategories: Object.fromEntries(categoryByProductCode),
    evidence: "Home Depot order 240846171 · audited item-purpose classification",
    source: "audited_home_depot_order_240846171",
  };
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

if (!existsSync(jobsArchivePath)) throw new Error("Verified DripJobs archive is missing.");
const jobs = JSON.parse(readFileSync(jobsArchivePath, "utf8")).jobs ?? [];
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [projects, invoices, lines, activeAllocations] = await Promise.all([
  fetchAll(() =>
    db
      .from("companycam_projects")
      .select(
        "companycam_id,name,formatted_address,is_archived,is_deleted,is_lead",
      ),
  ),
  fetchAll(() =>
      db
        .from("material_invoices")
      .select("id,source_system,external_invoice_id,supplier_name,invoice_number,invoice_date,po_number,total_amount")
      .order("invoice_date"),
  ),
  fetchAll(() =>
    db
      .from("material_invoice_lines")
      .select("id,material_invoice_id,product_code,description,amount_before_tax,tax_amount,total_amount")
      .order("line_number"),
  ),
  fetchAll(() =>
    db
      .from("material_invoice_line_allocations")
      .select("material_invoice_line_id")
      .is("reversed_at", null),
  ),
]);
const { projectIdByProposal } = buildDripJobsProjectIdentity(
  jobs,
  new Set(projects.map((project) => String(project.companycam_id))),
);
const projectsById = new Map(
  projects.map((project) => [String(project.companycam_id), project]),
);
const linesByInvoice = new Map();
for (const line of lines) {
  const values = linesByInvoice.get(line.material_invoice_id) ?? [];
  values.push(line);
  linesByInvoice.set(line.material_invoice_id, values);
}
const allocatedLineIds = new Set(
  activeAllocations.map((allocation) => allocation.material_invoice_line_id),
);
const plans = [];
const ambiguous = [];
const unmatched = [];

for (const invoice of invoices) {
  const invoiceLines = linesByInvoice.get(invoice.id) ?? [];
  if (!invoiceLines.length || invoiceLines.some((line) => allocatedLineIds.has(line.id))) {
    continue;
  }
  const lineOverheadPlan = auditedLineOverheadPlan(invoice, invoiceLines);
  const match =
    lineOverheadPlan ??
    matchInvoice(invoice, jobs, projectIdByProposal, projectsById);
  const auditRow = {
    invoice_id: invoice.id,
    supplier_name: invoice.supplier_name,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    po: invoice.po_number,
    total: Number(invoice.total_amount),
    reason: match.reason ?? null,
    candidates: (match.candidates ?? []).map((candidate) => ({
      project_id: candidate.projectId,
      customer: candidate.job.customer_name,
      address: candidate.job.address,
      proposal_id: candidate.job.proposal_id,
      job_start: candidate.job.job_start_date,
      job_completion: candidate.job.job_completion_date,
      score: candidate.score,
    })),
  };
  if (match.kind === "ambiguous") {
    ambiguous.push(auditRow);
    continue;
  }
  if (match.kind !== "matched") {
    if (match.kind === "overhead") {
      plans.push({
        ...auditRow,
        kind: "overhead",
        project_id: null,
        project_name: null,
        overhead_category: match.category,
        line_overhead_categories: match.lineOverheadCategories ?? null,
        evidence: match.evidence ?? null,
        source: match.source ?? null,
        method: match.method,
        confidence: match.confidence,
        lines: invoiceLines,
      });
      continue;
    }
    unmatched.push(auditRow);
    continue;
  }
  plans.push({
    ...auditRow,
    kind: "job",
    project_id: match.projectId,
    project_name: match.job.customer_name,
    proposal_id: String(match.job.proposal_id),
    proposal_uuid: match.job.proposal_uuid,
    method: match.method,
    source: match.source ?? null,
    source_payload: match.sourcePayload ?? null,
    matching_note: match.matchingNote ?? null,
    confidence: match.confidence ?? Math.min(1, match.score / 127),
    lines: invoiceLines,
  });
}

const report = {
  mode: apply ? "apply" : "dry-run",
  source: {
    dripjobs_jobs: jobs.length,
    material_invoices: invoices.length,
    previously_allocated_invoices: invoices.length - plans.length - ambiguous.length - unmatched.length,
  },
  planned_invoices: plans.length,
  planned_lines: plans.reduce((sum, plan) => sum + plan.lines.length, 0),
  ambiguous_invoices: ambiguous.length,
  unmatched_invoices: unmatched.length,
  planned_by_customer: Object.fromEntries(
    [...new Set(plans.map((plan) => plan.project_name ?? `Overhead: ${plan.overhead_category}`))]
      .sort()
      .map((name) => [
        name,
        plans.filter(
          (plan) => (plan.project_name ?? `Overhead: ${plan.overhead_category}`) === name,
        ).length,
      ]),
  ),
  planned_review: plans
    .filter((plan) => plan.kind === "job" && (plan.candidates[0]?.score ?? 0) < 110)
    .map((plan) => ({
      invoice_number: plan.invoice_number,
      invoice_date: plan.invoice_date,
      po: plan.po,
      total: plan.total,
      project_id: plan.project_id,
      project_name: plan.project_name,
      candidates: plan.candidates,
    })),
  ...(includeDetails
    ? {
        planned: plans.map((plan) => ({
          supplier_name: plan.supplier_name,
          invoice_number: plan.invoice_number,
          invoice_date: plan.invoice_date,
          po: plan.po,
          total: plan.total,
          allocation_scope: plan.kind,
          project_id: plan.project_id,
          project_name: plan.project_name,
          overhead_category: plan.overhead_category,
          line_overhead_categories: plan.line_overhead_categories,
          score: plan.candidates[0]?.score ?? null,
        })),
      }
    : {}),
  ambiguous,
  unmatched,
  inserted_allocations: 0,
};

if (apply) {
  const allocations = plans.flatMap((plan) =>
    plan.lines.map((line) => ({
      material_invoice_line_id: line.id,
      allocation_scope: plan.kind,
      companycam_project_id: plan.kind === "job" ? plan.project_id : null,
      overhead_category:
        plan.kind === "overhead"
          ? plan.line_overhead_categories?.[line.product_code] ?? plan.overhead_category
          : null,
      allocated_before_tax: Number(line.amount_before_tax),
      allocated_tax: Number(line.tax_amount),
      allocated_total: Number(line.total_amount),
      allocation_method: plan.method,
      evidence_reference:
        plan.kind === "job"
          ? `${plan.supplier_name} PO# ${plan.po} · ${plan.matching_note ? `${plan.matching_note} · ` : ""}DripJobs proposal ${plan.proposal_id}`
          : plan.evidence ?? `${plan.supplier_name} PO# ${plan.po} · documented supplies rule`,
      confidence: plan.confidence,
      needs_review: false,
      source_payload: {
        source:
          plan.kind === "job"
            ? plan.source ?? "verified_dripjobs_export_2026-07-31"
            : plan.source ?? "documented_supplier_po_rule",
        ...(plan.source_payload ?? {}),
        proposal_uuid: plan.proposal_uuid,
        proposal_id: plan.proposal_id,
        customer_name: plan.project_name,
        matching_rule:
          plan.kind === "job"
            ? plan.matching_note ?? "PO customer/address plus job-date disambiguation"
            : plan.line_overhead_categories
              ? "Audited receipt line-item purpose"
              : "Supplier PO supplies rule",
      },
    })),
  );
  if (allocations.length) {
    const inserted = await db.from("material_invoice_line_allocations").insert(allocations);
    if (inserted.error) throw inserted.error;
    report.inserted_allocations = allocations.length;
  }
}

console.log(JSON.stringify(report, null, 2));
