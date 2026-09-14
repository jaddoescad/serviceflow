import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getProjectId } from "./projectRepository";
import { supabase } from "./supabase";

const MAX_PROJECTS_PER_REQUEST = 100;
const DEFAULT_REFRESH_INTERVAL_MS = 45_000;
const PROJECT_ID_SEPARATOR = "\0";
const budgetProgressCache = new Map();

// The in-memory cache dies on every app launch, which made budget panels pop
// in late on the first screen after a restart. Persist last-known values so
// panels render immediately and refresh silently.
const CACHE_STORAGE_KEY = "ottawaPainters.budgetProgressCache.v1";
let cacheHydration = null;

function ensureBudgetCacheHydrated() {
  if (!cacheHydration) {
    cacheHydration = (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [projectId, progress] of Object.entries(parsed)) {
            if (progress && !budgetProgressCache.has(projectId)) {
              budgetProgressCache.set(projectId, progress);
            }
          }
        }
      } catch (_error) {
        // Cache warming is best effort; the network refresh still runs.
      }
    })();
  }
  return cacheHydration;
}

function persistBudgetCache() {
  try {
    AsyncStorage.setItem(
      CACHE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(budgetProgressCache)),
    ).catch(() => {});
  } catch (_error) {
    // Persistence is best effort.
  }
}

export async function listProjectBudgetProgress(projectIds) {
  const ids = normalizeProjectIds(projectIds);
  if (!ids.length) return { progressByProjectId: {}, error: null };

  const chunks = [];
  for (let index = 0; index < ids.length; index += MAX_PROJECTS_PER_REQUEST) {
    chunks.push(ids.slice(index, index + MAX_PROJECTS_PER_REQUEST));
  }

  const results = await Promise.all(
    chunks.map((requestedProjectIds) =>
      supabase
        .from("job_feed")
        .select("id,status,budget_minutes,used_minutes,budget_percent_used,budget_status,updated_at")
        .in("id", requestedProjectIds),
    ),
  );

  const failed = results.find((result) => result.error);
  if (failed) return { progressByProjectId: {}, error: failed.error };

  const progressByProjectId = {};
  for (const result of results) {
    for (const row of result.data || []) {
      const normalized = normalizeBudgetProgress(row);
      if (normalized.companycamProjectId) {
        progressByProjectId[normalized.companycamProjectId] = normalized;
      }
    }
  }

  return { progressByProjectId, error: null };
}

export function useProjectBudgetProgress(
  projects,
  { enabled = true, refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS } = {},
) {
  const projectIdsKey = useMemo(
    () => normalizeProjectIds((projects || []).map(getProjectId)).join(PROJECT_ID_SEPARATOR),
    [projects],
  );
  const [progressByProjectId, setProgressByProjectId] = useState(() =>
    getSeededBudgetProgress(projects, projectIdsKey),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const projectIds = projectIdsKey ? projectIdsKey.split(PROJECT_ID_SEPARATOR) : [];
    const requestId = ++requestIdRef.current;

    await ensureBudgetCacheHydrated();
    if (requestId !== requestIdRef.current) return;
    const seededProgress = getSeededBudgetProgress(projects, projectIdsKey);
    if (Object.keys(seededProgress).length) {
      setProgressByProjectId((current) => ({ ...current, ...seededProgress }));
    }

    if (!projectIds.length) {
      setProgressByProjectId({});
      setError(null);
      setLoading(false);
      return;
    }

    // Screens stay mounted behind tabs. Disabling a screen pauses network
    // refreshes but deliberately keeps its last successful summary visible.
    if (!enabled) {
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await listProjectBudgetProgress(projectIds);
    if (requestId !== requestIdRef.current) return;

    if (result.error) {
      // Stale data is safer and less confusing than making a successful
      // summary disappear during a transient refresh failure.
      setError(result.error);
    } else {
      setProgressByProjectId(result.progressByProjectId);
      for (const [projectId, progress] of Object.entries(result.progressByProjectId)) {
        budgetProgressCache.set(projectId, progress);
      }
      persistBudgetCache();
      setError(null);
    }
    setLoading(false);
  }, [enabled, projectIdsKey, projects]);

  useEffect(() => {
    refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !projectIdsKey || refreshIntervalMs <= 0) return undefined;
    const interval = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, projectIdsKey, refresh, refreshIntervalMs]);

  useEffect(() => {
    if (!enabled || !projectIdsKey) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [enabled, projectIdsKey, refresh]);

  return { progressByProjectId, loading, error, refresh };
}

export function getBudgetProgressPresentation(progress) {
  if (!progress) {
    return {
      status: "loading",
      label: "Loading budget…",
      shortLabel: "Loading…",
      percentLabel: "—",
      fillPercent: 0,
      color: "#8b9692",
      backgroundColor: "#eef1ef",
    };
  }

  if (progress.status === "not_configured") {
    return {
      status: progress.status,
      label: "Budget pending",
      shortLabel: "Pending",
      percentLabel: "—",
      fillPercent: 0,
      color: "#6f7774",
      backgroundColor: "#eef1ef",
    };
  }

  if (progress.status === "incomplete") {
    return {
      status: progress.status,
      label: "Budget data incomplete",
      shortLabel: "Incomplete",
      percentLabel: "—",
      fillPercent: 0,
      color: "#9a611f",
      backgroundColor: "#fff3df",
    };
  }

  if (progress.status === "unavailable") {
    return {
      status: progress.status,
      label: "Budget unavailable",
      shortLabel: "Unavailable",
      percentLabel: "—",
      fillPercent: 0,
      color: "#6f7774",
      backgroundColor: "#eef1ef",
    };
  }

  const percent = Number.isFinite(progress.percentUsed) ? Math.max(0, progress.percentUsed) : 0;
  const roundedPercent = progress.status === "over"
    ? Math.max(101, Math.round(percent))
    : Math.min(99, Math.round(percent));
  const percentLabel = `${roundedPercent}%`;

  if (progress.status === "over") {
    const overPercent = roundedPercent - 100;
    return {
      status: progress.status,
      label: `${percentLabel} used · ${overPercent}% over`,
      shortLabel: `${percentLabel} · Over`,
      percentLabel,
      fillPercent: 100,
      color: "#c0432b",
      backgroundColor: "#fdecea",
    };
  }

  if (progress.status === "at") {
    return {
      status: progress.status,
      label: "100% used · At budget",
      shortLabel: "100% · At budget",
      percentLabel: "100%",
      fillPercent: 100,
      color: "#9a611f",
      backgroundColor: "#fff3df",
    };
  }

  return {
    status: "under",
    label: `${percentLabel} used · Under budget`,
    shortLabel: `${percentLabel} · Under`,
    percentLabel,
    fillPercent: Math.min(100, percent),
    color: "#2f8d7f",
    backgroundColor: "#e6f2f4",
  };
}

function normalizeProjectIds(projectIds) {
  return Array.from(
    new Set((projectIds || []).map((projectId) => String(projectId || "").trim()).filter(Boolean)),
  ).sort();
}

function getSeededBudgetProgress(projects, projectIdsKey) {
  const seeded = {};
  const projectById = new Map((projects || []).map((project) => [getProjectId(project), project]));

  for (const projectId of projectIdsKey ? projectIdsKey.split(PROJECT_ID_SEPARATOR) : []) {
    const embedded = projectById.get(projectId)?.budgetProgress;
    const progress = embedded || budgetProgressCache.get(projectId);
    if (!progress) continue;

    seeded[projectId] = progress;
    budgetProgressCache.set(projectId, progress);
  }

  return seeded;
}

function normalizeBudgetProgress(row) {
  const percentUsed = row?.budget_percent_used == null ? null : Number(row.budget_percent_used);
  const hoursUsed = row?.used_minutes == null ? null : Number(row.used_minutes) / 60;
  const rawStatus = String(row?.budget_status || "not_configured");
  const status = rawStatus === "over_budget"
    ? "over"
    : rawStatus === "complete"
      ? "at"
      : rawStatus === "active"
        ? "under"
        : rawStatus;
  return {
    companycamProjectId: String(row?.id || ""),
    percentUsed: Number.isFinite(percentUsed) ? percentUsed : null,
    hoursUsed: Number.isFinite(hoursUsed) ? hoursUsed : null,
    status,
    isComplete: row?.status === "completed",
    calculatedAt: row?.updated_at || null,
  };
}
