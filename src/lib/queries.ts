import { createClient } from "@/lib/supabase/server";
import type {
  Assignment,
  EmployeeLocationPoint,
  EmployeePayRate,
  EmployeeProfile,
  EmployeeTrackingStatus,
  MarketingLead,
  MarketingLeadProject,
  Project,
  ProjectBudget,
  ProjectLabourExpense,
  ProjectLabourTask,
  ProjectLabourTaskTimeEntry,
  TimeEntry,
} from "@/lib/types";

const ENTRY_COLUMNS =
  "id,client_entry_id,user_id,user_email,user_name,companycam_project_id,project_name,project_address,original_started_at,started_at,start_edited_at,ended_at,status,clock_in_latitude,clock_in_longitude,last_distance_meters,is_on_site,segments,adjustment_history,notes,approved_at,approved_by,inserted_at,updated_at";

/** Time entries started on/after `sinceIso`, plus any still-active shift. */
export async function getTimeEntries(sinceIso?: string): Promise<TimeEntry[]> {
  const supabase = await createClient();
  let query = supabase
    .from("time_entries")
    .select(ENTRY_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(5000);
  if (sinceIso) {
    query = query.or(`started_at.gte.${sinceIso},status.eq.active`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`time_entries: ${error.message}`);
  return (data ?? []) as unknown as TimeEntry[];
}

export async function getActiveEntries(): Promise<TimeEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_entries")
    .select(ENTRY_COLUMNS)
    .eq("status", "active")
    .order("started_at", { ascending: true });
  if (error) throw new Error(`active entries: ${error.message}`);
  return (data ?? []) as unknown as TimeEntry[];
}

export async function getEmployees(): Promise<EmployeeProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("user_id,email,full_name,role,is_active")
    .order("full_name", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`employees: ${error.message}`);
  return (data ?? []) as EmployeeProfile[];
}

export async function getEmployeeTrackingStatuses(): Promise<EmployeeTrackingStatus[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_tracking_status")
    .select(
      "user_id,user_email,user_name,time_entry_id,client_entry_id,companycam_project_id,project_name,project_address,latitude,longitude,accuracy_meters,last_location_at,last_sync_at,tracking_mode,task_status,metadata,updated_at",
    )
    .order("last_location_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`employee_tracking_status: ${error.message}`);
  return (data ?? []) as unknown as EmployeeTrackingStatus[];
}

export async function getEmployeeLocationPoints(
  userIds: string[],
  sinceIso: string,
): Promise<EmployeeLocationPoint[]> {
  if (userIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_location_points")
    .select(
      "id,client_event_id,user_id,time_entry_id,client_entry_id,companycam_project_id,latitude,longitude,accuracy_meters,speed_mps,heading_degrees,tracking_mode,event_type,distance_from_project_meters,is_on_site,captured_at,received_at",
    )
    .in("user_id", [...new Set(userIds)])
    .gte("captured_at", sinceIso)
    .order("captured_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`employee_location_points: ${error.message}`);
  return (data ?? []) as unknown as EmployeeLocationPoint[];
}

export async function getEmployeePayRates(): Promise<EmployeePayRate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_pay_rates")
    .select("id,user_id,hourly_rate,effective_from,notes,inserted_at,updated_at")
    .order("effective_from", { ascending: false });
  if (error) throw new Error(`employee_pay_rates: ${error.message}`);
  return (data ?? []) as EmployeePayRate[];
}

export async function getProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const projectColumns =
    "companycam_id,name,formatted_address,city,state,postal_code,latitude,longitude,is_archived,is_lead,companycam_updated_at";
  const [activeResult, completedBudgetResult, currentDripJobsResult] =
    await Promise.all([
      supabase
        .from("companycam_projects")
        .select(projectColumns)
        .eq("is_archived", false)
        .eq("is_lead", false)
        .order("companycam_updated_at", {
          ascending: false,
          nullsFirst: false,
        })
        .limit(1000),
      supabase
        .from("project_budgets")
        .select("companycam_project_id")
        .not("labour_closed_at", "is", null),
      supabase
        .from("customer_invoices")
        .select("companycam_project_id")
        .eq("is_archived_job", false)
        .not("companycam_project_id", "is", null),
    ]);

  if (activeResult.error) {
    throw new Error(`projects: ${activeResult.error.message}`);
  }
  if (completedBudgetResult.error) {
    throw new Error(
      `completed project budgets: ${completedBudgetResult.error.message}`,
    );
  }
  if (currentDripJobsResult.error) {
    throw new Error(
      `current DripJobs projects: ${currentDripJobsResult.error.message}`,
    );
  }

  const activeProjects = (activeResult.data ?? []) as Project[];
  const activeIds = new Set(
    activeProjects.map((project) => project.companycam_id),
  );
  const additionalProjectIds = [
    ...(completedBudgetResult.data ?? []).map(
      (budget) => budget.companycam_project_id,
    ),
    ...(currentDripJobsResult.data ?? []).map(
      (invoice) => invoice.companycam_project_id,
    ),
  ].filter((projectId): projectId is string => Boolean(projectId));
  const archivedOrCurrentProjectIds = [
    ...new Set(
      additionalProjectIds.filter((projectId) => !activeIds.has(projectId)),
    ),
  ];

  if (archivedOrCurrentProjectIds.length === 0) return activeProjects;

  const { data: archivedCompletedData, error: archivedCompletedError } =
    await supabase
      .from("companycam_projects")
      .select(projectColumns)
      .in("companycam_id", archivedOrCurrentProjectIds)
      .eq("is_lead", false)
      .order("companycam_updated_at", { ascending: false, nullsFirst: false });

  if (archivedCompletedError) {
    throw new Error(`archived completed projects: ${archivedCompletedError.message}`);
  }

  return [
    ...activeProjects,
    ...((archivedCompletedData ?? []) as Project[]),
  ];
}

type MarketingLeadRow = {
  deal_id: string;
  created_on: string;
  created_at_local: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  raw_lead_source: string | null;
  normalized_channel: MarketingLead["normalizedChannel"];
  address: string | null;
  postal_code: string | null;
  estimate_scheduled_on: string | null;
  estimate_appointment_on: string | null;
  proposal_number: string | null;
  proposal_amount: number | null;
  proposal_on: string | null;
  job_crew: string | null;
  is_interior: boolean;
  is_exterior: boolean;
  is_cabinets: boolean;
  source_row_number: number;
};

type LeadProjectRow = {
  companycam_id: string;
  name: string;
  street_address_1: string | null;
  street_address_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  formatted_address: string | null;
  companycam_created_at: string | null;
  last_synced_at: string | null;
  is_lead: boolean;
  is_archived: boolean;
  raw: Record<string, unknown> | null;
};

function companyCamIso(value: unknown): string | null {
  if (value == null || value === "") return null;

  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function leadAddress(project: LeadProjectRow): string | null {
  const parts = [
    project.street_address_1,
    project.street_address_2,
    project.city,
    project.state,
    project.postal_code,
  ].filter((part): part is string => Boolean(part?.trim()));

  if (parts.length === 0) return null;
  return project.formatted_address?.trim() || parts.join(", ");
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedEmail(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-CA");
  return normalized || null;
}

function normalizedPhone(value: unknown): string | null {
  const normalized = String(value ?? "").replace(/\D/g, "");
  if (!normalized) return null;
  return normalized.length === 11 && normalized.startsWith("1")
    ? normalized.slice(1)
    : normalized;
}

function addProjectIndex(
  index: Map<string, LeadProjectRow[]>,
  key: string | null,
  project: LeadProjectRow,
) {
  if (!key) return;
  const matches = index.get(key) ?? [];
  if (!matches.some((candidate) => candidate.companycam_id === project.companycam_id)) {
    matches.push(project);
    index.set(key, matches);
  }
}

function intersectProjects(
  left: LeadProjectRow[],
  right: LeadProjectRow[],
): LeadProjectRow[] {
  const rightIds = new Set(right.map((project) => project.companycam_id));
  return left.filter((project) => rightIds.has(project.companycam_id));
}

async function fetchAllMarketingLeadRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<MarketingLeadRow[]> {
  const rows: MarketingLeadRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("marketing_leads")
      .select(
        "deal_id,created_on,created_at_local,contact_name,email,phone,raw_lead_source,normalized_channel,address,postal_code,estimate_scheduled_on,estimate_appointment_on,proposal_number,proposal_amount,proposal_on,job_crew,is_interior,is_exterior,is_cabinets,source_row_number",
      )
      .order("created_on", { ascending: false })
      .order("source_row_number", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`marketing leads: ${error.message}`);
    const page = (data ?? []) as MarketingLeadRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function getMarketingLeads(): Promise<MarketingLead[]> {
  const supabase = await createClient();
  const [marketingRows, projectsResult, calculatorsResult] = await Promise.all([
    fetchAllMarketingLeadRows(supabase),
    supabase
      .from("companycam_projects")
      .select(
        "companycam_id,name,street_address_1,street_address_2,city,state,postal_code,formatted_address,companycam_created_at,last_synced_at,is_lead,is_archived,raw",
      )
      .eq("is_deleted", false)
      .limit(1000),
    supabase
      .from("project_calculators")
      .select("companycam_project_id,updated_at")
      .limit(5000),
  ]);

  if (projectsResult.error) {
    throw new Error(`CompanyCam lead links: ${projectsResult.error.message}`);
  }
  if (calculatorsResult.error) {
    throw new Error(`lead calculators: ${calculatorsResult.error.message}`);
  }

  const estimateUpdatedByProject = new Map<string, string>(
    (calculatorsResult.data ?? []).map((calculator) => [
      calculator.companycam_project_id,
      calculator.updated_at,
    ]),
  );

  const projects = (projectsResult.data ?? []) as LeadProjectRow[];
  const byContactId = new Map<string, LeadProjectRow[]>();
  const byEmail = new Map<string, LeadProjectRow[]>();
  const byPhone = new Map<string, LeadProjectRow[]>();
  for (const project of projects) {
    const raw = project.raw ?? {};
    const dripJobs = record(raw.dripjobs);
    const primaryContact = record(raw.primary_contact);
    for (const contactId of [dripJobs.contact_uuid, primaryContact.id]) {
      addProjectIndex(byContactId, String(contactId ?? "").trim() || null, project);
    }
    for (const email of [
      dripJobs.customer_email,
      dripJobs.email,
      primaryContact.email,
    ]) {
      addProjectIndex(byEmail, normalizedEmail(email), project);
    }
    for (const phone of [
      dripJobs.customer_phone,
      primaryContact.phone_number,
    ]) {
      addProjectIndex(byPhone, normalizedPhone(phone), project);
    }
  }

  return marketingRows.map((lead) => {
    let matches = byContactId.get(lead.deal_id) ?? [];
    let matchMethod: MarketingLead["companyCamMatchMethod"] = matches.length
      ? "contact_id"
      : null;
    if (!matches.length) {
      const emailMatches = lead.email
        ? byEmail.get(normalizedEmail(lead.email) ?? "") ?? []
        : [];
      const phoneMatches = lead.phone
        ? byPhone.get(normalizedPhone(lead.phone) ?? "") ?? []
        : [];
      if (emailMatches.length && phoneMatches.length) {
        const intersection = intersectProjects(emailMatches, phoneMatches);
        if (intersection.length) {
          matches = intersection;
          matchMethod = "email_and_phone";
        }
      } else if (emailMatches.length) {
        matches = emailMatches;
        matchMethod = "email";
      } else if (phoneMatches.length) {
        matches = phoneMatches;
        matchMethod = "phone";
      }
    }

    const companyCamProjects: MarketingLeadProject[] = matches
      .map((project) => ({
        projectId: project.companycam_id,
        name: project.name,
        address: leadAddress(project),
        isLead: project.is_lead,
        isArchived: project.is_archived,
        estimateUpdatedAt:
          estimateUpdatedByProject.get(project.companycam_id) ?? null,
      }))
      .sort(
        (left, right) =>
          Number(left.isArchived) - Number(right.isArchived) ||
          Number(left.isLead) - Number(right.isLead) ||
          left.name.localeCompare(right.name, "en-CA"),
      );

    return {
      dealId: lead.deal_id,
      createdOn: lead.created_on,
      createdAtLocal: lead.created_at_local,
      name: lead.contact_name?.trim() || "Unnamed lead",
      email: lead.email,
      phone: lead.phone,
      rawLeadSource: lead.raw_lead_source,
      normalizedChannel: lead.normalized_channel,
      address: lead.address,
      postalCode: lead.postal_code,
      estimateScheduledOn: lead.estimate_scheduled_on,
      estimateAppointmentOn: lead.estimate_appointment_on,
      proposalNumber: lead.proposal_number,
      proposalAmount: lead.proposal_amount,
      proposalOn: lead.proposal_on,
      jobCrew: lead.job_crew,
      isInterior: lead.is_interior,
      isExterior: lead.is_exterior,
      isCabinets: lead.is_cabinets,
      sourceRowNumber: lead.source_row_number,
      companyCamMatchMethod: matchMethod,
      companyCamProjects,
    };
  });
}

export async function getBudgets(): Promise<ProjectBudget[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_budgets")
    .select(
      "companycam_project_id,budgeted_hours,amount_including_tax,hourly_rate,notes,labour_closed_at,labour_invoice_job_started_on,updated_at",
    );
  if (error) throw new Error(`budgets: ${error.message}`);
  return (data ?? []) as ProjectBudget[];
}

export async function getProjectLabourExpenses(): Promise<ProjectLabourExpense[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_labour_expenses")
    .select(
      "id,companycam_project_id,worker_user_id,worker_name,supplier_name,invoice_number,invoice_date,amount_before_tax,tax_amount,notes,inserted_at,updated_at",
    )
    .order("invoice_date", { ascending: false });
  if (error) throw new Error(`project_labour_expenses: ${error.message}`);
  return (data ?? []) as ProjectLabourExpense[];
}

/** Active painter tasks published from each job's default calculator. */
export async function getProjectLabourTasks(): Promise<ProjectLabourTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_labour_tasks")
    .select("id,companycam_project_id,title,notes,budgeted_hours,status,sort_order,completed_at,completed_by")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`project_labour_tasks: ${error.message}`);
  return (data ?? []) as unknown as ProjectLabourTask[];
}

export async function getProjectLabourTaskEntries(): Promise<ProjectLabourTaskTimeEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_labour_task_time_entries")
    .select("task_id,user_id,started_at,ended_at,status")
    .order("started_at", { ascending: false })
    .limit(10000);
  if (error) throw new Error(`project_labour_task_time_entries: ${error.message}`);
  return (data ?? []) as unknown as ProjectLabourTaskTimeEntry[];
}

export async function getAssignments(): Promise<Assignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_assignments")
    .select("id,companycam_project_id,user_id,status")
    .eq("status", "active");
  if (error) throw new Error(`assignments: ${error.message}`);
  return (data ?? []) as Assignment[];
}

// ---- Single-job variants: keep the job pages fast by fetching only one
// ---- project's rows instead of the whole company's history.

export async function getProjectById(projectId: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companycam_projects")
    .select(
      "companycam_id,name,formatted_address,city,state,postal_code,latitude,longitude,is_archived,is_lead,companycam_updated_at",
    )
    .eq("companycam_id", projectId)
    .maybeSingle();
  if (error) throw new Error(`project: ${error.message}`);
  return (data as Project | null) ?? null;
}

export async function getProjectTimeEntries(projectId: string, sinceIso?: string): Promise<TimeEntry[]> {
  const supabase = await createClient();
  let query = supabase
    .from("time_entries")
    .select(ENTRY_COLUMNS)
    .eq("companycam_project_id", projectId)
    .order("started_at", { ascending: false })
    .limit(5000);
  if (sinceIso) {
    query = query.or(`started_at.gte.${sinceIso},status.eq.active`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`time_entries: ${error.message}`);
  return (data ?? []) as unknown as TimeEntry[];
}

export async function getProjectBudgetRows(projectId: string): Promise<ProjectBudget[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_budgets")
    .select(
      "companycam_project_id,budgeted_hours,amount_including_tax,hourly_rate,notes,labour_closed_at,labour_invoice_job_started_on,updated_at",
    )
    .eq("companycam_project_id", projectId);
  if (error) throw new Error(`budgets: ${error.message}`);
  return (data ?? []) as ProjectBudget[];
}

export async function getProjectAssignments(projectId: string): Promise<Assignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_assignments")
    .select("id,companycam_project_id,user_id,status")
    .eq("companycam_project_id", projectId)
    .eq("status", "active");
  if (error) throw new Error(`assignments: ${error.message}`);
  return (data ?? []) as Assignment[];
}

export async function getLabourExpensesForProject(projectId: string): Promise<ProjectLabourExpense[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_labour_expenses")
    .select(
      "id,companycam_project_id,worker_user_id,worker_name,supplier_name,invoice_number,invoice_date,amount_before_tax,tax_amount,notes,inserted_at,updated_at",
    )
    .eq("companycam_project_id", projectId)
    .order("invoice_date", { ascending: false });
  if (error) throw new Error(`project_labour_expenses: ${error.message}`);
  return (data ?? []) as ProjectLabourExpense[];
}

export async function getLabourTasksForProject(projectId: string): Promise<ProjectLabourTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_labour_tasks")
    .select("id,companycam_project_id,title,notes,budgeted_hours,status,sort_order,completed_at,completed_by")
    .eq("companycam_project_id", projectId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`project_labour_tasks: ${error.message}`);
  return (data ?? []) as unknown as ProjectLabourTask[];
}

export async function getTaskEntriesForTasks(taskIds: string[]): Promise<ProjectLabourTaskTimeEntry[]> {
  if (taskIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_labour_task_time_entries")
    .select("task_id,user_id,started_at,ended_at,status")
    .in("task_id", taskIds)
    .order("started_at", { ascending: false })
    .limit(10000);
  if (error) throw new Error(`project_labour_task_time_entries: ${error.message}`);
  return (data ?? []) as unknown as ProjectLabourTaskTimeEntry[];
}
