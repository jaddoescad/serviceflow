import { supabase } from "./supabase";

// Compatibility aliases on normalized records keep old persisted time entries
// readable. New application behavior always uses the canonical jobs.id UUID.

const DEFAULT_PROJECT_PAGE_SIZE = 1000;
const SEARCH_FETCH_LIMIT = 1000;

export function escapeProjectSearchTerm(value) {
  return String(value || "").replace(/[%_]/g, (match) => `\\${match}`);
}

export function getProjectId(project) {
  return String(project?.id || project?.job_id || project?.companycam_id || "");
}

export function isQaProject(project) {
  return /qa web smoke|do not use/i.test(String(project?.name || ""));
}

function normalizeJob(row) {
  if (!row) return null;
  const id = String(row.id || row.job_id || "");
  const formattedAddress = row.formatted_address || [row.address_line_1, row.city, row.province, row.postal_code].filter(Boolean).join(", ");
  const budgetMinutes = row.budget_minutes == null ? null : Number(row.budget_minutes);
  const usedMinutes = row.used_minutes == null ? null : Number(row.used_minutes);
  const percentUsed = row.budget_percent_used == null ? null : Number(row.budget_percent_used);
  const rawStatus = String(row.budget_status || "not_configured");
  const budgetStatus = rawStatus === "over_budget" ? "over" : rawStatus === "complete" ? "at" : rawStatus === "active" ? "under" : rawStatus;

  return {
    ...row,
    id,
    job_id: id,
    companycam_id: id,
    companycam_project_id: id,
    street_address_1: row.address_line_1 || null,
    street_address_2: row.address_line_2 || null,
    state: row.province || null,
    formatted_address: formattedAddress || null,
    is_archived: row.status === "archived",
    is_deleted: row.status === "cancelled",
    is_lead: false,
    companycam_status: row.status,
    companycam_updated_at: row.updated_at,
    last_synced_at: row.updated_at,
    budgetProgress: {
      companycamProjectId: id,
      percentUsed: Number.isFinite(percentUsed) ? percentUsed : null,
      hoursUsed: Number.isFinite(usedMinutes) ? usedMinutes / 60 : null,
      budgetHours: Number.isFinite(budgetMinutes) ? budgetMinutes / 60 : null,
      status: budgetStatus,
      isComplete: row.status === "completed",
      calculatedAt: row.updated_at || null,
    },
  };
}

function normalizeLead(row) {
  if (!row) return null;
  const id = String(row.id || "");
  const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
  const formattedAddress =
    row.address ||
    [row.address_line_1, row.city, row.province, row.postal_code]
      .filter(Boolean)
      .join(", ");

  return {
    ...row,
    id,
    job_id: null,
    companycam_id: id,
    companycam_project_id: id,
    name: contact?.name || row.name || "Unnamed lead",
    contact_name: contact?.name || null,
    contact_email: contact?.email || null,
    contact_phone: contact?.phone || null,
    formatted_address: formattedAddress || null,
    street_address_1: row.address_line_1 || row.address || null,
    street_address_2: row.address_line_2 || null,
    state: row.province || null,
    is_archived: false,
    is_deleted: false,
    is_lead: true,
    companycam_status: row.status,
    companycam_updated_at: row.updated_at,
    last_synced_at: row.updated_at,
    lead_stage: row.pipeline_stage_raw || row.status || "new",
    budgetProgress: null,
  };
}

function visible(rows = []) {
  return rows.map(normalizeJob).filter((job) => job && !job.is_deleted && !job.is_archived && !isQaProject(job));
}

function activeJobQuery() {
  return supabase.from("job_feed").select("*").eq("is_feed_visible", true).in("status", ["scheduled", "active"]);
}

function visibleJobSearchQuery() {
  return supabase
    .from("job_feed")
    .select("*")
    .eq("is_feed_visible", true)
    .neq("status", "archived")
    .neq("status", "cancelled");
}

function getSearchMatch(query) {
  const normalized = String(query || "").trim().replace(/[,()]/g, " ");
  const safeQuery = escapeProjectSearchTerm(normalized);
  return safeQuery ? `%${safeQuery}%` : "";
}

async function searchVisibleJobsAndLeads(search, { page = 0, pageSize = 20 } = {}) {
  const match = getSearchMatch(search);
  if (!match) return { projects: [], count: 0, error: null };

  const compactPhone = String(search || "").replace(/\D/g, "");
  const contactFilters = [`name.ilike.${match}`, `email.ilike.${match}`];
  if (compactPhone.length >= 3) contactFilters.push(`phone.ilike.%${compactPhone}%`);

  const { data: matchingContacts, error: contactError } = await supabase
    .from("contacts")
    .select("id")
    .or(contactFilters.join(","))
    .limit(SEARCH_FETCH_LIMIT);
  if (contactError) return { projects: [], count: 0, error: contactError };

  const contactIds = (matchingContacts || []).map((contact) => String(contact.id)).filter(Boolean);
  const leadFilters = [
    `address.ilike.${match}`,
    `city.ilike.${match}`,
    `province.ilike.${match}`,
    `postal_code.ilike.${match}`,
    `source.ilike.${match}`,
    `pipeline_stage_raw.ilike.${match}`,
  ];
  if (contactIds.length) leadFilters.push(`contact_id.in.(${contactIds.join(",")})`);

  const leadResult = await supabase
    .from("leads")
    .select("*,contact:contacts(id,name,email,phone),jobs(id)")
    .or(leadFilters.join(","))
    .order("updated_at", { ascending: false })
    .limit(SEARCH_FETCH_LIMIT);
  if (leadResult.error) return { projects: [], count: 0, error: leadResult.error };

  const linkedJobIds = (leadResult.data || [])
    .flatMap((lead) => (lead.jobs || []).map((job) => String(job.id)))
    .filter(Boolean);
  const jobFilters = [
    `name.ilike.${match}`,
    `formatted_address.ilike.${match}`,
    `city.ilike.${match}`,
    `province.ilike.${match}`,
    `postal_code.ilike.${match}`,
  ];
  if (linkedJobIds.length) jobFilters.push(`id.in.(${linkedJobIds.join(",")})`);

  const jobResult = await visibleJobSearchQuery()
    .or(jobFilters.join(","))
    .order("updated_at", { ascending: false })
    .limit(SEARCH_FETCH_LIMIT);
  if (jobResult.error) return { projects: [], count: 0, error: jobResult.error };

  // Once a lead has operational jobs, the jobs are the useful search results.
  // Keeping the converted lead too would show the same customer twice.
  const unconvertedLeads = (leadResult.data || [])
    .filter((lead) => !Array.isArray(lead.jobs) || lead.jobs.length === 0)
    .map(normalizeLead)
    .filter((lead) => lead && !isQaProject(lead));
  const results = [...visible(jobResult.data || []), ...unconvertedLeads].sort((left, right) => {
    const leftUpdated = new Date(left.updated_at || left.created_at || 0).getTime() || 0;
    const rightUpdated = new Date(right.updated_at || right.created_at || 0).getTime() || 0;
    return rightUpdated - leftUpdated;
  });
  const from = page * pageSize;

  return {
    projects: results.slice(from, from + pageSize),
    count: results.length,
    error: null,
  };
}

export async function listActiveProjects({ pageSize = DEFAULT_PROJECT_PAGE_SIZE } = {}) {
  const projects = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await activeJobQuery().order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
    if (error) return { projects, error };
    projects.push(...visible(data || []));
    if ((data || []).length < pageSize) break;
  }
  return { projects, error: null };
}

export async function listMappedProjects(options = {}) {
  const result = await listActiveProjects(options);
  return { ...result, projects: result.projects.filter((job) => job.latitude != null && job.longitude != null) };
}

export async function getLatestActiveProject() {
  const { data, error } = await activeJobQuery().order("updated_at", { ascending: false }).limit(1);
  return { project: normalizeJob((data || [])[0]), error };
}

export async function searchJobsForClockIn(query, { limit = 50 } = {}) {
  return searchVisibleJobsAndLeads(query, { page: 0, pageSize: limit });
}

export async function ensureClockInProject(project) {
  if (!project?.is_lead) return { project, error: null, createdFromLead: false };

  const leadId = getProjectId(project);
  if (!leadId) {
    return {
      project: null,
      error: new Error("This lead is missing its project id."),
      createdFromLead: false,
    };
  }

  const { data, error } = await supabase.rpc("ensure_lead_clock_in_job", {
    requested_lead_id: leadId,
  });
  if (error) return { project: null, error, createdFromLead: false };

  const job = normalizeJob(Array.isArray(data) ? data[0] : data);
  if (!job) {
    return {
      project: null,
      error: new Error("The lead could not be prepared for clock in."),
      createdFromLead: false,
    };
  }

  return { project: job, error: null, createdFromLead: true };
}

export async function listActiveProjectPage({ page = 0, pageSize = 20, search = "", projectIds = null } = {}) {
  if (String(search || "").trim()) {
    return searchVisibleJobsAndLeads(search, { page, pageSize });
  }

  let query = activeJobQuery();
  const ids = Array.isArray(projectIds) ? projectIds.map(String).filter(Boolean) : null;
  if (ids && !ids.length) return { projects: [], count: 0, error: null };
  if (ids) query = query.in("id", ids);
  const from = page * pageSize;
  const { data, error, count } = await query.order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
  return { projects: error ? [] : visible(data || []), count: count ?? null, error };
}

export async function listActiveProjectAssignmentIds(userId) {
  if (!userId) return { projectIds: [], error: null };
  const { data, error } = await supabase
    .from("job_assignments")
    .select("job_id")
    .eq("employee_id", userId)
    .eq("status", "active");
  return { projectIds: (data || []).map((row) => String(row.job_id)), error };
}
