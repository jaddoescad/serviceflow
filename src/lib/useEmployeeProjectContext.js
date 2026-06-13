import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { supabase } from "./supabase";

const TRACKING_PROJECT_SELECT =
  "companycam_id,name,street_address_1,street_address_2,city,state,postal_code,country,formatted_address,latitude,longitude,is_archived,is_lead,companycam_updated_at,last_synced_at";
const TRACKING_PROJECT_PAGE_SIZE = 1000;

function getPainterName(profile, user) {
  return (
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Painter"
  );
}

export function useEmployeeProjectContext(session) {
  const sessionUser = session?.user || null;
  const [trackingProjects, setTrackingProjects] = useState([]);
  const [employeeProfile, setEmployeeProfile] = useState(null);
  const [assignedProjectIds, setAssignedProjectIds] = useState([]);

  const loadTrackingProjects = useCallback(async () => {
    if (!sessionUser) {
      setTrackingProjects([]);
      return;
    }

    const allProjects = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("companycam_projects")
        .select(TRACKING_PROJECT_SELECT)
        .eq("is_archived", false)
        .eq("is_lead", false)
        .order("companycam_updated_at", { ascending: false, nullsFirst: false })
        .range(from, from + TRACKING_PROJECT_PAGE_SIZE - 1);

      if (error) return;

      const nextProjects = data || [];
      allProjects.push(...nextProjects);

      if (nextProjects.length < TRACKING_PROJECT_PAGE_SIZE) break;
      from += TRACKING_PROJECT_PAGE_SIZE;
    }

    setTrackingProjects(allProjects);
  }, [sessionUser?.id]);

  const refreshAssignments = useCallback(async () => {
    if (!sessionUser) {
      setAssignedProjectIds([]);
      return;
    }

    const { data: assignments } = await supabase
      .from("project_assignments")
      .select("companycam_project_id")
      .eq("user_id", sessionUser.id)
      .eq("status", "active");

    setAssignedProjectIds((assignments || []).map((assignment) => String(assignment.companycam_project_id)));
  }, [sessionUser?.id]);

  const loadEmployeeContext = useCallback(async () => {
    if (!sessionUser) {
      setEmployeeProfile(null);
      setAssignedProjectIds([]);
      return;
    }

    const fullName = getPainterName(null, sessionUser);

    const { data: profileData } = await supabase
      .from("employee_profiles")
      .upsert(
        {
          user_id: sessionUser.id,
          email: sessionUser.email,
          full_name: fullName,
        },
        { onConflict: "user_id" },
      )
      .select("user_id,email,full_name,role,is_active")
      .single();

    if (profileData) setEmployeeProfile(profileData);
    await refreshAssignments();
  }, [refreshAssignments, sessionUser?.id, sessionUser?.email, sessionUser?.user_metadata?.full_name, sessionUser?.user_metadata?.name]);

  useEffect(() => {
    loadTrackingProjects();
  }, [loadTrackingProjects]);

  useEffect(() => {
    loadEmployeeContext();
  }, [loadEmployeeContext]);

  useEffect(() => {
    if (!sessionUser?.id) return undefined;

    const interval = setInterval(refreshAssignments, 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshAssignments();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshAssignments, sessionUser?.id]);

  const refreshProjectData = useCallback(async () => {
    await Promise.all([loadTrackingProjects(), loadEmployeeContext()]);
  }, [loadEmployeeContext, loadTrackingProjects]);

  const painterName = useMemo(
    () => getPainterName(employeeProfile, sessionUser),
    [employeeProfile?.full_name, sessionUser?.email, sessionUser?.user_metadata?.full_name, sessionUser?.user_metadata?.name],
  );

  return {
    sessionUser,
    trackingProjects,
    employeeProfile,
    assignedProjectIds,
    painterName,
    refreshProjectData,
  };
}
