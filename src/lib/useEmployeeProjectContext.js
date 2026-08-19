import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { getEmployeeDisplayName, upsertEmployeeProfileForUser } from "./employeeRepository";
import { listActiveProjectAssignmentIds, listMappedProjects } from "./projectRepository";

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

    const { projects } = await listMappedProjects();
    setTrackingProjects(projects);
  }, [sessionUser?.id]);

  const refreshAssignments = useCallback(async () => {
    if (!sessionUser) {
      setAssignedProjectIds([]);
      return;
    }

    const { projectIds } = await listActiveProjectAssignmentIds(sessionUser.id);
    setAssignedProjectIds(projectIds);
  }, [sessionUser?.id]);

  const loadEmployeeContext = useCallback(async () => {
    if (!sessionUser) {
      setEmployeeProfile(null);
      setAssignedProjectIds([]);
      return;
    }

    const { profile } = await upsertEmployeeProfileForUser(sessionUser);
    if (profile) setEmployeeProfile(profile);
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
    () => getEmployeeDisplayName(employeeProfile, sessionUser),
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
