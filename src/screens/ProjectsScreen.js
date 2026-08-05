import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BudgetProgressBadge } from "../components/BudgetProgress";
import {
  getProjectId,
  listActiveCompanyCamProjectPage,
} from "../lib/projectRepository";
import { palette as COLORS } from "../theme";

const PROJECTS_PAGE_SIZE = 20;
const PROJECT_FEED_REFRESH_MS = 45_000;
const EMPTY_PROJECT_TOTALS = Object.freeze({});
const EMPTY_PROJECT_IDS = Object.freeze([]);
const PROJECT_ID_KEY_SEPARATOR = "\0";

export default function ProjectsScreen({
  enabled = true,
  onSelectProject,
  activeShift,
  projectTimeTotals = EMPTY_PROJECT_TOTALS,
  myProjectTimeTotals = EMPTY_PROJECT_TOTALS,
  projectLatestActivity = EMPTY_PROJECT_TOTALS,
  assignedProjectIds = EMPTY_PROJECT_IDS,
  canManageProjects = false,
}) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalProjects, setTotalProjects] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const searchInputRef = useRef(null);
  // Guards against out-of-order responses (stale) and against multiple page
  // fetches being kicked off within the same frame (synchronous flag).
  const requestIdRef = useRef(0);
  const isFetchingRef = useRef(false);
  const hasLoadedProjectsRef = useRef(false);
  const activeProjectId = getProjectId(activeShift?.project);
  const trackedProjectIdsKey = getProjectIdsKey(Object.keys(projectTimeTotals || {}));
  const trackedProjectIds = useMemo(
    () => projectIdsFromKey(trackedProjectIdsKey),
    [trackedProjectIdsKey],
  );
  const relevantAssignedIdsKey = getProjectIdsKey([
    ...(assignedProjectIds || []),
    ...trackedProjectIds,
    activeProjectId,
  ]);
  const relevantAssignedIds = useMemo(
    () => projectIdsFromKey(relevantAssignedIdsKey),
    [relevantAssignedIdsKey],
  );

  const loadProjects = useCallback(async ({ quiet = false, pageToLoad = 0, append = false } = {}) => {
    const requestId = ++requestIdRef.current;
    isFetchingRef.current = true;
    const shouldShowInitialLoader = !quiet && !append && !hasLoadedProjectsRef.current;
    if (shouldShowInitialLoader) setLoading(true);
    if (append) setLoadingMore(true);
    setError("");

    const trimmedSearch = searchQuery.trim();
    const assignedProjectIdsForQuery =
      !trimmedSearch && filter === "assigned" ? relevantAssignedIds : null;

    const result = await listActiveCompanyCamProjectPage({
      page: pageToLoad,
      pageSize: PROJECTS_PAGE_SIZE,
      search: trimmedSearch,
      projectIds: assignedProjectIdsForQuery,
    });
    let nextProjects = result.projects;
    const pageProjectCount = result.projects.length;
    let queryError = result.error;
    const count = result.count;

    if (
      !queryError &&
      pageToLoad === 0 &&
      !trimmedSearch &&
      filter === "active" &&
      trackedProjectIds.length
    ) {
      const activityResult = await listActiveCompanyCamProjectPage({
        page: 0,
        pageSize: Math.max(PROJECTS_PAGE_SIZE, trackedProjectIds.length),
        projectIds: trackedProjectIds,
      });
      queryError = activityResult.error;

      if (!queryError) {
        const seenIds = new Set(nextProjects.map(getProjectId));
        const additionalProjects = activityResult.projects.filter(
          (project) => !seenIds.has(getProjectId(project)),
        );
        nextProjects = [...nextProjects, ...additionalProjects];
      }
    }

    // A newer request superseded this one; ignore its (stale) results so we don't
    // clobber fresher data or flip loading flags the newer request owns.
    if (requestId !== requestIdRef.current) return;

    if (queryError) {
      setError(queryError.message);
    } else {
      setProjects((currentProjects) => {
        if (!append) return nextProjects;

        const seenIds = new Set(currentProjects.map((project) => project.companycam_id));
        const newProjects = nextProjects.filter((project) => !seenIds.has(project.companycam_id));
        return [...currentProjects, ...newProjects];
      });
      setPage(pageToLoad);
      setTotalProjects(count ?? null);
      const loadedThrough = pageToLoad * PROJECTS_PAGE_SIZE + pageProjectCount;
      setHasMore(count == null ? pageProjectCount === PROJECTS_PAGE_SIZE : loadedThrough < count);
    }

    hasLoadedProjectsRef.current = true;
    if (shouldShowInitialLoader) setLoading(false);
    if (append) setLoadingMore(false);
    isFetchingRef.current = false;
  }, [filter, relevantAssignedIds, searchQuery, trackedProjectIds]);

  const refreshProjects = useCallback(async () => {
    setRefreshing(true);
    await loadProjects({ quiet: true, pageToLoad: 0 });
    setRefreshing(false);
  }, [loadProjects]);

  const loadMoreProjects = useCallback(async () => {
    // isFetchingRef is synchronous, so overlapping scroll events in one frame
    // can't each start a page fetch (state updates lag a frame behind).
    if (loading || loadingMore || !hasMore || isFetchingRef.current) return;
    await loadProjects({ quiet: true, pageToLoad: page + 1, append: true });
  }, [hasMore, loadProjects, loading, loadingMore, page]);

  const handleProjectScroll = useCallback(({ nativeEvent }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);

    if (distanceFromBottom < 260) {
      loadMoreProjects();
    }
  }, [loadMoreProjects]);

  useEffect(() => {
    loadProjects({ pageToLoad: 0 });
  }, [loadProjects]);

  useEffect(() => {
    if (enabled && hasLoadedProjectsRef.current) {
      loadProjects({ quiet: true, pageToLoad: 0 });
    }
  }, [enabled, loadProjects]);

  useEffect(() => {
    if (!enabled) return undefined;
    const interval = setInterval(
      () => loadProjects({ quiet: true, pageToLoad: 0 }),
      PROJECT_FEED_REFRESH_MS,
    );
    return () => clearInterval(interval);
  }, [enabled, loadProjects]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchQuery(searchText.trim());
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchText]);

  const assignedProjectIdSet = useMemo(() => new Set(relevantAssignedIds), [relevantAssignedIds]);
  const isSearching = searchQuery.length > 0;
  const visibleProjects = useMemo(
    () => (isSearching ? projects : projects.filter((p) => !p.is_archived)),
    [isSearching, projects],
  );
  const filtered = useMemo(
    () => (filter === "assigned" && !isSearching ? visibleProjects.filter((project) => assignedProjectIdSet.has(getProjectId(project))) : visibleProjects),
    [assignedProjectIdSet, filter, isSearching, visibleProjects],
  );
  const sortedFiltered = useMemo(
    () => [...filtered].sort((left, right) => compareProjectActivity(left, right, projectLatestActivity)),
    [filtered, projectLatestActivity],
  );
  const activeProject = useMemo(() => {
    if (!activeProjectId || isSearching) return null;

    const loadedProject = visibleProjects.find((project) => getProjectId(project) === activeProjectId);
    return loadedProject || activeShift.project;
  }, [activeProjectId, activeShift?.project, isSearching, visibleProjects]);
  const featured = activeProject;
  const featuredStatusLabel = activeShift?.onSite === false ? "Off site" : "Clocked in";
  const remaining = featured
    ? sortedFiltered.filter((project) => getProjectId(project) !== getProjectId(featured))
    : sortedFiltered;
  const getBudgetProgress = (project) => project?.budgetProgress || null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={handleProjectScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshProjects} tintColor={COLORS.teal} />
        }
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.kicker}>ServiceFlow</Text>
            <Text style={styles.headline}>Jobs</Text>
          </View>
        </View>

        <Pressable style={styles.searchBar} onPress={() => searchInputRef.current?.focus()}>
          <Ionicons name="search-outline" size={25} color={COLORS.muted} />
          <TextInput
            ref={searchInputRef}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search jobs and leads"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searchText ? (
            <Pressable
              onPress={() => {
                setSearchText("");
                setSearchQuery("");
              }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color={COLORS.muted} />
            </Pressable>
          ) : null}
        </Pressable>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={COLORS.teal} />
            <Text style={styles.loadingText}>Loading projects…</Text>
          </View>
        ) : (
          <>
            {featured ? (
              <CurrentProjectCard
                project={featured}
                statusLabel={featuredStatusLabel}
                budgetProgress={getBudgetProgress(featured)}
                myHoursLabel={myProjectTimeTotals?.[getProjectId(featured)] || null}
                onPress={() => onSelectProject?.(featured)}
              />
            ) : null}

            {!isSearching ? <View style={styles.filterRow}>
              <Pressable
                onPress={() => setFilter("active")}
                style={[styles.filterChip, filter === "active" && styles.filterChipActive]}
              >
                <Text style={[styles.filterLabel, filter === "active" && styles.filterLabelActive]}>
                  Active
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFilter("assigned")}
                style={[styles.filterChip, filter === "assigned" && styles.filterChipActive]}
              >
                <Text style={[styles.filterLabel, filter === "assigned" && styles.filterLabelActive]}>
                  Assigned
                </Text>
              </Pressable>
            </View> : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {isSearching
                  ? "Search Results"
                  : filter === "assigned"
                    ? "Assigned Jobs"
                    : "Active Jobs"}
              </Text>
              <Text style={styles.sectionCount}>
                ({filter === "assigned" || isSearching ? filtered.length : (totalProjects ?? visibleProjects.length)})
              </Text>
            </View>

            {remaining.length === 0 && !featured ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {searchQuery
                    ? "No matching jobs"
                    : filter === "assigned"
                      ? "No assigned jobs"
                      : "No active jobs yet"}
                </Text>
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? "Try another name, email, phone, address, city, or postal code."
                    : filter === "assigned"
                      ? "Assignments can be created from the office/backend."
                      : canManageProjects
                        ? "Accepted DripJobs proposals will appear here automatically."
                        : "Ask a manager to assign you to an active job."}
                </Text>
              </View>
            ) : (
              <>
                {remaining.map((p) => {
                  return (
                    <ProjectCard
                      key={p.companycam_id}
                      project={p}
                      budgetProgress={getBudgetProgress(p)}
                      myHoursLabel={myProjectTimeTotals?.[getProjectId(p)] || null}
                      onPress={() => onSelectProject?.(p)}
                    />
                  );
                })}
                {hasMore ? (
                  <View style={styles.paginationFooter}>
                    {loadingMore ? <ActivityIndicator color={COLORS.green} /> : null}
                  </View>
                ) : null}
              </>
            )}
          </>
        )}

        <View style={{ height: 110 }} />
      </ScrollView>

    </View>
  );
}

function CurrentProjectCard({
  project,
  onPress,
  statusLabel,
  budgetProgress,
  myHoursLabel,
}) {
  const address = formatAddress(project);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.currentCard, pressed && styles.cardPressed]}
    >
      <MapThumb tone="dark" />
      <View style={styles.currentInfo}>
        <View style={styles.statusDotRow}>
          <View style={styles.liveDot} />
          <Text style={styles.statusLabel}>{statusLabel || "Clocked in"}</Text>
        </View>
        <Text style={styles.currentName} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={styles.currentAddress} numberOfLines={1}>
          {address || "No address on file"}
        </Text>
        <BudgetProgressBadge progress={budgetProgress} dark />
      </View>
      {myHoursLabel ? (
        <View style={styles.timerBlock}>
          <Text style={styles.timer}>{myHoursLabel}</Text>
          <Text style={styles.timerLabel}>Your hours</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ProjectCard({ project, onPress, budgetProgress, myHoursLabel }) {
  const address = formatAddress(project);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <MapThumb tone="light" />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={styles.cardAddress} numberOfLines={1}>
          {address || "No address on file"}
        </Text>
        {project.is_lead ? (
          <View style={styles.leadBadge}>
            <Text style={styles.leadBadgeText}>
              Lead · {formatLeadStatus(project.lead_stage)}
            </Text>
          </View>
        ) : (
          <BudgetProgressBadge progress={budgetProgress} />
        )}
      </View>
      {myHoursLabel ? (
        <View style={styles.hoursBlock}>
          <Text style={styles.hoursText}>{myHoursLabel}</Text>
          <Text style={styles.hoursLabel}>Your hours</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function formatLeadStatus(value) {
  return String(value || "new")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compareProjectActivity(left, right, projectLatestActivity) {
  const leftActivity = Number(projectLatestActivity?.[getProjectId(left)] || 0);
  const rightActivity = Number(projectLatestActivity?.[getProjectId(right)] || 0);

  if (leftActivity !== rightActivity) return rightActivity - leftActivity;

  const leftUpdated = getProjectUpdatedTimestamp(left);
  const rightUpdated = getProjectUpdatedTimestamp(right);
  if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;

  return String(left?.name || "").localeCompare(String(right?.name || ""));
}

function getProjectUpdatedTimestamp(project) {
  const value = new Date(project?.companycam_updated_at || project?.last_synced_at || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function getProjectIdsKey(projectIds) {
  return Array.from(new Set((projectIds || []).map((projectId) => String(projectId)).filter(Boolean)))
    .sort()
    .join(PROJECT_ID_KEY_SEPARATOR);
}

function projectIdsFromKey(key) {
  return key ? key.split(PROJECT_ID_KEY_SEPARATOR) : [];
}

function formatAddress(project) {
  return (
    project.formatted_address ||
    [project.city, project.state, project.postal_code].filter(Boolean).join(", ")
  );
}

function MapThumb({ tone = "light" }) {
  const dark = tone === "dark";
  const base = dark ? COLORS.green : COLORS.surface;
  const pin = dark ? "#ffffff" : COLORS.teal;
  const size = dark ? 64 : 52;
  return (
    <View style={[styles.mapThumb, { width: size, height: size, backgroundColor: base, borderColor: dark ? "transparent" : COLORS.border, borderWidth: dark ? 0 : 1 }]}>
      <Ionicons name="location" size={dark ? 35 : 30} color={pin} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scroll: {
    paddingTop: 6,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 16,
  },
  kicker: {
    color: COLORS.teal,
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  headline: {
    color: COLORS.ink,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  headerSyncButton: {
    height: 40,
    borderRadius: 999,
    backgroundColor: COLORS.green,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  headerSyncPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  headerSyncDisabled: {
    opacity: 0.78,
  },
  headerSyncText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "900",
  },
  searchBar: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    paddingHorizontal: 18,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  searchInput: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "600",
    height: "100%",
    paddingVertical: 0,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
    gap: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  filterChipActive: {
    borderColor: COLORS.ink,
  },
  filterLabel: {
    color: COLORS.muted,
    fontSize: 13.5,
    fontWeight: "700",
  },
  filterLabelActive: {
    color: COLORS.ink,
  },
  messageText: {
    marginHorizontal: 20,
    marginBottom: 10,
    color: COLORS.teal,
    fontSize: 13,
    fontWeight: "700",
  },
  errorText: {
    marginHorizontal: 20,
    marginBottom: 10,
    color: "#b42318",
    fontSize: 13,
    fontWeight: "700",
  },
  loadingState: {
    paddingVertical: 60,
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: "700",
  },
  currentCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.teal,
    borderRadius: 22,
    padding: 16,
    marginBottom: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    ...Platform.select({
      web: { boxShadow: "0 10px 18px rgba(23,63,55,0.18)" },
      default: {
        shadowColor: COLORS.green,
        shadowOpacity: 0.18,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 4,
      },
    }),
  },
  currentInfo: {
    flex: 1,
    minWidth: 0,
  },
  statusDotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#a9f1c4",
  },
  statusLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  currentName: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  currentAddress: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    marginTop: 2,
    fontWeight: "500",
  },
  timerBlock: {
    alignItems: "flex-end",
    justifyContent: "center",
    paddingLeft: 6,
  },
  timer: {
    color: COLORS.white,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  timerLabel: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 6,
  },
  sectionTitle: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  sectionCount: {
    color: COLORS.muted,
    fontSize: 15,
    fontWeight: "700",
  },
  card: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  cardAddress: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 3,
    fontWeight: "500",
  },
  leadBadge: {
    alignSelf: "flex-start",
    marginTop: 7,
    borderRadius: 999,
    backgroundColor: "#e6f4f7",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  leadBadgeText: {
    color: COLORS.teal,
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  hoursBlock: {
    alignItems: "flex-end",
    justifyContent: "center",
    paddingLeft: 6,
  },
  hoursText: {
    color: COLORS.green,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  hoursLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  cardPressed: {
    opacity: 0.7,
  },
  paginationFooter: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 10,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  mapThumb: {
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 22,
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 6,
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
