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

export type Project = {
  companycam_id: string;
  name: string;
  started_on: string | null;
  completed_on: string | null;
  production_month: string | null;
  formatted_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  is_archived: boolean;
  is_lead: boolean;
  companycam_updated_at: string | null;
};

export type MarketingLeadJobLinkMethod =
  | "proposal_number"
  | "dripjobs_deal_id"
  | "dripjobs_contact_uuid"
  | "email_and_phone"
  | "email"
  | "phone"
  | "manual";

export type MarketingLeadJob = {
  jobId: string;
  proposalId: string;
  jobName: string;
  status: string;
  amount: number;
  proposalSignedOn: string | null;
  jobStartOn: string | null;
  jobCompletionOn: string | null;
  linkMethod: MarketingLeadJobLinkMethod;
  linkConfidence: number;
};

export type MarketingLeadMedia = {
  id: string;
  ownerProjectId: string;
  mediaType: "image" | "video";
};

export type MarketingLead = {
  leadId: string;
  dealId: string;
  operationalProjectId: string;
  createdOn: string;
  updatedAt: string;
  createdAtLocal: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  rawLeadSource: string | null;
  normalizedChannel:
    | "paid_social"
    | "organic_social"
    | "website"
    | "phone"
    | "mail"
    | "referral"
    | "organic_search"
    | "other"
    | "unknown";
  address: string | null;
  postalCode: string | null;
  estimateScheduledOn: string | null;
  estimateAppointmentOn: string | null;
  proposalNumber: string | null;
  proposalAmount: number | null;
  proposalOn: string | null;
  jobCrew: string | null;
  isInterior: boolean;
  isExterior: boolean;
  isCabinets: boolean;
  sourceRowNumber: number | null;
  job: MarketingLeadJob | null;
  media: MarketingLeadMedia[];
  mediaCount: number;
};

export type ProjectBudget = {
  companycam_project_id: string;
  budgeted_hours: number | null;
  amount_including_tax: number | null;
  hourly_rate: number | null;
  notes: string | null;
  // Set once every painter invoice for the job is in. Only closed jobs feed the
  // headline labour share; an open job's labour cost is still incomplete.
  labour_closed_at: string | null;
  // Invoices before this date belong to a previous job for the same customer.
  labour_invoice_job_started_on: string | null;
  // Settings recorded on the budget when it was created; null on budgets made
  // before labour settings existed.
  crew_hours_percent: number | null;
  cost_target_percent: number | null;
  updated_at: string;
};

export type ProjectLabourExpense = {
  id: string;
  invoice_id: string;
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
  completed_at: string | null;
  completed_by: string | null;
};
