export type Role = "admin" | "manager" | "painter";

export type EmployeeProfile = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  is_active: boolean;
};

export type Segment = {
  mode?: "on_site" | "off_site";
  startedAt?: string;
  endedAt?: string | null;
  distanceMeters?: number | null;
};

export type TimeEntry = {
  id: string;
  client_entry_id: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  companycam_project_id: string | null;
  project_name: string;
  project_address: string | null;
  original_started_at: string | null;
  started_at: string;
  start_edited_at: string | null;
  ended_at: string | null;
  status: "active" | "complete";
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  last_distance_meters: number | null;
  is_on_site: boolean | null;
  segments: Segment[] | null;
  adjustment_history: unknown[] | null;
  notes: string | null;
  approved_at: string | null;
  approved_by: string | null;
  inserted_at: string;
  updated_at: string;
};

export type EmployeeTrackingStatus = {
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  time_entry_id: string | null;
  client_entry_id: string | null;
  companycam_project_id: string | null;
  project_name: string | null;
  project_address: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  last_location_at: string | null;
  last_sync_at: string | null;
  tracking_mode: "clocked_out" | "painting" | "stationary" | "travel" | "unavailable" | "unknown";
  task_status: "running" | "geofence" | "paused" | "stopped" | "error";
  metadata: {
    on_site?: boolean | null;
    distance_from_project_meters?: number | null;
    reason?: string | null;
  } | null;
  updated_at: string;
};

export type EmployeeLocationPoint = {
  id: string;
  client_event_id: string;
  user_id: string;
  time_entry_id: string | null;
  client_entry_id: string;
  companycam_project_id: string | null;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  speed_mps: number | null;
  heading_degrees: number | null;
  tracking_mode: "painting" | "stationary" | "travel" | "unknown";
  event_type: "location" | "clock_in" | "clock_out" | "arrival" | "departure" | "project_switch";
  distance_from_project_meters: number | null;
  is_on_site: boolean | null;
  captured_at: string;
  received_at: string;
};

export type Project = {
  companycam_id: string;
  name: string;
  formatted_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  is_archived: boolean;
  companycam_updated_at: string | null;
};

export type ProjectBudget = {
  companycam_project_id: string;
  budgeted_hours: number | null;
  amount_including_tax: number | null;
  hourly_rate: number | null;
  notes: string | null;
  updated_at: string;
};

export type ProjectLabourExpense = {
  id: string;
  companycam_project_id: string;
  worker_user_id: string | null;
  worker_name: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  amount_before_tax: number;
  tax_amount: number;
  notes: string | null;
  inserted_at: string;
  updated_at: string;
};

export type EmployeePayRate = {
  id: string;
  user_id: string;
  hourly_rate: number;
  effective_from: string;
  notes: string | null;
  inserted_at: string;
  updated_at: string;
};

export type Assignment = {
  id: string;
  companycam_project_id: string;
  user_id: string;
  status: "active" | "removed";
};

export type ProjectLabourTask = {
  id: string;
  companycam_project_id: string;
  title: string;
  notes: string | null;
  budgeted_hours: number | null;
  status: string;
  sort_order: number;
};

export type ProjectLabourTaskTimeEntry = {
  task_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
};
