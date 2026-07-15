import { supabase } from "./supabase";

export const COMPANYCAM_PROJECT_SELECT =
  "companycam_id,name,street_address_1,street_address_2,city,state,postal_code,country,formatted_address,latitude,longitude,is_archived,is_deleted,companycam_status,is_lead,companycam_updated_at,last_synced_at";

const DEFAULT_PROJECT_PAGE_SIZE = 1000;
const QA_PROJECT_IDS = new Set(["qa-web-smoke-project"]);

export function escapeProjectSearchTerm(value) {
  return String(value || "").replace(/[%_]/g, (match) => `\\${match}`);
}

export function getProjectId(project) {
  return String(project?.companycam_id || project?.companycam_project_id || project?.id || "");
}

export function isQaProject(project) {
  const projectId = getProjectId(project);
  if (QA_PROJECT_IDS.has(projectId)) return true;
  return /qa web smoke|do not use/i.test(String(project?.name || ""));
}

function filterVisibleProjects(projects = []) {
  return projects.filter((project) => !project?.is_deleted && !isQaProject(project));
}

function activeProjectQuery(select = COMPANYCAM_PROJECT_SELECT) {
  return supabase
    .from("companycam_projects")
    .select(select)
    .eq("is_deleted", false)
    .eq("is_archived", false)
    .eq("is_lead", false)
    .neq("companycam_id", "qa-web-smoke-project");
}

export async function listActiveCompanyCamProjects({ pageSize = DEFAULT_PROJECT_PAGE_SIZE } = {}) {
  const allProjects = [];
  let from = 0;

  while (true) {
    const { data, error } = await activeProjectQuery(COMPANYCAM_PROJECT_SELECT)
      .order("companycam_updated_at", { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (error) return { projects: allProjects, error };

    const nextProjects = data || [];
    allProjects.push(...filterVisibleProjects(nextProjects));

    if (nextProjects.length < pageSize) break;
    from += pageSize;
  }

  return { projects: allProjects, error: null };
}

export async function listMappedCompanyCamProjects({ pageSize = DEFAULT_PROJECT_PAGE_SIZE } = {}) {
  const allProjects = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("companycam_projects")
      .select(COMPANYCAM_PROJECT_SELECT)
      .eq("is_deleted", false)
      .eq("is_archived", false)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .neq("companycam_id", "qa-web-smoke-project")
      .order("companycam_updated_at", { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (error) return { projects: allProjects, error };

    const nextProjects = data || [];
    allProjects.push(...filterVisibleProjects(nextProjects));

    if (nextProjects.length < pageSize) break;
    from += pageSize;
  }

  return { projects: allProjects, error: null };
}

export async function getLatestActiveCompanyCamProject() {
  const { data, error } = await activeProjectQuery("*")
    .order("companycam_updated_at", { ascending: false, nullsFirst: false })
    .limit(1);

  return { project: (data && data[0]) || null, error };
}

export async function searchActiveCompanyCamProjects(query, { limit = 6 } = {}) {
  const safeQuery = escapeProjectSearchTerm(String(query || "").trim().replace(/,/g, " "));
  if (!safeQuery) return { projects: [], error: null };

  const match = `%${safeQuery}%`;
  const { data, error } = await supabase
    .from("companycam_projects")
    .select("*")
    .eq("is_deleted", false)
    .neq("companycam_id", "qa-web-smoke-project")
    .or(`name.ilike.${match},formatted_address.ilike.${match},city.ilike.${match},state.ilike.${match},postal_code.ilike.${match}`)
    .order("companycam_updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  return { projects: filterVisibleProjects(data || []), error };
}

export async function listActiveCompanyCamProjectPage({
  page = 0,
  pageSize = 20,
  search = "",
  projectIds = null,
} = {}) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const safeSearch = escapeProjectSearchTerm(String(search || "").trim());

  let query = supabase
    .from("companycam_projects")
    .select("companycam_id,name,formatted_address,city,state,postal_code,is_archived,is_deleted,companycam_status,is_lead,last_synced_at,companycam_updated_at", {
      count: "exact",
    })
    .eq("is_deleted", false)
    .order("companycam_updated_at", { ascending: false, nullsFirst: false });

  if (safeSearch) {
    const pattern = `%${safeSearch}%`;
    query = query.or(
      [
        `name.ilike.${pattern}`,
        `formatted_address.ilike.${pattern}`,
        `city.ilike.${pattern}`,
        `state.ilike.${pattern}`,
        `postal_code.ilike.${pattern}`,
      ].join(","),
    );
  } else if (Array.isArray(projectIds)) {
    const normalizedProjectIds = projectIds
      .map((projectId) => String(projectId))
      .filter((projectId) => projectId && !QA_PROJECT_IDS.has(projectId));
    if (!normalizedProjectIds.length) {
      return { projects: [], count: 0, error: null };
    }

    query = query
      .in("companycam_id", normalizedProjectIds)
      .eq("is_archived", false)
      .eq("is_lead", false);
  } else {
    query = query
      .eq("is_archived", false)
      .eq("is_lead", false);
  }

  const { data, error, count } = await query.range(from, to);
  return { projects: filterVisibleProjects(data || []), count: count ?? null, error };
}

export async function syncCompanyCamProjects({ geocodeLimit = 12 } = {}) {
  const { data, error } = await supabase.functions.invoke("sync-companycam-projects", {
    body: {},
  });

  if (error) {
    return { synced: 0, geocoded: 0, error, geocodeError: null };
  }

  const { data: geocodeData, error: geocodeError } = await supabase.functions.invoke("geocode-companycam-projects", {
    body: { limit: geocodeLimit },
  });

  return {
    synced: data?.synced ?? 0,
    geocoded: geocodeData?.geocoded ?? 0,
    error: null,
    geocodeError,
  };
}

export async function listActiveProjectAssignmentIds(userId) {
  if (!userId) return { projectIds: [], error: null };

  const { data, error } = await supabase
    .from("project_assignments")
    .select("companycam_project_id")
    .eq("user_id", userId)
    .eq("status", "active");

  return {
    projectIds: (data || [])
      .map((assignment) => String(assignment.companycam_project_id))
      .filter((projectId) => !QA_PROJECT_IDS.has(projectId)),
    error,
  };
}
