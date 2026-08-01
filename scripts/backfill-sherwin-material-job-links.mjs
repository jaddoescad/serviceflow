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
  if (["supplies", "shop supplies", "office supplies"].includes(po)) {
    return {
      kind: "overhead",
      category: "General paint supplies",
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
        source: "gmail_dripjobs_acceptance_and_companycam_project",
        sourcePayload: {
          gmail_message_id: "19fb9dc9e6a1c167",
        },
        note:
          "Gmail 19fb9dc9e6a1c167 confirms DripJobs proposal 2873427 was accepted for Shezara Ali on 2026-07-31; this same-day Sherwin invoice uses PO ALI, while CompanyCam project 105848213 is the current unarchived Shezara Ali job at 314 Central Park Dr #805",
      },
    ],
    [
      "sherwin_daily_email|3720-4|2026-03-02",
      {
        projectId: "99786158",
        customerName: "Krista Colwell",
        proposalId: "2512085",
        allowArchived: true,
        source: "audited_supplier_credit_chain_and_companycam_project",
        sourcePayload: {
          related_invoice_numbers: ["5600-4", "3751-9", "9238-8"],
          returned_product_code: "K36TQ8454",
          returned_colour: "SW9179 Anchors Aweigh",
        },
        note:
          "This no-PO credit returns the same K36TQ8454 SW9179 Anchors Aweigh gallon charged on same-day PO COLWILL invoice 5600-4; that charge and the next two PO COLWILL invoices 3751-9 and 9238-8 are allocated to CompanyCam project 99786158 for Krista Colwell, so the related credit belongs to the same job",
      },
    ],
    [
      "sherwin_daily_email|2900-6|2025-10-14",
      {
        projectId: "dripjobs-2101292",
        customerName: "Jeffrey Roy / Jeffrey Ian — proposal 2101292 (completed)",
        proposalId: "2101292",
        allowArchived: true,
        source: "gmail_dripjobs_recovered_accounting_job",
        sourcePayload: {
          appointment_gmail_message_id: "1997be08a3fe7614",
          proposal_accepted_gmail_message_id: "199a066563102fa1",
          customer_acceptance_gmail_message_id: "199bf003818d5875",
          receipt_gmail_message_id: "199e817b6c323cc5",
        },
        note:
          "DripJobs Gmail 199a066563102fa1 confirms Jeffrey Ian accepted proposal 2101292, the same customer's appointment Gmail 1997be08a3fe7614 gives 10 Lynhurst Ave, and Gmail thread 19998a6515e7f0cb schedules the weather-dependent exterior work; this October 14 receipt uses PO JEFFREY and contains Rare Gray exterior wood primer",
      },
    ],
    [
      "sherwin_daily_email|0793-3|2025-08-21",
      {
        projectId: "dripjobs-1889052",
        customerName: "Scott MacEwen — proposal 1889052 (completed)",
        proposalId: "1889052",
        allowArchived: true,
        source: "gmail_colour_confirmation_and_recovered_dripjobs_job",
        sourcePayload: {
          colour_gmail_message_ids: [
            "1989ff693f9eb3ea",
            "198a02943f47dfb8",
          ],
          related_receipt_invoice_number: "0449-2",
        },
        note:
          "Scott MacEwen's Gmail colour thread 1989ff693f9eb3ea and 198a02943f47dfb8 explicitly confirms SW7008 Alabaster as the main wall colour for recovered DripJobs proposal 1889052; this PO SCOTT receipt contains five gallons of that exact colour and predates the next Alabaster batch by four days",
      },
    ],
    [
      "sherwin_daily_email|0984-8|2025-08-25",
      {
        projectId: "dripjobs-1889052",
        customerName: "Scott MacEwen — proposal 1889052 (completed)",
        proposalId: "1889052",
        allowArchived: true,
        source: "gmail_colour_confirmation_and_receipt_product_chain",
        sourcePayload: {
          colour_gmail_message_ids: [
            "1989ff693f9eb3ea",
            "198a02943f47dfb8",
          ],
          related_receipt_invoice_number: "0793-3",
          received_by: "REZA",
        },
        note:
          "Scott MacEwen's Gmail colour thread explicitly confirms SW7008 Alabaster as the main wall colour for recovered DripJobs proposal 1889052; this no-PO receipt contains ten gallons of Alabaster primer and wall paint, was received by the same purchaser as the August 21 PO SCOTT Alabaster receipt, and is the next business-day batch for the same verified job",
      },
    ],
    [
      "sherwin_daily_email|8554-9|2026-01-26",
      {
        projectId: "97797370",
        customerName: "Graeme Archibald",
        proposalId: null,
        allowLead: true,
        allowArchived: true,
        source: "gmail_dripjobs_work_order_and_companycam_project",
        sourcePayload: {
          work_order_gmail_message_ids: ["19be640b5fc7594c", "19be79ce821ecbde"],
        },
        note:
          "Gmail 19be640b5fc7594c and 19be79ce821ecbde are DripJobs work orders for Graeme Archibald at 1874 Playfair Dr sent January 22; this January 26 receipt uses the exact PO GRAEME ARCHIBALD and belongs to the existing same-name, same-address CompanyCam project 97797370",
      },
    ],
    [
      "sherwin_daily_email|8550-7|2026-01-26",
      {
        projectId: "97797370",
        customerName: "Graeme Archibald",
        proposalId: null,
        allowLead: true,
        allowArchived: true,
        source: "gmail_dripjobs_work_order_and_companycam_project",
        sourcePayload: {
          work_order_gmail_message_ids: ["19be640b5fc7594c", "19be79ce821ecbde"],
        },
        note:
          "Gmail 19be640b5fc7594c and 19be79ce821ecbde are DripJobs work orders for Graeme Archibald at 1874 Playfair Dr sent January 22; this second January 26 receipt uses the misspelled PO GAEME ARCHIBALD and belongs to the existing same-name, same-address CompanyCam project 97797370",
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
      (!auditedDirectProject.allowLead && project.is_lead) ||
      (!auditedDirectProject.allowArchived && project.is_archived)
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
      source: auditedDirectProject.source,
      sourcePayload: {
        ...auditedDirectProject.sourcePayload,
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
      "sherwin_daily_email|3095-0|2026-06-30",
      {
        proposalId: "2481008",
        source: "gmail_colour_consultation_exact_product_match",
        sourcePayload: {
          colour_gmail_message_id: "19d311dc2c91295c",
          colour_code: "SW7020",
          colour_name: "Black Fox",
          surface: "front door exterior",
        },
        note:
          "Darlene's colour-consultation email 19d311dc2c91295c explicitly specifies SW7020 Black Fox for Yacoub Abdulla's front-door exterior; this no-PO receipt contains the exact SW7020 Black Fox Emerald Urethane product and was purchased during the verified DripJobs proposal 2481008 job window",
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
      "sherwin_daily_email|0744-8|2025-12-15",
      {
        proposalId: "2283227",
        source: "gmail_customer_payment_address_and_dripjobs_job",
        sourcePayload: {
          scheduled_job_gmail_message_id: "19ae4d55666e607d",
          final_payment_gmail_message_id: "19b27ababfa11db6",
          proposal_gmail_message_id: "19acb3258c08d746",
          receipt_po: "JAY",
          received_by: "ANAS",
        },
        note:
          "Interac Gmail 19ae4d55666e607d identifies Jason Wong's December 15 job at 233 Anyolite Private, Gmail 19b27ababfa11db6 confirms the final payment for that same address on December 16, and Gmail 19acb3258c08d746 carries DripJobs proposal 2283227 for Jay Wong; this December 15 Sherwin receipt uses PO JAY and contains the custom-matched paint and supplies for that uniquely identified job",
      },
    ],
    [
      "sherwin_daily_email|5251-6|2026-05-20",
      {
        proposalId: "2721303",
        source: "audited_receipt_scope_and_subcontractor_invoice_match",
        sourcePayload: {
          customer_issue_gmail_message_id: "19e55b3266710e7a",
          customer_payment_gmail_message_id: "19eb1adb038675f8",
          receipt_description: "MTC BROWN WINDOWS",
          receipt_received_by: "FRANK",
          subcontractor_invoice_number: "108",
          subcontractor_scope: "paint walls 1 frame, 2 windows, 1 door",
          project_address: "126 Versilia Dr",
        },
        note:
          "This May 20 Sherwin receipt is explicitly described as MTC BROWN WINDOWS and contains a custom industrial DTM coating; Bailey Muldner's DripJobs proposal 2721303 at 126 Versilia Dr is the only contemporaneous project whose scope includes window sills and a laundry window frame, AMG invoice 108 independently lists Bailey's 1 frame, 2 windows, and 1 door, Gmail 19e55b3266710e7a documents paint issues at 126 Versilia on May 23, and Gmail 19eb1adb038675f8 confirms the Bailey customer payment",
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
      "sherwin_daily_email|5460-3|2026-02-25",
      {
        proposalId: "2503613",
        note:
          "This no-PO colour exchange returns the same A87WQ1351 Cloud White gallon charged on same-day PO SINGH invoice 5459-5 and replaces it with A87WQ1351 Agreeable Gray; the replacement colour also appears on PO SINGH invoice 2906-1, and both named invoices are allocated to DripJobs proposal 2503613",
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
    [
      "sherwin_daily_email|8821-4|2026-03-18",
      {
        proposalId: "2413005",
        note:
          "Gmail 19cbfa3a37449cda specifies SW7012 Creamy for Laura Van Cleef's project; this Frank receipt contains the exact SW7012 Creamy during the verified job window, matching PO VAN CLEEF invoices 6019-6, 8842-0, and 9082-2 already allocated to DripJobs proposal 2413005",
      },
    ],
    [
      "sherwin_daily_email|8910-5|2026-03-20",
      {
        proposalId: "2413005",
        note:
          "Gmail 19cbfa3a37449cda specifies SW7036 Accessible Beige for Laura Van Cleef's project; this Frank receipt contains the exact Accessible Beige and matching ProClassic trim paint during the verified job window, consistent with PO VAN CLEEF invoice 6019-6 already allocated to DripJobs proposal 2413005",
      },
    ],
    [
      "sherwin_daily_email|6464-4|2026-03-30",
      {
        proposalId: "2484669",
        note:
          "This no-PO credit exchanges SW6672 Morning Sun from same-day PO ALEXANDER invoice 6406-5; the exact colour is confirmed for Gregg Alexander by Gmail 19cbaa3e06fcbf8e and also appears on PO ALEXANDER/ALEXANDRIA invoices 5800-0 and 5689-3 already allocated to DripJobs proposal 2484669",
      },
    ],
    [
      "sherwin_daily_email|0184-3|2026-04-15",
      {
        proposalId: "2687681",
        note:
          "This no-PO Frank receipt contains five gallons of A87WQ1351 SW7570 Egret White on Michael Sheridan's verified first job day; the exact product and colour appear on previous-day PO SHERIDAN invoice 0152-0 and later PO MICHAEL SHERIDAN/MICHAEL invoices 0369-0 and 1125-9, all allocated to DripJobs proposal 2687681",
      },
    ],
    [
      "sherwin_daily_email|0478-9|2026-04-27",
      {
        proposalId: "2547732",
        note:
          "This no-PO correction returns the exact Honied White, Intimate White, and Liveable Green samples charged on same-day PO LUNDIN invoice 0470-6; those colours continue on PO LUNDIN invoices 8732-7 and 8761-6, all allocated to DripJobs proposal 2547732",
      },
    ],
    [
      "gmail_preston_material_receipt|OR018281|2026-04-30",
      {
        proposalId: "2453791",
        note:
          "Gmail thread 19dcee446a0fda21 confirms Roslyn Adu/Mulongo selected Benjamin Moore OC-45 Swiss Coffee and specifically requested Benjamin Moore paint for her basement project; this Preston Paint Center receipt contains the exact Swiss Coffee product on the verified April 30 first job day for DripJobs proposal 2453791",
      },
    ],
    [
      "sherwin_daily_email|5999-3|2026-05-22",
      {
        proposalId: "2790387",
        note:
          "This no-PO receipt contains custom solid stain labelled MTC TAREQ; Gmail thread 19e42137e30b11e6 is the May 19 DripJobs work order for TAREQ Shiblaq at 1327 S Beach Blvd, while Gmail 19e50f62f56c1a30 and Interac Gmail 19e50f162502a7a1 confirm final payment for that exact address and invoice on the receipt date",
      },
    ],
    [
      "sherwin_daily_email|1268-3|2026-05-26",
      {
        proposalId: "2822094",
        note:
          "Gmail 19e473034487ce8e is David Rennie's colour consultation and specifies SW6254 Lazy Gray, while Gmail 19e517eece8eed0b is the Sherwin-Williams order under PO Rennie containing the same colour; this no-PO Steven follow-up gallon contains the exact SW6254 Lazy Gray during the verified 52 Royal Oak project window",
      },
    ],
    [
      "sherwin_daily_email|6319-3|2026-05-29",
      {
        proposalId: "2685506",
        note:
          "Gmail 19e503076402b595 is Ottawa Painters' Sherwin-Williams order under PO Snelling and includes ProClassic white trim paint; this Camilo follow-up invoice contains the same ProClassic product during Lee Snelling's verified job window, and Grutenco invoice GT-INV-202606-01 identifies Camilo's labour on the Lee Snelling job",
      },
    ],
    [
      "sherwin_daily_email|7905-5|2026-05-15",
      {
        proposalId: "2649627",
        note:
          "Gmail thread 19e051bdd4bb0ef6 confirms Joelle Moncrieff selected Benjamin Moore HC-173 Edgecomb Gray for the trim and doors at 1297 Vinette Rd during the May 13-16 project; this Camilo receipt contains the exact HC-173 Edgecomb Gray match and was purchased during that verified job window",
      },
    ],
    [
      "sherwin_daily_email|1015-8|2026-05-19",
      {
        proposalId: "2656060",
        note:
          "Gmail thread 19e02f19f45f073d is the Sherwin-Williams order for Dever Jylha under PO Jylha and includes a SW6794 Flyway sample; this Camilo follow-up invoice contains one gallon of the exact SW6794 Flyway during the verified 64 Lillico Dr project window",
      },
    ],
    [
      "sherwin_daily_email|6168-4|2026-05-26",
      {
        proposalId: "2685506",
        note:
          "Gmail 19e503076402b595 is Ottawa Painters' May 22 Sherwin-Williams order under PO Snelling for seven gallons of SW7036 Accessible Beige; this Camilo follow-up invoice contains three gallons of the exact SW7036 Accessible Beige for Lee Snelling's DripJobs proposal 2685506",
      },
    ],
    [
      "sherwin_daily_email|9191-5|2026-06-08",
      {
        proposalId: "2846697",
        note:
          "Gmail 19e5fbb0cf94fc83 confirms Mehaly Marinakis accepted DripJobs proposal 2846697 and Gmail 19e935d0e671306a confirms the 88 Spruce Street project started Monday June 8; this same-day Scott receipt uses the phonetic PO MARINAICUS",
      },
    ],
    [
      "sherwin_daily_email|0836-0|2026-06-16",
      {
        proposalId: "2808200",
        note:
          "Gmail thread 19e4b39b78eb0b48 confirms Tyler Duncan's June 16 project at 547 Via Mattino Way used SW6993 Black of Night and SW9521 Simple Stone; this invoice contains both exact colours and was purchased on the verified first job day",
      },
    ],
    [
      "sherwin_daily_email|7111-3|2026-06-17",
      {
        proposalId: "2808200",
        note:
          "Gmail thread 19e4b39b78eb0b48 confirms Tyler Duncan's project at 547 Via Mattino Way used SW9521 Simple Stone; this follow-up invoice contains the exact colour and was purchased on the second verified project day",
      },
    ],
    [
      "sherwin_daily_email|2482-9|2026-07-08",
      {
        proposalId: "2818842",
        note:
          "DripJobs proposal 2818842 is Phil Anido's exterior stucco project at 11 Lambton Ave scheduled to start July 8; this same-day invoice uses PO STUCCO EXT and contains four gallons of Duration exterior paint in SW2805 Renwick Beige",
      },
    ],
    [
      "sherwin_daily_email|4181-8|2026-07-17",
      {
        proposalId: "3022357",
        note:
          "Gmail 19f6c19b5e4f1b0a is Darlene Hall-Barrett's July 16 colour consultation for Lorraine Ulrick and specifies SW6102 Portobello; this next-day Camilo invoice uses the phonetic PO LAURIEN and contains the exact SW6102 Portobello for DripJobs proposal 3022357",
      },
    ],
    [
      "sherwin_daily_email|3906-9|2026-07-07",
      {
        proposalId: "2831558",
        note:
          "This no-PO same-day product exchange returns K36WQ1051 Pure White charged on PO BENOIT invoice 3905-1 and replaces it with Duration Matte; the identical Pure White product appears on PO BENOIT invoices 9466-6 and 9597-8, all allocated to Diane Benoit's DripJobs proposal 2831558",
      },
    ],
    [
      "sherwin_daily_email|6747-2|2026-04-09",
      {
        proposalId: "2604777",
        source: "audited_supplier_sample_to_job_paint_chain",
        sourcePayload: {
          related_invoice_number: "7206-1",
          shared_colours: [
            "Benjamin Moore 2126-50 Gray Timber Wolf",
            "Benjamin Moore 2121-40 Silver Half Dollar",
          ],
        },
        note:
          "This no-PO sample receipt contains Gray Timber Wolf, Silver Half Dollar, and Pike's Peak Gray four days before Janet Morris's verified first job day; PO MORRIS invoice 7206-1 then purchased full gallons of the exact Gray Timber Wolf and Silver Half Dollar colours for DripJobs proposal 2604777, proving the entire three-colour selection batch belongs to Janet's job",
      },
    ],
    [
      "sherwin_daily_email|8135-4|2026-06-08",
      {
        proposalId: "2818188",
        source: "gmail_subcontractor_work_order_and_receipt_purchaser",
        sourcePayload: {
          work_order_gmail_message_id: "19e9a056075e7999",
          received_by: "CAMILO",
          actual_job_start_date: "2026-06-08",
        },
        note:
          "Gmail 19e9a056075e7999 records Camilo Alvarez/Grutenco accepting the Kirsty Harris work order at 1502 Tonilee Dr on Friday June 5 and explicitly confirms a Monday June 8 start; this June 8 masking-paper and contractor-tape receipt was received by Camilo, so it is job preparation for DripJobs proposal 2818188 despite the later stale dates in the DripJobs export",
      },
    ],
    [
      "sherwin_daily_email|8969-3|2026-07-31",
      {
        proposalId: "2959424",
        note:
          "Gmail 19ed16aaf1d74dbd confirms Mehaly Marinakis accepted the separate exterior-painting proposal 2959424, and Gmail 19fb7ecd7d4b12cf records its July 31 postponement; this July 31 Scott receipt uses the phonetic PO MEHLAY and contains Duration exterior paint purchased for that scheduled project",
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
      source: auditedProject.source,
      sourcePayload: auditedProject.sourcePayload,
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
  if (!po) return { kind: "unmatched", reason: "PO missing", candidates: [] };
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
  // A bare first name is often the purchaser/crew member rather than the
  // customer (for example, PO SCOTT can mean Scott Madden).  It is only safe
  // when the receipt is tightly aligned with the customer's actual job dates.
  const decisiveFirstName =
    best.base === 76 &&
    decisive &&
    best.temporal >= 25 &&
    best.score >= 101;
  const uniqueFuzzy = best.base >= 80 && !runnerUp && best.temporal >= 20;
  if (
    (strongName && decisive && best.score >= 86) ||
    (decisiveFirstName && best.score >= 101) ||
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
  const invoiceKey = `${invoice.source_system}|${invoice.invoice_number}|${invoice.invoice_date}`;
  const auditedInvoicePlans = new Map([
    [
      "gmail_canadian_tire_receipt|422-20260406-010177|2026-04-06",
      {
        category: "Tools & equipment",
        categories: [
          ["069-1076-0", "Tools & equipment"],
          ["398-6931-2", "Tools & equipment"],
        ],
        evidence:
          "Canadian Tire receipt 422-20260406-010177 · alkaline equipment battery and its environmental fee, with no customer or job reference",
        source: "audited_canadian_tire_equipment_purchase",
      },
    ],
    [
      "sherwin_daily_email|3069-4|2026-04-10",
      {
        category: "Supplier correction",
        categories: [
          ["B20W1151", "Supplier correction"],
          ["B20WQ1151", "Supplier correction"],
        ],
        evidence:
          "Sherwin-Williams invoice 3069-4 · equal return and replacement of the same ProClassic product, producing a documented zero-dollar supplier SKU correction",
        source: "audited_zero_value_supplier_correction",
      },
    ],
    [
      "sherwin_daily_email|1281-6|2026-05-27",
      {
        category: "General paint supplies",
        categories: [
          ["106009", "General paint supplies"],
          ["559554400", "General paint supplies"],
          ["R360", "Tools & equipment"],
          ["SD150-5", "General paint supplies"],
        ],
        evidence:
          "Sherwin-Williams invoice 1281-6 · reusable Radius 360 sanding tool plus unassigned general tape, applicator, and sanding supplies, with no customer or job reference",
        source: "audited_unassigned_shop_tool_purchase",
      },
    ],
    [
      "sherwin_daily_email|8564-9|2026-06-04",
      {
        category: "Crew workwear",
        categories: [
          ["SH12352", "Crew workwear"],
          ["SH12355", "Crew workwear"],
        ],
        evidence:
          "Sherwin-Williams invoice 8564-9 · two pairs of painter pants for Michael and Anas, which are crew workwear rather than customer-job materials",
        source: "audited_crew_workwear_purchase",
      },
    ],
    [
      "sherwin_daily_email|9704-1|2025-12-15",
      {
        category: "General paint supplies",
        categories: [
          ["CP-040NA", "Tools & equipment"],
          ["71162", "General paint supplies"],
          [null, "Tools & equipment"],
        ],
        evidence:
          "Sherwin-Williams invoice 9704-1 · reusable angle brush and stainless multi-tool plus general DryDex spackling, ordered by crew member Anas with no customer, colour, or job reference",
        source: "audited_crew_shop_tool_purchase",
      },
    ],
    [
      "sherwin_daily_email|6460-5|2026-03-09",
      {
        category: "General paint supplies",
        categories: [
          ["71164", "General paint supplies"],
          ["WL41100A", "General paint supplies"],
        ],
        evidence:
          "Sherwin-Williams invoice 6460-5 · generic DryDex spackling and painter's tape received by crew member Alaa, with no customer, colour, or job reference",
        source: "audited_unassigned_shop_consumables",
      },
    ],
    [
      "sherwin_daily_email|7494-0|2026-05-04",
      {
        category: "General paint supplies",
        expectedLineCount: 5,
        evidence:
          "Sherwin-Williams invoice 7494-0 · trash bags, general tape, roller frame, tray liners, and reusable tray received by crew member Audrey, with no customer, colour, or job reference",
        source: "audited_unassigned_shop_consumables",
      },
    ],
  ]);
  const auditedInvoicePlan = auditedInvoicePlans.get(invoiceKey);
  if (auditedInvoicePlan) {
    const categoryByProductCode = auditedInvoicePlan.categories
      ? new Map(auditedInvoicePlan.categories)
      : null;
    if (categoryByProductCode) {
      if (
        invoiceLines.length !== categoryByProductCode.size ||
        invoiceLines.some(
          (line) => !categoryByProductCode.has(line.product_code),
        )
      ) {
        throw new Error(
          `Audited overhead invoice ${invoice.invoice_number} line evidence changed; refusing allocation.`,
        );
      }
    } else if (invoiceLines.length !== auditedInvoicePlan.expectedLineCount) {
      throw new Error(
        `Audited overhead invoice ${invoice.invoice_number} line count changed; refusing allocation.`,
      );
    }
    return {
      kind: "overhead",
      category: auditedInvoicePlan.category,
      method: "overhead_rule",
      confidence: 1,
      lineOverheadCategories: categoryByProductCode
        ? Object.fromEntries(categoryByProductCode)
        : null,
      evidence: auditedInvoicePlan.evidence,
      source: auditedInvoicePlan.source,
    };
  }
  if (
    invoice.source_system !== "gmail_home_depot_order" ||
    invoice.external_invoice_id !== "home-depot-order:240846171"
  ) {
    return null;
  }
  const categoryByProductCode = new Map([
    ["1000738387", "General paint supplies"],
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
    category: "General paint supplies",
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
    [...new Set(plans.map((plan) => plan.project_name ?? plan.overhead_category))]
      .sort()
      .map((name) => [
        name,
        plans.filter(
          (plan) => (plan.project_name ?? plan.overhead_category) === name,
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
