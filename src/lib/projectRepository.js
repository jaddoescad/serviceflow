import { supabase } from "./supabase";

export const COMPANYCAM_PROJECT_SELECT =
  "companycam_id,name,street_address_1,street_address_2,city,state,postal_code,country,formatted_address,latitude,longitude,is_archived,is_lead,companycam_updated_at,last_synced_at";

const DEFAULT_PROJECT_PAGE_SIZE = 1000;

function activeProjectQuery(select = COMPANYCAM_PROJECT_SELECT) {
  return supabase
    .from("companycam_projects")
    .select(select)
    .eq("is_archived", false)
    .eq("is_lead", false);
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
    allProjects.push(...nextProjects);

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
  const safeQuery = String(query || "").trim().replace(/,/g, " ");
  if (!safeQuery) return { projects: [], error: null };

  const match = `%${safeQuery}%`;
  const { data, error } = await activeProjectQuery("*")
    .or(`name.ilike.${match},formatted_address.ilike.${match},city.ilike.${match},state.ilike.${match},postal_code.ilike.${match}`)
    .order("companycam_updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  return { projects: data || [], error };
}

export async function listActiveProjectAssignmentIds(userId) {
  if (!userId) return { projectIds: [], error: null };

  const { data, error } = await supabase
    .from("project_assignments")
    .select("companycam_project_id")
    .eq("user_id", userId)
    .eq("status", "active");

  return {
    projectIds: (data || []).map((assignment) => String(assignment.companycam_project_id)),
    error,
  };
}
