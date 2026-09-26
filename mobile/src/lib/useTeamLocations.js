import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import {
  fetchEmployeeLocationRoute,
  fetchTeamTrackingStatuses,
} from "./locationTrackingRepository";

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startedAt: start.toISOString(), endedAt: end.toISOString() };
}

export function useTeamLocations(enabled = true) {
  const [statuses, setStatuses] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [routePoints, setRoutePoints] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [routeLoading, setRouteLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshStatuses = useCallback(async () => {
    if (!enabled) return;
    const result = await fetchTeamTrackingStatuses();
    if (result.error) {
      setError(result.error.message || "Team locations could not be loaded.");
    } else {
      setStatuses(result.statuses);
      setError("");
    }
    setLoading(false);
  }, [enabled]);

  const refreshRoute = useCallback(async () => {
    if (!enabled || !selectedUserId) {
      setRoutePoints([]);
      return;
    }
    setRouteLoading(true);
    const bounds = todayBounds();
    const result = await fetchEmployeeLocationRoute(
      selectedUserId,
      bounds.startedAt,
      bounds.endedAt,
    );
    if (result.error) {
      setError(result.error.message || "This route could not be loaded.");
    } else {
      setRoutePoints(result.points);
    }
    setRouteLoading(false);
  }, [enabled, selectedUserId]);

  useEffect(() => {
    if (!enabled) return undefined;
    refreshStatuses();
    const interval = setInterval(refreshStatuses, 30_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshStatuses();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [enabled, refreshStatuses]);

  useEffect(() => {
    refreshRoute();
  }, [refreshRoute]);

  useEffect(() => {
    if (!selectedUserId) return undefined;
    const interval = setInterval(refreshRoute, 30_000);
    return () => clearInterval(interval);
  }, [refreshRoute, selectedUserId]);

  const selectedStatus = useMemo(
    () => statuses.find((status) => status.user_id === selectedUserId) || null,
    [selectedUserId, statuses],
  );

  return {
    statuses,
    selectedStatus,
    selectedUserId,
    routePoints,
    loading,
    routeLoading,
    error,
    selectUser: setSelectedUserId,
    clearSelection: () => setSelectedUserId(null),
    refresh: async () => {
      await Promise.all([refreshStatuses(), selectedUserId ? refreshRoute() : Promise.resolve()]);
    },
  };
}
