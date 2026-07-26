#!/usr/bin/env node

import fs from "node:fs";

const [livePath, manifestPath, allJobsPath, outputPath] = process.argv.slice(2);
if (!livePath || !manifestPath || !allJobsPath || !outputPath) {
  throw new Error(
    "Usage: node reconcile-proposal-links.mjs <live.json> <manifest.json> <all-jobs.json> <output.json>",
  );
}

const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const workbook = JSON.parse(fs.readFileSync(allJobsPath, "utf8"));

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanProjectName(value) {
  return String(value ?? "")
    .replace(/\s+[—-]\s+proposal\s+\d+.*$/i, "")
    .replace(/\s+-\s+20\d{2}-\d{2}-\d{2}T.*$/i, "")
    .trim();
}

function isGenericJobName(value) {
  const normalized = normalize(value);
  return (
    !normalized ||
    /^(interior|exterior|deck|fence|cabinet|commercial|residential)\b/.test(
      normalized,
    ) ||
    /\b(painting|staining|quote|estimate|dont book|do not book)\b/.test(
      normalized,
    )
  );
}

function parseDate(value) {
  if (!value || /^n\/a$/i.test(String(value).trim())) return null;
  const text = String(value).trim();
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function dateDistanceDays(left, right) {
  if (!left || !right) return null;
  return Math.round(
    Math.abs(new Date(`${left}T12:00:00Z`) - new Date(`${right}T12:00:00Z`)) /
      86_400_000,
  );
}

function projectAliases(project, sourceRecord) {
  const raw = project?.raw ?? {};
  const dripjobs = raw.dripjobs ?? {};
  const primaryContact = raw.primary_contact ?? {};
  const preferred = [
    primaryContact.name,
    dripjobs.customer_name,
    sourceRecord?.["Customer Name"],
  ];
  const fallback = [
    project?.name,
    cleanProjectName(project?.name),
    dripjobs.job,
    sourceRecord?.Job,
  ].filter((value) => !isGenericJobName(value));
  return [...preferred, ...fallback]
    .map(cleanProjectName)
    .map(normalize)
    .filter((value) => value.length >= 5 && value.split(" ").length >= 2);
}

function proposalIdFromNotes(notes) {
  return String(notes ?? "").match(/proposal[ :]+([0-9]+)/i)?.[1] ?? null;
}

function signedDateFromNotes(notes) {
  return parseDate(
    String(notes ?? "").match(/proposal signed\s+(.+?)(?:\. Formula:|\.?$)/i)?.[1],
  );
}

const sourceByProposal = new Map(
  workbook.records.map((record) => [String(record["Proposal ID"]), record]),
);
const projectById = new Map(
  live.projects.map((project) => [String(project.companycam_id), project]),
);

const jobs = live.budgets
  .map((budget) => {
    const proposalId = proposalIdFromNotes(budget.notes);
    if (!proposalId) return null;
    const project = projectById.get(String(budget.companycam_project_id));
    if (!project) return null;
    const source = sourceByProposal.get(proposalId);
    const rawDripJobs = project.raw?.dripjobs ?? {};
    const aliases = [...new Set(projectAliases(project, source))];
    const signedDate =
      signedDateFromNotes(budget.notes) ??
      parseDate(source?.["Proposal Signed Date"]) ??
      parseDate(rawDripJobs.proposal_signed_date);
    const startDate =
      parseDate(source?.["Job Start Date"]) ??
      parseDate(rawDripJobs.job_start_date) ??
      budget.labour_invoice_job_started_on ??
      null;
    const completionDate =
      parseDate(source?.["Job Completion Date"]) ??
      parseDate(rawDripJobs.job_completion_date);
    return {
      proposalId,
      projectId: String(project.companycam_id),
      name: cleanProjectName(project.name),
      address: project.formatted_address,
      aliases,
      signedDate,
      startDate,
      completionDate,
      isSynthetic: String(project.companycam_id).startsWith("dripjobs-"),
      isComplete: Boolean(budget.labour_closed_at),
    };
  })
  .filter(Boolean);

jobs.push(
  {
    proposalId: "1802104",
    projectId: "dripjobs-1802104",
    name: "Drywall repair",
    address: null,
    aliases: ["drywall repair"],
    signedDate: null,
    startDate: null,
    completionDate: null,
    isSynthetic: true,
    isComplete: false,
  },
);

const jobByProposal = new Map(jobs.map((job) => [job.proposalId, job]));
const jobsByProject = new Map(jobs.map((job) => [job.projectId, job]));
const jobsByAlias = new Map();
for (const job of jobs) {
  for (const alias of job.aliases) {
    const matches = jobsByAlias.get(alias) ?? [];
    matches.push(job);
    jobsByAlias.set(alias, matches);
  }
}
for (const matches of jobsByAlias.values()) {
  matches.sort((left, right) =>
    String(left.signedDate ?? left.startDate ?? "").localeCompare(
      String(right.signedDate ?? right.startDate ?? ""),
    ),
  );
}

const manifestByHash = new Map(manifest.map((item) => [item.sha256, item]));
const currentLinksByInvoice = new Map();
for (const link of live.links) {
  const links = currentLinksByInvoice.get(link.invoice_id) ?? [];
  links.push(link);
  currentLinksByInvoice.set(link.invoice_id, links);
}

function containsAlias(text, alias) {
  return (` ${text} `).includes(` ${alias} `);
}

function bestJobForAlias(matches, invoiceDate) {
  if (matches.length === 1) {
    return { job: matches[0], confidence: "unique_name", dateDistance: null };
  }
  const scored = matches
    .map((job) => {
      const anchor = job.completionDate ?? job.startDate ?? job.signedDate;
      const distance = dateDistanceDays(invoiceDate, anchor);
      const invoiceTime = invoiceDate ? Date.parse(`${invoiceDate}T12:00:00Z`) : null;
      const signedTime = job.signedDate ? Date.parse(`${job.signedDate}T12:00:00Z`) : null;
      const beforeSignedPenalty =
        invoiceTime != null && signedTime != null && invoiceTime < signedTime
          ? 1000 + Math.round((signedTime - invoiceTime) / 86_400_000)
          : 0;
      return {
        job,
        distance: distance ?? 999,
        score: (distance ?? 999) + beforeSignedPenalty,
      };
    })
    .sort((left, right) => left.score - right.score);
  if (!scored.length) return null;
  const winner = scored[0];
  const runnerUp = scored[1];
  const gap = runnerUp ? runnerUp.score - winner.score : 999;
  if (winner.score > 180 || gap < 21) {
    return {
      job: winner.job,
      confidence: "ambiguous_repeat_name",
      dateDistance: winner.distance,
      runnerUpGap: gap,
    };
  }
  return {
    job: winner.job,
    confidence: "repeat_name_date",
    dateDistance: winner.distance,
    runnerUpGap: gap,
  };
}

function allocationForJob(item, currentLinks, job) {
  const override = PROPOSAL_ALLOCATION_OVERRIDES[item.source_filename]?.[job.proposalId];
  if (override != null) return override;
  const direct = currentLinks.find((link) => link.companycam_project_id === job.projectId);
  if (direct?.allocated_amount != null) return Number(direct.allocated_amount);

  const candidate = (item.match_candidates ?? []).find((match) =>
    job.aliases.some((alias) => containsAlias(normalize(match.project_name), alias)),
  );
  if (candidate?.allocated_amount != null) return Number(candidate.allocated_amount);

  if ((item.match_candidates ?? []).length === 1 && item.amount_before_tax != null) {
    return Number(item.amount_before_tax);
  }
  return null;
}

const PROPOSAL_ALLOCATION_OVERRIDES = {
  "2025-09-11 - INV-000197.pdf": {
    "1802104": 1700,
    "1843130": 1170,
    "1863401": 3313,
    "1908370": 4025,
  },
  "2025-10-20 - INV-000197.pdf": {
    "1802104": 0,
    "1843130": 1170,
    "1863401": 3313,
    "1908370": 3615,
  },
  "2026-03-03 - INV-20260302-001.pdf": {
    "2473605": 62.5,
    "2383685": 375,
    "2503613": 512.5,
  },
  "2026-07-11 - Invoice_8597_2026-07-11.pdf": {
    "3006955": 90,
    "2792324": 90,
    "2831558": 90,
  },
  "2026-07-15 - Invoice_1_2026-07-17.pdf": {
    "2539077": 592.5,
    "2861121": 480,
    "3006955": 547.5,
    "2831558": 540,
    "2818842": 540,
    "2930976": 510,
    "3016962": 480,
  },
  "2026-07-20 - GT-INV-202607-03-Ottawa-Painters.pdf": {
    "3022357": 1100,
    "2866196": 300,
  },
};

const PROPOSAL_LINK_OVERRIDES = {
  "2025-10-20 - INV-000197.pdf": ["1802104"],
  "2026-03-03 - INV-20260302-001.pdf": ["2383685", "2503613"],
};

const CURRENT_LINK_DROP_OVERRIDES = {
  "2026-03-03 - INV-20260302-001.pdf": ["99182464"],
};

const PROPOSAL_SELECTION_BLOCKS = {
  "2026-07-22 - Invoice_8603_2026-07-21.pdf": ["2663981"],
  "2026-07-24 - GT-INV-202707-04-Ottawa-Painters.pdf": ["2663981"],
};

const reconciliations = [];
for (const invoice of live.invoices) {
  const item = manifestByHash.get(invoice.content_sha256) ?? {};
  const invoiceDate = invoice.invoice_date ?? invoice.source_date;
  const text = normalize(
    [
      invoice.original_filename,
      invoice.invoice_number,
      invoice.text_excerpt,
      item.text_excerpt,
    ].join("\n"),
  );
  const currentLinks = currentLinksByInvoice.get(invoice.id) ?? [];
  const isOperationalDocument = !["overhead_unmatched", "not_invoice"].includes(
    invoice.match_status,
  );
  const explicitProposalIds = [
    ...new Set((text.match(/\b[0-9]{7}\b/g) ?? []).filter((id) => jobByProposal.has(id))),
  ];
  const selected = new Map();

  for (const proposalId of isOperationalDocument ? explicitProposalIds : []) {
    const job = jobByProposal.get(proposalId);
    selected.set(job.projectId, {
      job,
      confidence: "explicit_proposal",
      evidence: [`proposal:${proposalId}`],
    });
  }
  for (const proposalId of PROPOSAL_LINK_OVERRIDES[item.source_filename] ?? []) {
    const job = jobByProposal.get(proposalId);
    if (!job || !isOperationalDocument) continue;
    selected.set(job.projectId, {
      job,
      confidence: "verified_invoice_line",
      evidence: [`proposal:${proposalId}`, "verified_invoice_line"],
    });
  }

  const matchingAliases = (isOperationalDocument ? [...jobsByAlias.entries()] : [])
    .filter(([alias]) => containsAlias(text, alias))
    .sort((left, right) => right[0].length - left[0].length);
  const usedAliases = new Set();
  for (const [alias, matches] of matchingAliases) {
    if ([...usedAliases].some((used) => used.includes(alias) || alias.includes(used))) {
      continue;
    }
    usedAliases.add(alias);
    const chosen = bestJobForAlias(matches, invoiceDate);
    if (!chosen || chosen.confidence === "ambiguous_repeat_name") continue;
    if (
      (PROPOSAL_SELECTION_BLOCKS[item.source_filename] ?? []).includes(
        chosen.job.proposalId,
      )
    ) {
      continue;
    }
    if (!selected.has(chosen.job.projectId)) {
      selected.set(chosen.job.projectId, {
        job: chosen.job,
        confidence: chosen.confidence,
        evidence: [
          `name:${alias}`,
          ...(chosen.dateDistance == null ? [] : [`date_distance_days:${chosen.dateDistance}`]),
        ],
      });
    }
  }

  for (const link of currentLinks) {
    if (
      (CURRENT_LINK_DROP_OVERRIDES[item.source_filename] ?? []).includes(
        String(link.companycam_project_id),
      )
    ) {
      continue;
    }
    const job = jobsByProject.get(String(link.companycam_project_id));
    const currentProject = projectById.get(String(link.companycam_project_id));
    const currentAliases = job?.aliases?.length
      ? job.aliases
      : [normalize(cleanProjectName(currentProject?.name))].filter(Boolean);
    const replacedByProposalJob = [...selected.values()].some((selection) =>
      selection.job?.aliases.some((alias) => currentAliases.includes(alias)),
    );
    if (replacedByProposalJob || selected.has(String(link.companycam_project_id))) {
      continue;
    }
    const invoiceHasJobAlias = currentAliases.some((alias) =>
      containsAlias(text, alias),
    );
    selected.set(String(link.companycam_project_id), {
      job: job ?? null,
      projectId: String(link.companycam_project_id),
      projectName: currentProject?.name ?? "Existing project",
      confidence: job
        ? invoiceHasJobAlias
          ? "existing_link_name_confirmed"
          : "existing_link_only"
        : "existing_link_unscoped",
      evidence: [
        `existing_link:${link.companycam_project_id}`,
        ...(invoiceHasJobAlias ? ["invoice_name_confirmed"] : []),
      ],
      currentLink: link,
    });
  }

  const recommendedLinks = [...selected.values()].map((selection, index) => ({
    projectId: selection.job?.projectId ?? selection.projectId,
    proposalId: selection.job?.proposalId ?? null,
    projectName: selection.job?.name ?? selection.projectName,
    allocatedAmount: selection.job
      ? allocationForJob(item, currentLinks, selection.job)
      : selection.currentLink?.allocated_amount == null
        ? null
        : Number(selection.currentLink.allocated_amount),
    confidence: selection.confidence,
    evidence: selection.evidence,
    isPrimary: index === 0,
  }));
  if (
    recommendedLinks.length === 1 &&
    recommendedLinks[0].allocatedAmount == null &&
    invoice.document_type === "invoice" &&
    invoice.amount_before_tax != null
  ) {
    recommendedLinks[0].allocatedAmount = Number(invoice.amount_before_tax);
  }

  reconciliations.push({
    invoiceId: invoice.id,
    filename: invoice.original_filename,
    invoiceNumber: invoice.invoice_number,
    invoiceDate,
    supplier: invoice.supplier_name,
    amountBeforeTax:
      invoice.amount_before_tax == null ? null : Number(invoice.amount_before_tax),
    documentType: invoice.document_type,
    matchStatus: invoice.match_status,
    duplicateGroupId: invoice.duplicate_group_id,
    explicitProposalIds,
    currentLinks: currentLinks.map((link) => ({
      projectId: String(link.companycam_project_id),
      proposalId:
        jobsByProject.get(String(link.companycam_project_id))?.proposalId ?? null,
      allocatedAmount:
        link.allocated_amount == null ? null : Number(link.allocated_amount),
      matchScore: link.match_score,
      matchMethod: link.match_method,
      needsReview: link.needs_review,
    })),
    recommendedLinks,
  });
}

const recommendedJobIds = new Set(
  reconciliations.flatMap((invoice) =>
    invoice.recommendedLinks.map((link) => link.projectId),
  ),
);
const directlyMatchedInvoices = reconciliations.filter(
  (invoice) => invoice.explicitProposalIds.length,
);
const changedInvoices = reconciliations.filter((invoice) => {
  const current = invoice.currentLinks.map((link) => link.projectId).sort().join("|");
  const recommended = invoice.recommendedLinks
    .map((link) => link.projectId)
    .sort()
    .join("|");
  return current !== recommended;
});
const unallocatedMultiJobLinks = reconciliations.flatMap((invoice) =>
  invoice.recommendedLinks
    .filter(
      (link) =>
        invoice.recommendedLinks.length > 1 &&
        link.allocatedAmount == null &&
        invoice.documentType === "invoice",
    )
    .map((link) => ({
      invoiceId: invoice.invoiceId,
      filename: invoice.filename,
      projectId: link.projectId,
      proposalId: link.proposalId,
    })),
);

const output = {
  generatedAt: new Date().toISOString(),
  summary: {
    proposalJobs: jobs.length,
    syntheticProposalJobs: jobs.filter((job) => job.isSynthetic).length,
    invoices: reconciliations.length,
    currentLinks: live.links.length,
    recommendedLinks: reconciliations.reduce(
      (sum, invoice) => sum + invoice.recommendedLinks.length,
      0,
    ),
    directlyMatchedInvoices: directlyMatchedInvoices.length,
    changedInvoices: changedInvoices.length,
    proposalJobsWithInvoices: recommendedJobIds.size,
    proposalJobsWithoutInvoices: jobs.length - recommendedJobIds.size,
    unallocatedMultiJobLinks: unallocatedMultiJobLinks.length,
  },
  duplicateAliases: [...jobsByAlias.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([alias, matches]) => ({
      alias,
      jobs: matches.map((job) => ({
        proposalId: job.proposalId,
        projectId: job.projectId,
        signedDate: job.signedDate,
        startDate: job.startDate,
        completionDate: job.completionDate,
      })),
    })),
  jobs,
  invoices: reconciliations,
  changedInvoices,
  unallocatedMultiJobLinks,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output.summary, null, 2));
