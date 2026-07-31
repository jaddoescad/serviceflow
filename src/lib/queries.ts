import { createClient } from "@/lib/supabase/server";
import type {
  Assignment,
  EmployeeLocationPoint,
  EmployeePayRate,
  EmployeeProfile,
  EmployeeTrackingStatus,
  LeadEstimate,
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

export async function getLeadEstimates(): Promise<LeadEstimate[]> {
  const supabase = await createClient();
  const [leadsResult, calculatorsResult] = await Promise.all([
    supabase
      .from("companycam_projects")
      .select(
        "companycam_id,name,street_address_1,street_address_2,city,state,postal_code,formatted_address,companycam_created_at,last_synced_at,raw",
      )
      .eq("is_lead", true)
      .eq("is_archived", false)
      .eq("is_deleted", false)
      .limit(1000),
    supabase
      .from("project_calculators")
      .select("companycam_project_id,updated_at")
      .limit(5000),
  ]);

  if (leadsResult.error) {
    throw new Error(`leads: ${leadsResult.error.message}`);
  }
  if (calculatorsResult.error) {
    throw new Error(`lead calculators: ${calculatorsResult.error.message}`);
  }

  const estimateUpdatedByProject = new Map(
    (calculatorsResult.data ?? []).map((calculator) => [
      calculator.companycam_project_id,
      calculator.updated_at,
    ]),
  );

  return ((leadsResult.data ?? []) as LeadProjectRow[])
    .map((project) => {
      const raw = project.raw ?? {};
      return {
        projectId: project.companycam_id,
        name: project.name,
        address: leadAddress(project),
        hasStreetAddress: Boolean(project.street_address_1?.trim()),
        createdAt:
          project.companycam_created_at ??
          companyCamIso(raw.created_at ?? raw.inserted_at) ??
          project.last_synced_at,
        estimateUpdatedAt:
          estimateUpdatedByProject.get(project.companycam_id) ?? null,
      };
    })
    .sort(
      (left, right) =>
        (right.createdAt ? Date.parse(right.createdAt) : 0) -
          (left.createdAt ? Date.parse(left.createdAt) : 0) ||
        left.name.localeCompare(right.name, "en-CA"),
    );
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
