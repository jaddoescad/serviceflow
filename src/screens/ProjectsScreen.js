import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";

const COLORS = {
  green: "#173f37",
  teal: "#2f8d7f",
  brown: "#7c5127",
  white: "#ffffff",
  surface: "#f7f8f7",
  border: "#e0e3e1",
  muted: "#8b9692",
  ink: "#11201d",
};

const PROJECTS_PAGE_SIZE = 20;

function escapeSearchTerm(value) {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

export default function ProjectsScreen({ onSelectProject }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalProjects, setTotalProjects] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef(null);

  const loadProjects = useCallback(async ({ quiet = false, pageToLoad = 0, append = false } = {}) => {
    if (!quiet && !append) setLoading(true);
    if (append) setLoadingMore(true);
    setError("");

    const from = pageToLoad * PROJECTS_PAGE_SIZE;
    const to = from + PROJECTS_PAGE_SIZE - 1;
    const trimmedSearch = searchQuery.trim();
    const escapedSearch = escapeSearchTerm(trimmedSearch);

    let query = supabase
      .from("companycam_projects")
      .select("companycam_id,name,formatted_address,city,state,postal_code,is_archived,is_lead,last_synced_at,companycam_updated_at", { count: "exact" })
      .eq("is_archived", false)
      .order("companycam_updated_at", { ascending: false, nullsFirst: false });

    if (escapedSearch) {
      const pattern = `%${escapedSearch}%`;
      query = query.or(
        [
          `name.ilike.${pattern}`,
          `formatted_address.ilike.${pattern}`,
          `city.ilike.${pattern}`,
          `state.ilike.${pattern}`,
          `postal_code.ilike.${pattern}`,
        ].join(","),
      );
    } else {
      query = query.eq("is_lead", false);
    }

    const { data, error: queryError, count } = await query.range(from, to);

    if (queryError) {
      setError(queryError.message);
    } else {
      const nextProjects = data || [];

      setProjects((currentProjects) => {
        if (!append) return nextProjects;

        const seenIds = new Set(currentProjects.map((project) => project.companycam_id));
        const newProjects = nextProjects.filter((project) => !seenIds.has(project.companycam_id));
        return [...currentProjects, ...newProjects];
      });
      setPage(pageToLoad);
      setTotalProjects(count ?? null);
      setHasMore(count == null ? nextProjects.length === PROJECTS_PAGE_SIZE : to + 1 < count);
    }

    if (!quiet && !append) setLoading(false);
    if (append) setLoadingMore(false);
  }, [searchQuery]);

  const refreshProjects = useCallback(async () => {
    setRefreshing(true);
    await loadProjects({ quiet: true, pageToLoad: 0 });
    setRefreshing(false);
  }, [loadProjects]);

  const syncProjects = useCallback(async () => {
    setSyncing(true);
    setError("");
    setMessage("");

    const { data, error: syncError } = await supabase.functions.invoke("sync-companycam-projects", {
      body: {},
    });

    if (syncError) {
      setError(syncError.message || "CompanyCam sync failed.");
      setSyncing(false);
      return;
    }

    setMessage(`Synced ${data?.synced ?? 0} CompanyCam projects.`);
    await loadProjects({ quiet: true, pageToLoad: 0 });
    setSyncing(false);
  }, [loadProjects]);

  const loadMoreProjects = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
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
    const timeout = setTimeout(() => {
      setSearchQuery(searchText.trim());
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchText]);

  const ongoing = useMemo(() => projects.filter((p) => !p.is_archived), [projects]);
  const isSearching = searchQuery.length > 0;
  const featured = isSearching ? null : ongoing[0];
  const remaining = featured ? ongoing.slice(1) : ongoing;

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
            <Text style={styles.kicker}>Ottawa Painters</Text>
            <Text style={styles.headline}>Projects</Text>
          </View>
        </View>

        <Pressable style={styles.searchBar} onPress={() => searchInputRef.current?.focus()}>
          <Ionicons name="search-outline" size={25} color={COLORS.muted} />
          <TextInput
            ref={searchInputRef}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search projects"
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

        {!!message && <Text style={styles.messageText}>{message}</Text>}
        {!!error && <Text style={styles.errorText}>{error}</Text>}

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={COLORS.teal} />
            <Text style={styles.loadingText}>Loading projects…</Text>
          </View>
        ) : (
          <>
            {featured ? (
              <CurrentProjectCard project={featured} onPress={() => onSelectProject?.(featured)} />
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {isSearching ? "Search Results" : "Ongoing Projects"}
              </Text>
              <Text style={styles.sectionCount}>({totalProjects ?? ongoing.length})</Text>
            </View>

            {remaining.length === 0 && !featured ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {searchQuery ? "No matching projects" : "No synced projects yet"}
                </Text>
                <Text style={styles.emptyText}>
                  {searchQuery
                    ? "Try another name, address, city, or postal code."
                    : "Tap the sync button to pull projects from CompanyCam."}
                </Text>
              </View>
            ) : (
              <>
                {remaining.map((p) => (
                  <ProjectCard
                    key={p.companycam_id}
                    project={p}
                    onPress={() => onSelectProject?.(p)}
                  />
                ))}
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

      <Pressable
        onPress={syncProjects}
        disabled={syncing}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed, syncing && { opacity: 0.85 }]}
      >
        {syncing ? <ActivityIndicator color="#fff" /> : <Ionicons name="add" size={42} color="#fff" />}
      </Pressable>
    </View>
  );
}

function CurrentProjectCard({ project, onPress }) {
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
          <Text style={styles.statusLabel}>On site</Text>
        </View>
        <Text style={styles.currentName} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={styles.currentAddress} numberOfLines={1}>
          {address || "No address on file"}
        </Text>
      </View>
      <View style={styles.timerBlock}>
        <Text style={styles.timer}>00:00</Text>
        <Text style={styles.timerLabel}>Today</Text>
      </View>
    </Pressable>
  );
}

function ProjectCard({ project, onPress }) {
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
        <Text style={styles.cardDate}>{formatDate(project.last_synced_at)}</Text>
      </View>
    </Pressable>
  );
}

function formatAddress(project) {
  return (
    project.formatted_address ||
    [project.city, project.state, project.postal_code].filter(Boolean).join(", ")
  );
}

function formatDate(value) {
  if (!value) return "Not synced";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
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
    shadowColor: COLORS.green,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
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
  cardDate: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
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
  fab: {
    position: "absolute",
    right: 18,
    bottom: 18,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.green,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.green,
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fabPressed: {
    transform: [{ scale: 0.96 }],
  },
});
