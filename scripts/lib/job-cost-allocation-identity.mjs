export async function fetchAll(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await buildQuery().range(start, start + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dateValue(value) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function allocationDate(row) {
  return row.invoiceDate ?? row.sourceDate ?? null;
}

function chooseByDate(proposalIds, jobsByProposal, date) {
  if (proposalIds.size <= 1 || !date) return [...proposalIds];
  const at = dateValue(date);
  if (at == null) return [...proposalIds];
  const DAY = 24 * 60 * 60 * 1000;
  const inWindow = [...proposalIds].filter((proposalId) => {
    const job = jobsByProposal.get(proposalId);
    if (!job) return false;
    const signed = dateValue(job.proposal_signed_on);
    const started = dateValue(job.job_start_on);
    const completed = dateValue(job.job_completion_on);
    const lower = (signed ?? started ?? completed ?? at) - 30 * DAY;
    const upper = (completed ?? started ?? signed ?? at) + 30 * DAY;
    return at >= lower && at <= upper;
  });
  if (inWindow.length === 1) return inWindow;

  const ordered = [...proposalIds]
    .map((proposalId) => {
      const job = jobsByProposal.get(proposalId);
      const anchor = dateValue(
        job?.job_start_on ?? job?.job_completion_on ?? job?.proposal_signed_on,
      );
      return {
        proposalId,
        distance:
          anchor == null ? Number.POSITIVE_INFINITY : Math.abs(at - anchor),
      };
    })
    .sort((left, right) => left.distance - right.distance);
  if (
    ordered.length > 0 &&
    Number.isFinite(ordered[0].distance) &&
    (ordered.length === 1 || ordered[0].distance + 14 * DAY < ordered[1].distance)
  ) {
    return [ordered[0].proposalId];
  }
  return [...proposalIds];
}

function addToSetMap(map, key, value) {
  if (!key || !value) return;
  const values = map.get(key) ?? new Set();
  values.add(value);
  map.set(key, values);
}

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function proposalFromBudgetNotes(notes) {
  return String(notes ?? "").match(/\bproposal\s+([0-9]+)\b/i)?.[1] ?? null;
}

export async function resolveJobCostAllocationIdentities(db) {
  const [
    jobs,
    projects,
    projectBudgets,
    customerInvoices,
    leadJobLinks,
    leadProjectLinks,
    materialAllocations,
    labourAllocations,
  ] = await Promise.all([
    fetchAll(() =>
      db
        .from("dripjobs_jobs")
        .select(
          "proposal_id,job_name,status,proposal_signed_on,job_start_on,job_completion_on,accounting_status",
        ),
    ),
    fetchAll(() =>
      db
        .from("companycam_projects")
        .select("companycam_id,name,formatted_address,is_archived,is_lead"),
    ),
    fetchAll(() =>
      db.from("project_budgets").select("companycam_project_id,notes"),
    ),
    fetchAll(() =>
      db
        .from("customer_invoices")
        .select(
          "id,external_proposal_id,companycam_project_id,invoice_date,customer_name,accounting_status",
        ),
    ),
    fetchAll(() =>
      db
        .from("marketing_lead_job_links")
        .select("lead_deal_id,job_proposal_id,relationship_type,link_status"),
    ),
    fetchAll(() =>
      db
        .from("marketing_lead_project_links")
        .select("lead_deal_id,companycam_project_id,relationship_type,link_status"),
    ),
    fetchAll(() =>
      db
        .from("material_invoice_line_allocations")
        .select(
          "id,companycam_project_id,allocated_before_tax,allocation_method,evidence_reference,source_payload,needs_review,material_invoice_lines!inner(material_invoices!inner(id,invoice_number,invoice_date,po_number,supplier_name))",
        )
        .eq("allocation_scope", "job")
        .is("reversed_at", null),
    ),
    fetchAll(() =>
      db
        .from("labour_invoice_line_allocations")
        .select(
          "invoice_line_id,companycam_project_id,allocated_amount,allocation_method,needs_review,labour_invoice_lines!inner(labour_invoices!inner(id,invoice_number,invoice_date,source_date,supplier_name))",
        ),
    ),
  ]);

  const jobsByProposal = new Map(jobs.map((job) => [job.proposal_id, job]));
  const projectById = new Map(
    projects.map((project) => [project.companycam_id, project]),
  );
  const jobsByName = new Map();
  for (const job of jobs) {
    addToSetMap(jobsByName, normalize(job.job_name), job.proposal_id);
  }

  const proposalsByBudgetProject = new Map();
  for (const budget of projectBudgets) {
    const proposalId = proposalFromBudgetNotes(budget.notes);
    if (proposalId && jobsByProposal.has(proposalId)) {
      addToSetMap(
        proposalsByBudgetProject,
        budget.companycam_project_id,
        proposalId,
      );
    }
  }

  const proposalsByInvoiceProject = new Map();
  for (const invoice of customerInvoices) {
    if (invoice.accounting_status === "void") continue;
    if (!jobsByProposal.has(invoice.external_proposal_id)) continue;
    addToSetMap(
      proposalsByInvoiceProject,
      invoice.companycam_project_id,
      invoice.external_proposal_id,
    );
  }

  const proposalsByLead = new Map();
  for (const link of leadJobLinks) {
    if (
      link.link_status !== "confirmed" ||
      link.relationship_type !== "originated"
    ) {
      continue;
    }
    addToSetMap(proposalsByLead, link.lead_deal_id, link.job_proposal_id);
  }
  const proposalsByLeadProject = new Map();
  for (const link of leadProjectLinks) {
    if (
      link.link_status !== "confirmed" ||
      link.relationship_type !== "originated"
    ) {
      continue;
    }
    for (const proposalId of proposalsByLead.get(link.lead_deal_id) ?? []) {
      addToSetMap(
        proposalsByLeadProject,
        link.companycam_project_id,
        proposalId,
      );
    }
  }

  function candidatesFor(projectId, date) {
    const exactSynthetic = projectId?.match(/^dripjobs-(.+)$/)?.[1];
    if (exactSynthetic && jobsByProposal.has(exactSynthetic)) {
      return {
        proposalIds: [exactSynthetic],
        method: "synthetic_project_id",
        confidence: 1,
      };
    }

    const budgetCandidates = new Set(
      proposalsByBudgetProject.get(projectId) ?? [],
    );
    if (budgetCandidates.size === 1) {
      return {
        proposalIds: [...budgetCandidates],
        method: "project_budget_proposal",
        confidence: 1,
      };
    }

    const invoiceCandidates = new Set(
      proposalsByInvoiceProject.get(projectId) ?? [],
    );
    const datedInvoiceCandidates = chooseByDate(
      invoiceCandidates,
      jobsByProposal,
      date,
    );
    if (datedInvoiceCandidates.length === 1) {
      return {
        proposalIds: datedInvoiceCandidates,
        method: "customer_invoice_project",
        confidence: invoiceCandidates.size === 1 ? 1 : 0.98,
      };
    }

    const leadCandidates = new Set(
      proposalsByLeadProject.get(projectId) ?? [],
    );
    const datedLeadCandidates = chooseByDate(
      leadCandidates,
      jobsByProposal,
      date,
    );
    if (datedLeadCandidates.length === 1) {
      return {
        proposalIds: datedLeadCandidates,
        method: "confirmed_lead_bridge",
        confidence: leadCandidates.size === 1 ? 0.98 : 0.95,
      };
    }

    const project = projectById.get(projectId);
    const nameCandidates = new Set(
      jobsByName.get(normalize(project?.name)) ?? [],
    );
    const datedNameCandidates = chooseByDate(
      nameCandidates,
      jobsByProposal,
      date,
    );
    if (datedNameCandidates.length === 1) {
      return {
        proposalIds: datedNameCandidates,
        method:
          nameCandidates.size === 1
            ? "unique_exact_name"
            : "exact_name_and_date",
        confidence: nameCandidates.size === 1 ? 0.96 : 0.92,
      };
    }

    return {
      proposalIds: [
        ...new Set([
          ...budgetCandidates,
          ...datedInvoiceCandidates,
          ...datedLeadCandidates,
          ...datedNameCandidates,
        ]),
      ],
      method: "unresolved",
      confidence: 0,
    };
  }

  const allocations = [
    ...materialAllocations.map((allocation) => {
      const invoice = one(one(allocation.material_invoice_lines)?.material_invoices);
      return {
        kind: "material",
        allocationId: allocation.id,
        projectId: allocation.companycam_project_id,
        amount: Number(allocation.allocated_before_tax ?? 0),
        needsReview: allocation.needs_review,
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.invoice_number ?? null,
        invoiceDate: invoice?.invoice_date ?? null,
        sourceDate: null,
        supplierName: invoice?.supplier_name ?? null,
      };
    }),
    ...labourAllocations.map((allocation) => {
      const invoice = one(one(allocation.labour_invoice_lines)?.labour_invoices);
      return {
        kind: "labour",
        allocationId: allocation.invoice_line_id,
        projectId: allocation.companycam_project_id,
        amount: Number(allocation.allocated_amount ?? 0),
        needsReview: allocation.needs_review,
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.invoice_number ?? null,
        invoiceDate: invoice?.invoice_date ?? null,
        sourceDate: invoice?.source_date ?? null,
        supplierName: invoice?.supplier_name ?? null,
      };
    }),
  ].map((allocation) => ({
    ...allocation,
    projectName: projectById.get(allocation.projectId)?.name ?? null,
    resolution: candidatesFor(allocation.projectId, allocationDate(allocation)),
  }));

  return {
    jobs,
    projects,
    projectBudgets,
    customerInvoices,
    leadJobLinks,
    leadProjectLinks,
    allocations,
  };
}

export function summarizeJobCostAllocationIdentities(allocations) {
  const methodCounts = {};
  const mappedTotals = { material: 0, labour: 0 };
  const unresolvedTotals = { material: 0, labour: 0 };
  const unresolved = [];
  for (const allocation of allocations) {
    const method = allocation.resolution.method;
    methodCounts[method] = (methodCounts[method] ?? 0) + 1;
    const resolved = allocation.resolution.proposalIds.length === 1;
    const totals = resolved ? mappedTotals : unresolvedTotals;
    totals[allocation.kind] += allocation.amount;
    if (!resolved) unresolved.push(allocation);
  }
  return { methodCounts, mappedTotals, unresolvedTotals, unresolved };
}
