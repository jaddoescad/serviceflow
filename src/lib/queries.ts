import { createClient } from "@/lib/supabase/server";
import type {
  Assignment,
  EmployeeLocationPoint,
  EmployeePayRate,
  EmployeeProfile,
  EmployeeTrackingStatus,
  Project,
  ProjectBudget,
  ProjectLabourExpense,
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
  const { data, error } = await supabase
    .from("companycam_projects")
    .select(
      "companycam_id,name,formatted_address,city,state,postal_code,latitude,longitude,is_archived,companycam_updated_at",
    )
    .eq("is_archived", false)
    .eq("is_lead", false)
    .order("companycam_updated_at", { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) throw new Error(`projects: ${error.message}`);
  return (data ?? []) as Project[];
}

export async function getBudgets(): Promise<ProjectBudget[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_budgets")
    .select("companycam_project_id,budgeted_hours,amount_including_tax,hourly_rate,notes,updated_at");
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

export async function getAssignments(): Promise<Assignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_assignments")
    .select("id,companycam_project_id,user_id,status")
    .eq("status", "active");
  if (error) throw new Error(`assignments: ${error.message}`);
  return (data ?? []) as Assignment[];
}
