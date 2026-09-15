import { createClient } from "@/lib/supabase/server";
import { selectCurrentOperationalBudgets } from "@/lib/job-budget-selection";
import type {
  Assignment,
  EmployeeLocationPoint,
  EmployeePayRate,
  EmployeeProfile,
  EmployeeTrackingStatus,
  MarketingLead,
  MarketingLeadJob,
  MarketingLeadMedia,
  Project,
  ProjectBudget,
  ProjectLabourExpense,
  ProjectLabourTask,
  TimeEntry,
} from "@/lib/types";
import { selectCanonicalJobId } from "@/lib/project-routing";

// PostgREST serializes `.in(...)` filters into the request URL. Keeping UUID
// batches well below Supabase's 16 KB URL/header limit avoids network-level
// `fetch failed` errors before the query can reach Postgres.
const POSTGREST_IN_FILTER_BATCH_SIZE = 200;

const COMPANYCAM_LEAD_JOB_EXCEPTIONS_WITH_ACCOUNTING_EVIDENCE = new Set([
  "38b6208e-12dd-5e62-b963-591a89868d91", // Graeme Archibald
  "99a4cb86-ec09-54c1-8a95-ffac416cf844", // Katie Kobia
]);

function isMisclassifiedCompanyCamLeadJob(row: any): boolean {
  const labels = Array.isArray(row.metadata?.labels)
    ? row.metadata.labels.map((label: any) =>
        String(label?.display_value ?? label?.value ?? "")
          .trim()
          .toLocaleLowerCase("en-CA"),
      )
    : [];
  return (
    !COMPANYCAM_LEAD_JOB_EXCEPTIONS_WITH_ACCOUNTING_EVIDENCE.has(row.id) &&
    row.source === "legacy_companycam" &&
    Number(row.contract_amount_cents) === 0 &&
    !row.accepted_quote_id &&
    labels.some((label: string) =>
      ["lead", "proposal sent"].includes(label),
    )
  );
}

function timeEntry(row: any): TimeEntry {
  return {
    ...row,
    user_id: row.employee_id,
    user_email: row.employee_email,
    user_name: row.employee_name,
    companycam_project_id: row.job_id,
    project_name: row.job_name,
    project_address: row.job_address,
    status: row.status === "completed" ? "complete" : row.status,
    inserted_at: row.created_at,
  } as TimeEntry;
}

function project(row: any): Project {
  return {
    companycam_id: row.id,
    name: row.name,
    started_on: row.started_on ?? null,
    completed_on: row.completed_on ?? null,
    production_month: row.production_month ?? null,
    formatted_address: row.formatted_address ?? row.address_line_1 ?? null,
    city: row.city,
    state: row.province,
    postal_code: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    is_archived: row.status === "archived",
    is_lead: false,
    companycam_updated_at: row.updated_at,
  };
}

export async function getTimeEntries(sinceIso?: string): Promise<TimeEntry[]> {
  const supabase = await createClient();
  let query = supabase.from("time_entries").select("*").order("started_at", { ascending: false }).limit(5000);
  if (sinceIso) query = query.or(`started_at.gte.${sinceIso},status.eq.active`);
  const { data, error } = await query;
  if (error) throw new Error(`time entries: ${error.message}`);
  return (data ?? []).map(timeEntry);
}

export async function getActiveEntries(): Promise<TimeEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("time_entries").select("*").eq("status", "active").order("started_at");
  if (error) throw new Error(`active entries: ${error.message}`);
  return (data ?? []).map(timeEntry);
}

export async function getEmployees(): Promise<EmployeeProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("employees").select("*").order("full_name", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`employees: ${error.message}`);
  return (data ?? []).map((row: any) => ({ ...row, user_id: row.id }));
}

export async function getEmployeeTrackingStatuses(): Promise<EmployeeTrackingStatus[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_tracking_status").select("*").order("last_location_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`tracking status: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    ...row,
    user_id: row.employee_id,
    user_email: row.employee_email,
    user_name: row.employee_name,
    companycam_project_id: row.job_id,
    project_name: row.job_name,
    project_address: row.job_address,
  }));
}

export async function getEmployeeLocationPoints(userIds: string[], sinceIso: string): Promise<EmployeeLocationPoint[]> {
  if (!userIds.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_location_points")
    .select("*")
    .in("employee_id", [...new Set(userIds)])
    .gte("captured_at", sinceIso)
    .order("captured_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`location points: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    ...row,
    user_id: row.employee_id,
    companycam_project_id: row.job_id,
    distance_from_project_meters: row.distance_from_job_meters,
  }));
}

export async function getEmployeePayRates(): Promise<EmployeePayRate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_pay_rates").select("*").order("effective_from", { ascending: false });
  if (error) throw new Error(`pay rates: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    ...row,
    user_id: row.employee_id,
    hourly_rate: Number(row.hourly_rate_cents) / 100,
    inserted_at: row.created_at,
  }));
}

export async function getProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("is_feed_visible", true)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`jobs: ${error.message}`);
  return (data ?? [])
    .filter((row) => !isMisclassifiedCompanyCamLeadJob(row))
    .map(project);
}

export async function getMarketingLeads(): Promise<MarketingLead[]> {
  const supabase = await createClient();
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("leads")
      .select("*,contact:contacts(id,name,email,phone)")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`leads: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const leadIds = rows.map((row) => row.id);
  const quoteBatches = [];
  for (let index = 0; index < leadIds.length; index += POSTGREST_IN_FILTER_BATCH_SIZE) {
    quoteBatches.push(leadIds.slice(index, index + POSTGREST_IN_FILTER_BATCH_SIZE));
  }
  const quotes: any[] = [];
  // Independent batches must not add one network round trip each to navigation.
  for (let index = 0; index < quoteBatches.length; index += 4) {
    const results = await Promise.all(quoteBatches.slice(index, index + 4).map(ids =>
      supabase.from("quotes").select(
        "id,lead_id,dripjobs_proposal_id,status,accepted_at,updated_at,created_at,amount_cents,job:jobs(id,name,status,started_on,completed_on,contract_amount_cents,is_feed_visible,updated_at)",
      ).in("lead_id", ids),
    ));
    for (const { data, error } of results) {
      if (error) throw new Error(`lead quotes: ${error.message}`);
      quotes.push(...(data ?? []));
    }
  }
  const quotesByLead = new Map<string, any[]>();
  for (const quote of quotes) {
    const list = quotesByLead.get(quote.lead_id) ?? [];
    list.push(quote);
    quotesByLead.set(quote.lead_id, list);
  }

  const prepared = rows.map((row) => {
    const metadata = row.metadata ?? {};
    const leadQuotes = quotesByLead.get(row.id) ?? [];
    const canonicalJobId = selectCanonicalJobId(
      leadQuotes.flatMap((quote) => {
        const relatedJobs = Array.isArray(quote.job)
          ? quote.job
          : quote.job
            ? [quote.job]
            : [];
        return relatedJobs.map((job: any) => ({
          jobId: String(job.id),
          acceptedAt: quote.accepted_at,
          updatedAt: quote.updated_at ?? job.updated_at,
          isFeedVisible: job.is_feed_visible,
          quoteStatus: quote.status,
        }));
      }),
    );
    const canonicalQuote = canonicalJobId
      ? leadQuotes.find((quote) => {
          const relatedJobs = Array.isArray(quote.job)
            ? quote.job
            : quote.job
              ? [quote.job]
              : [];
          return relatedJobs.some((job: any) => job.id === canonicalJobId);
        })
      : null;
    const canonicalJob = canonicalQuote
      ? Array.isArray(canonicalQuote.job)
        ? canonicalQuote.job.find((job: any) => job.id === canonicalJobId)
        : canonicalQuote.job
      : null;
    const job: MarketingLeadJob | null = canonicalJob
      ? {
          jobId: canonicalJob.id,
          proposalId: canonicalQuote.dripjobs_proposal_id ?? canonicalQuote.id,
          jobName: canonicalJob.name,
          status: canonicalJob.status,
          amount: Number(canonicalJob.contract_amount_cents ?? 0) / 100,
          proposalSignedOn: canonicalQuote.accepted_at,
          jobStartOn: canonicalJob.started_on,
          jobCompletionOn: canonicalJob.completed_on,
          linkMethod: "dripjobs_deal_id",
          linkConfidence: 1,
        }
      : null;
    const currentProposal = canonicalQuote ??
      [...leadQuotes]
        .filter((quote) => !["superseded", "declined", "expired"].includes(quote.status))
        .sort(
          (left, right) =>
            Date.parse(right.updated_at ?? right.created_at ?? "") -
            Date.parse(left.updated_at ?? left.created_at ?? ""),
        )[0] ??
      null;
    const currentProposalNumber = currentProposal?.dripjobs_proposal_id ?? null;
    const metadataProposalNumber = metadata.proposal_number ?? null;
    const proposalNumber = currentProposalNumber ?? metadataProposalNumber;
    const proposalAmount = job
      ? job.amount
      : metadata.proposal_amount != null
        ? Number(metadata.proposal_amount)
        : currentProposal && Number(currentProposal.amount_cents ?? 0) > 0
          ? Number(currentProposal.amount_cents) / 100
          : null;
    return {
      leadId: row.id,
      dealId: row.dripjobs_sales_deal_id ?? row.dripjobs_deal_id ?? row.id,
      operationalProjectId: row.id,
      createdOn: String(row.created_at).slice(0, 10),
      updatedAt: row.updated_at ?? row.created_at,
      createdAtLocal: row.created_at,
      name: row.contact?.name?.trim() || "Unnamed lead",
      email: row.contact?.email ?? null,
      phone: row.contact?.phone ?? null,
      rawLeadSource: row.source,
      normalizedChannel: row.normalized_channel,
      address: row.address,
      postalCode: row.postal_code,
      estimateScheduledOn: row.estimate_scheduled_on,
      estimateAppointmentOn: row.estimate_appointment_on,
      proposalNumber,
      proposalAmount,
      proposalOn: canonicalQuote?.accepted_at ?? metadata.proposal_on ?? null,
      jobCrew: metadata.job_crew ?? null,
      isInterior: row.is_interior,
      isExterior: row.is_exterior,
      isCabinets: row.is_cabinets,
      sourceRowNumber: metadata.source_row_number ?? null,
      job,
      media: [] as MarketingLeadMedia[],
      mediaCount: 0,
    } as MarketingLead;
  });

  const leadMediaOwners = prepared
    .filter((lead) => !lead.job)
    .map((lead) => lead.leadId);
  const jobMediaOwners = prepared.flatMap((lead) =>
    lead.job ? [lead.job.jobId] : [],
  );
  const mediaRequests: Array<PromiseLike<{ data: any[] | null; error: any }>> = [];
  for (const [table, foreignKey, owners] of [
    ["leads", "job_media_lead_id_fkey", leadMediaOwners],
    ["jobs", "job_media_job_id_fkey", jobMediaOwners],
  ] as const) {
    for (let index = 0; index < owners.length; index += POSTGREST_IN_FILTER_BATCH_SIZE) {
      // Limit each embedded gallery, not the combined media rows for 200 projects.
      // The separate aggregate counts all visible media, including videos.
      mediaRequests.push(supabase.from(table)
        .select(`id,media:job_media!${foreignKey}(id,media_type),media_count:job_media!${foreignKey}(count)`)
        .in("id", owners.slice(index, index + POSTGREST_IN_FILTER_BATCH_SIZE))
        .eq("media.media_type", "image")
        .order("captured_at", { referencedTable: "media", ascending: false, nullsFirst: false })
        .order("created_at", { referencedTable: "media", ascending: false })
        .order("id", { referencedTable: "media", ascending: true })
        .limit(2, { referencedTable: "media" }));
    }
  }
  const mediaByOwner = new Map<string, { media: MarketingLeadMedia[]; mediaCount: number }>();
  for (const result of await Promise.all(mediaRequests)) {
    if (result.error) throw new Error(`lead media: ${result.error.message}`);
    for (const row of result.data ?? []) {
      mediaByOwner.set(row.id, {
        media: (row.media ?? []).map((item: any) => ({
          id: item.id, ownerProjectId: row.id, mediaType: "image" as const,
        })),
        mediaCount: Number(row.media_count?.[0]?.count ?? 0),
      });
    }
  }
  return prepared.map(lead => ({
    ...lead,
    ...(mediaByOwner.get(lead.job?.jobId ?? lead.leadId) ?? { media: [], mediaCount: 0 }),
  }));
}

export type DripJobsLeadCoverage = {
  total: number;
  confirmed: number;
  needsReview: number;
  missingSource: number;
};

export type DripJobsSyncHealth = {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  ignoredTestEvents: number;
  duplicateDeliveries: number;
  liveLeadEvents: number;
  acceptedProposalEvents: number;
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
};

export async function getDripJobsSyncHealth(): Promise<DripJobsSyncHealth> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_integration_health");
  if (error) throw new Error(`DripJobs sync health: ${error.message}`);
  const row = (data ?? {}) as any;
  return {
    totalEvents: Number(row.total_events ?? 0),
    processedEvents: Number(row.processed_events ?? 0),
    failedEvents: Number(row.failed_events ?? 0),
    ignoredTestEvents: Number(row.ignored_test_events ?? 0),
    duplicateDeliveries: Number(row.duplicate_deliveries ?? 0),
    liveLeadEvents: Number(row.live_lead_events ?? 0),
    acceptedProposalEvents: Number(row.accepted_proposal_events ?? 0),
    lastReceivedAt: row.last_received_at ?? null,
    lastProcessedAt: row.last_processed_at ?? null,
  };
}

export async function getDripJobsLeadCoverage(): Promise<DripJobsLeadCoverage> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").select("id,lead_id").eq("source", "dripjobs");
  if (error) throw new Error(`job coverage: ${error.message}`);
  const rows = data ?? [];
  const confirmed = rows.filter((row) => row.lead_id).length;
  return { total: rows.length, confirmed, needsReview: 0, missingSource: rows.length - confirmed };
}

export async function getBudgets(): Promise<ProjectBudget[]> {
  const supabase = await createClient();
  const [{ data: jobs, error: jobError }, { data: budgets, error: budgetError }] = await Promise.all([
    supabase.from("jobs").select("id,contract_amount_cents,status,completed_on,updated_at"),
    supabase
      .from("job_budgets")
      .select("*")
      .in("source", ["manual", "project_budget"])
      .in("status", ["active", "closed"])
      .order("updated_at", { ascending: false }),
  ]);
  if (jobError) throw new Error(`job amounts: ${jobError.message}`);
  if (budgetError) throw new Error(`budgets: ${budgetError.message}`);
  const latest = selectCurrentOperationalBudgets(budgets ?? []);
  return (jobs ?? []).map((job: any) => {
    const budget = latest.get(job.id);
    const budgetAmountCents = Number(budget?.amount_including_tax_cents ?? 0);
    const contractAmountCents = Number(job.contract_amount_cents ?? 0);
    const amountCents = budgetAmountCents > 0 ? budgetAmountCents : contractAmountCents;
    return {
      companycam_project_id: job.id,
      budgeted_hours: budget?.budget_minutes == null ? null : Number(budget.budget_minutes) / 60,
      amount_including_tax: amountCents > 0 ? amountCents / 100 : null,
      hourly_rate: budget?.hourly_rate_cents == null ? null : Number(budget.hourly_rate_cents) / 100,
      notes: budget?.notes ?? null,
      labour_closed_at: budget?.closed_at ?? null,
      labour_invoice_job_started_on: budget?.metadata?.labour_invoice_job_started_on ?? null,
      updated_at: budget?.updated_at ?? job.updated_at,
    };
  });
}

export async function getProjectLabourTasks(): Promise<ProjectLabourTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_tasks").select("*").order("sort_order");
  if (error) throw new Error(`job tasks: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    companycam_project_id: row.job_id,
    title: row.title,
    notes: row.notes,
    budgeted_hours: row.budget_minutes == null ? null : Number(row.budget_minutes) / 60,
    status: row.status,
    sort_order: row.sort_order,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
  }));
}

export async function getAssignments(): Promise<Assignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_assignments").select("*").eq("status", "active");
  if (error) throw new Error(`assignments: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    companycam_project_id: row.job_id,
    user_id: row.employee_id,
    status: row.status,
  }));
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").select("*").eq("id", projectId).maybeSingle();
  if (error) throw new Error(`job: ${error.message}`);
  return data ? project(data) : null;
}

export type LegacyProjectResolution = {
  kind: "job" | "lead";
  id: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveLegacyProject(projectId: string): Promise<LegacyProjectResolution | null> {
  const supabase = await createClient();

  if (uuidPattern.test(projectId)) {
    const [{ data: job, error: jobError }, { data: lead, error: leadError }] = await Promise.all([
      supabase.from("jobs").select("id").eq("id", projectId).maybeSingle(),
      supabase.from("leads").select("id").eq("id", projectId).maybeSingle(),
    ]);
    if (jobError) throw new Error(`legacy job lookup: ${jobError.message}`);
    if (leadError) throw new Error(`legacy lead lookup: ${leadError.message}`);
    if (job) return { kind: "job", id: job.id };
    if (lead) return { kind: "lead", id: lead.id };
  }

  const jobQueries = [
    supabase.from("jobs").select("id").contains("companycam_project_ids", [projectId]).limit(1).maybeSingle(),
    supabase.from("jobs").select("id").contains("metadata", { legacy_project_ids: [projectId] }).limit(1).maybeSingle(),
    supabase.from("jobs").select("id").contains("metadata", { old_canonical_project_id: projectId }).limit(1).maybeSingle(),
    supabase.from("jobs").select("id").contains("metadata", { old_project_id: projectId }).limit(1).maybeSingle(),
  ];
  const jobResults = await Promise.all(jobQueries);
  for (const result of jobResults) {
    if (result.error) throw new Error(`legacy job lookup: ${result.error.message}`);
    if (result.data) return { kind: "job", id: result.data.id };
  }

  const proposalId = /^dripjobs-(\d+)$/.exec(projectId)?.[1];
  if (proposalId) {
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id")
      .eq("dripjobs_proposal_id", proposalId)
      .maybeSingle();
    if (quoteError) throw new Error(`legacy quote lookup: ${quoteError.message}`);
    if (quote) {
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("id")
        .eq("accepted_quote_id", quote.id)
        .maybeSingle();
      if (jobError) throw new Error(`legacy proposal job lookup: ${jobError.message}`);
      if (job) return { kind: "job", id: job.id };
    }
  }

  const leadQueries = [
    supabase.from("leads").select("id").contains("metadata", { legacy_project_ids: [projectId] }).limit(1).maybeSingle(),
    supabase.from("leads").select("id").contains("metadata", { old_operational_project_id: projectId }).limit(1).maybeSingle(),
    supabase.from("leads").select("id").contains("metadata", { companycam_project_id: projectId }).limit(1).maybeSingle(),
    supabase.from("leads").select("id").contains("metadata", { old_project_id: projectId }).limit(1).maybeSingle(),
  ];
  const leadResults = await Promise.all(leadQueries);
  for (const result of leadResults) {
    if (result.error) throw new Error(`legacy lead lookup: ${result.error.message}`);
    if (result.data) return { kind: "lead", id: result.data.id };
  }

  return null;
}

export async function getProjectTimeEntries(projectId: string, sinceIso?: string): Promise<TimeEntry[]> {
  const supabase = await createClient();
  let query = supabase.from("time_entries").select("*").eq("job_id", projectId).order("started_at", { ascending: false });
  if (sinceIso) query = query.or(`started_at.gte.${sinceIso},status.eq.active`);
  const { data, error } = await query;
  if (error) throw new Error(`job time: ${error.message}`);
  return (data ?? []).map(timeEntry);
}

export async function getProjectBudgetRows(projectId: string): Promise<ProjectBudget[]> {
  return (await getBudgets()).filter((row) => row.companycam_project_id === projectId);
}

export async function getProjectAssignments(projectId: string): Promise<Assignment[]> {
  return (await getAssignments()).filter((row) => row.companycam_project_id === projectId);
}


export async function getLabourTasksForProject(projectId: string): Promise<ProjectLabourTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_tasks").select("*").eq("job_id", projectId).order("sort_order");
  if (error) throw new Error(`job tasks: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    companycam_project_id: row.job_id,
    title: row.title,
    notes: row.notes,
    budgeted_hours: row.budget_minutes == null ? null : Number(row.budget_minutes) / 60,
    status: row.status,
    sort_order: row.sort_order,
    completed_at: row.completed_at,
    completed_by: row.completed_by,
  }));
}
