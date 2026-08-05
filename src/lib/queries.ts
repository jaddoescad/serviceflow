import { createClient } from "@/lib/supabase/server";
import type {
  Assignment,
  EmployeeLocationPoint,
  EmployeePayRate,
  EmployeeProfile,
  EmployeeTrackingStatus,
  MarketingLead,
  MarketingLeadJob,
  Project,
  ProjectBudget,
  ProjectLabourExpense,
  ProjectLabourTask,
  ProjectLabourTaskTimeEntry,
  TimeEntry,
} from "@/lib/types";

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
  return (data ?? []).map(project);
}

export async function getMarketingLeads(): Promise<MarketingLead[]> {
  const supabase = await createClient();
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("leads")
      .select("*,contact:contacts(id,name,email,phone)")
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(`leads: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const leadIds = rows.map((row) => row.id);
  const quotes: any[] = [];
  for (let index = 0; index < leadIds.length; index += 500) {
    const { data, error } = await supabase
      .from("quotes")
      .select("*,job:jobs(id,name,status,started_on,completed_on)")
      .in("lead_id", leadIds.slice(index, index + 500));
    if (error) throw new Error(`lead quotes: ${error.message}`);
    quotes.push(...(data ?? []));
  }
  const quotesByLead = new Map<string, any[]>();
  for (const quote of quotes) {
    const list = quotesByLead.get(quote.lead_id) ?? [];
    list.push(quote);
    quotesByLead.set(quote.lead_id, list);
  }

  return rows.map((row) => {
    const metadata = row.metadata ?? {};
    const dripJobs: MarketingLeadJob[] = (quotesByLead.get(row.id) ?? [])
      .filter((quote) => quote.job)
      .map((quote) => ({
        jobId: quote.job.id,
        proposalId: quote.dripjobs_proposal_id ?? quote.id,
        jobName: quote.job.name,
        status: quote.job.status,
        amount: Number(quote.amount_cents ?? 0) / 100,
        proposalSignedOn: quote.accepted_at,
        jobStartOn: quote.job.started_on,
        jobCompletionOn: quote.job.completed_on,
        linkMethod: "dripjobs_deal_id",
        linkConfidence: 1,
      }));
    return {
      leadId: row.id,
      dealId: row.dripjobs_deal_id ?? row.id,
      operationalProjectId: row.id,
      createdOn: String(row.created_at).slice(0, 10),
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
      proposalNumber: metadata.proposal_number ?? null,
      proposalAmount: metadata.proposal_amount ?? null,
      proposalOn: metadata.proposal_on ?? null,
      jobCrew: metadata.job_crew ?? null,
      isInterior: row.is_interior,
      isExterior: row.is_exterior,
      isCabinets: row.is_cabinets,
      sourceRowNumber: metadata.source_row_number ?? null,
      dripJobs,
    } as MarketingLead;
  });
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
    supabase.from("job_budgets").select("*").in("status", ["active", "closed"]).order("version", { ascending: false }),
  ]);
  if (jobError) throw new Error(`job amounts: ${jobError.message}`);
  if (budgetError) throw new Error(`budgets: ${budgetError.message}`);
  const latest = new Map<string, any>();
  for (const row of budgets ?? []) if (!latest.has(row.job_id)) latest.set(row.job_id, row);
  return (jobs ?? []).map((job: any) => {
    const budget = latest.get(job.id);
    return {
      companycam_project_id: job.id,
      budgeted_hours: budget?.budget_minutes == null ? null : Number(budget.budget_minutes) / 60,
      amount_including_tax: Number(job.contract_amount_cents ?? 0) > 0 ? Number(job.contract_amount_cents) / 100 : null,
      hourly_rate: budget?.hourly_rate_cents == null ? null : Number(budget.hourly_rate_cents) / 100,
      notes: budget?.notes ?? null,
      labour_closed_at: budget?.closed_at ?? (job.status === "completed" ? job.updated_at : null),
      labour_invoice_job_started_on: budget?.metadata?.labour_invoice_job_started_on ?? null,
      updated_at: budget?.updated_at ?? job.updated_at,
    };
  });
}

export async function getProjectLabourExpenses(): Promise<ProjectLabourExpense[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoice_job_allocations")
    .select("id,job_id,subtotal_cents,tax_cents,created_at,updated_at,invoice:invoices(id,category,source_system,invoice_number,issued_on,contact:contacts(name),metadata)")
    .eq("invoice.category", "labour");
  if (error) throw new Error(`labour expenses: ${error.message}`);
  return (data ?? []).flatMap((row: any) => row.invoice ? [{
    id: row.id,
    companycam_project_id: row.job_id,
    worker_user_id: row.invoice.metadata?.worker_user_id ?? null,
    worker_name: row.invoice.metadata?.worker_name ?? row.invoice.contact?.name ?? "Painter",
    supplier_name: row.invoice.contact?.name ?? row.invoice.metadata?.supplier_name ?? "Labour",
    invoice_number: row.invoice.invoice_number,
    invoice_date: row.invoice.issued_on,
    amount_before_tax: Number(row.subtotal_cents ?? 0) / 100,
    tax_amount: Number(row.tax_cents ?? 0) / 100,
    notes: row.invoice.metadata?.notes ?? null,
    inserted_at: row.created_at,
    updated_at: row.updated_at,
  }] : []);
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

export async function getProjectLabourTaskEntries(): Promise<ProjectLabourTaskTimeEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_task_time_entries").select("*");
  if (error) throw new Error(`task time: ${error.message}`);
  return (data ?? []).map((row: any) => ({ ...row, user_id: row.employee_id }));
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

export async function getJobMaterialSummaries(): Promise<Map<string, { amountBeforeTax: number; lineCount: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoice_job_allocations")
    .select("job_id,subtotal_cents,invoice_line_id,invoice:invoices(category)")
    .eq("invoice.category", "material");
  if (error) throw new Error(`material job costs: ${error.message}`);
  const result = new Map<string, { amountBeforeTax: number; lineCount: number }>();
  for (const row of data ?? []) {
    const invoice: any = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
    if (!invoice || invoice.category !== "material") continue;
    const current = result.get(row.job_id) ?? { amountBeforeTax: 0, lineCount: 0 };
    current.amountBeforeTax += Number(row.subtotal_cents ?? 0) / 100;
    if (row.invoice_line_id) current.lineCount += 1;
    result.set(row.job_id, current);
  }
  return result;
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

export async function getLabourExpensesForProject(projectId: string): Promise<ProjectLabourExpense[]> {
  return (await getProjectLabourExpenses()).filter((row) => row.companycam_project_id === projectId);
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

export async function getTaskEntriesForTasks(taskIds: string[]): Promise<ProjectLabourTaskTimeEntry[]> {
  if (!taskIds.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_task_time_entries").select("*").in("task_id", taskIds);
  if (error) throw new Error(`task time: ${error.message}`);
  return (data ?? []).map((row: any) => ({ ...row, user_id: row.employee_id }));
}
