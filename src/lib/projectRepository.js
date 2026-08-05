import { supabase } from "./supabase";

// Compatibility shape for screens that still call these records "projects".
// The identifier is always the canonical jobs.id UUID; CompanyCam IDs are only metadata.
export const COMPANYCAM_PROJECT_SELECT = "*";

const DEFAULT_PROJECT_PAGE_SIZE = 1000;

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

function visible(rows = []) {
  return rows.map(normalizeJob).filter((job) => job && !job.is_deleted && !job.is_archived && !isQaProject(job));
}

function activeJobQuery() {
  return supabase.from("job_feed").select("*").eq("is_feed_visible", true).in("status", ["scheduled", "active"]);
}

export async function listActiveCompanyCamProjects({ pageSize = DEFAULT_PROJECT_PAGE_SIZE } = {}) {
  const projects = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await activeJobQuery().order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
    if (error) return { projects, error };
    projects.push(...visible(data || []));
    if ((data || []).length < pageSize) break;
  }
  return { projects, error: null };
}

export async function listMappedCompanyCamProjects(options = {}) {
  const result = await listActiveCompanyCamProjects(options);
  return { ...result, projects: result.projects.filter((job) => job.latitude != null && job.longitude != null) };
}

export async function getLatestActiveCompanyCamProject() {
  const { data, error } = await activeJobQuery().order("updated_at", { ascending: false }).limit(1);
  return { project: normalizeJob((data || [])[0]), error };
}

export async function searchActiveCompanyCamProjects(query, { limit = 6 } = {}) {
  const safeQuery = escapeProjectSearchTerm(String(query || "").trim().replace(/,/g, " "));
  if (!safeQuery) return { projects: [], error: null };
  const match = `%${safeQuery}%`;
  const { data, error } = await activeJobQuery()
    .or(`name.ilike.${match},formatted_address.ilike.${match},city.ilike.${match},province.ilike.${match},postal_code.ilike.${match}`)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return { projects: visible(data || []), error };
}

export async function listActiveCompanyCamProjectPage({ page = 0, pageSize = 20, search = "", projectIds = null } = {}) {
  let query = activeJobQuery();
  const ids = Array.isArray(projectIds) ? projectIds.map(String).filter(Boolean) : null;
  if (ids && !ids.length) return { projects: [], count: 0, error: null };
  if (ids) query = query.in("id", ids);
  const safeSearch = escapeProjectSearchTerm(String(search || "").trim().replace(/,/g, " "));
  if (safeSearch) {
    const match = `%${safeSearch}%`;
    query = query.or(`name.ilike.${match},formatted_address.ilike.${match},city.ilike.${match},province.ilike.${match},postal_code.ilike.${match}`);
  }
  const from = page * pageSize;
  const { data, error, count } = await query.order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
  return { projects: error ? [] : visible(data || []), count: count ?? null, error };
}

// CompanyCam no longer creates jobs. Existing CompanyCam IDs remain on jobs for photos only.
export async function syncCompanyCamProjects() {
  return { synced: 0, geocoded: 0, disabled: true, error: null, geocodeError: null };
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
