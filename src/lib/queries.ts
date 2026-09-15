import { createClient } from "@/lib/supabase/server";
import { selectCurrentOperationalBudgets } from "@/lib/job-budget-selection";
import type {
  Assignment,
  EmployeeLocationPoint,
  EmployeePayRate,
  EmployeeProfile,
  EmployeeTrackingStatus,
  MarketingLead,
  Project,
  ProjectBudget,
  ProjectLabourExpense,
  ProjectLabourTask,
  TimeEntry,
} from "@/lib/types";

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

export async function getDealsPage(search: string, page: number): Promise<{ rows: MarketingLead[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_deals_page", { search_text: search, page_number: page });
  if (error) throw new Error(`deals: ${error.message}`);
  return data;
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
