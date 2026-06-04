import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
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
  navy: "#31495d",
  white: "#ffffff",
  ink: "#11201d",
  muted: "#8b9692",
  border: "#e0e3e1",
  mapBg: "#e7efe2",
  mapBlock: "#f4eede",
  mapRoad: "#ffffff",
  mapRoadEdge: "#dde2d7",
};

export default function ClockInScreen({ onViewProject }) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [clockedInAt, setClockedInAt] = useState(
    () => new Date(Date.now() - (3 * 60 + 24) * 60 * 1000)
  );
  const [clockedIn, setClockedIn] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProject() {
      setLoading(true);
      setError("");
      const { data, error: queryError } = await supabase
        .from("companycam_projects")
        .select("*")
        .eq("is_archived", false)
        .eq("is_lead", false)
        .order("companycam_updated_at", { ascending: false, nullsFirst: false })
        .limit(1);

      if (cancelled) return;

      if (queryError) {
        setError(queryError.message);
      } else {
        setProject((data && data[0]) || null);
      }
      setLoading(false);
    }

    loadProject();
    return () => {
      cancelled = true;
    };
  }, []);

  const address = useMemo(() => {
    return formatAddress(project);
  }, [project]);

  const workedSinceClockIn = useMemo(() => {
    const totalMinutes = Math.max(0, Math.floor((now.getTime() - clockedInAt.getTime()) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}H ${String(minutes).padStart(2, "0")}M`;
  }, [clockedInAt, now]);

  const activeTimer = useMemo(() => {
    const totalSeconds = Math.max(0, Math.floor((now.getTime() - clockedInAt.getTime()) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return {
        main: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
        seconds: String(seconds).padStart(2, "0"),
      };
    }

    return {
      main: `00:${String(minutes).padStart(2, "0")}`,
      seconds: String(seconds).padStart(2, "0"),
    };
  }, [clockedInAt, now]);

  const startTimeLabel = useMemo(() => formatClockTime(clockedInAt), [clockedInAt]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchError("");
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setSearching(true);
      setSearchError("");

      const safeQuery = query.replace(/,/g, " ");
      const match = `%${safeQuery}%`;
      const { data, error: queryError } = await supabase
        .from("companycam_projects")
        .select("*")
        .eq("is_archived", false)
        .eq("is_lead", false)
        .or(
          `name.ilike.${match},formatted_address.ilike.${match},city.ilike.${match},state.ilike.${match},postal_code.ilike.${match}`
        )
        .order("companycam_updated_at", { ascending: false, nullsFirst: false })
        .limit(6);

      if (cancelled) return;

      if (queryError) {
        setSearchError(queryError.message);
        setSearchResults([]);
      } else {
        setSearchResults(data || []);
      }
      setSearching(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [searchQuery]);

  const selectProject = (nextProject) => {
    setProject(nextProject);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
  };

  const startClockIn = () => {
    setClockedInAt(new Date());
    setNow(new Date());
    setClockedIn(true);
  };

  if (clockedIn) {
    return (
      <ActiveClockInView
        project={project}
        address={address}
        workedSinceClockIn={workedSinceClockIn}
        activeTimer={activeTimer}
        startTimeLabel={startTimeLabel}
        onClockOut={() => setClockedIn(false)}
        onViewProject={project ? () => onViewProject?.(project) : null}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.painterName}>Jad Slim</Text>
        <View style={styles.timeRow}>
          <Text style={styles.timeBig}>{workedSinceClockIn}</Text>
          <Text style={styles.timeLabel}>Worked since clock in</Text>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={COLORS.muted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search projects"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searching ? (
            <ActivityIndicator size="small" color={COLORS.teal} />
          ) : searchQuery ? (
            <Pressable hitSlop={8} onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={20} color={COLORS.muted} />
            </Pressable>
          ) : null}
        </View>

        {searchQuery.trim() ? (
          <View style={styles.searchResults}>
            {searchResults.map((result) => (
              <Pressable
                key={result.companycam_id}
                style={styles.searchResultRow}
                onPress={() => selectProject(result)}
              >
                <View style={styles.searchResultIcon}>
                  <Ionicons name="location" size={15} color={COLORS.teal} />
                </View>
                <View style={styles.searchResultText}>
                  <Text style={styles.searchResultName} numberOfLines={1}>
                    {result.name}
                  </Text>
                  <Text style={styles.searchResultAddress} numberOfLines={1}>
                    {formatAddress(result) || "No address on file"}
                  </Text>
                </View>
              </Pressable>
            ))}
            {!searching && !searchResults.length ? (
              <Text style={styles.searchEmpty}>
                {searchError || "No matching projects found."}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.canvas}>
        <MapBackdrop />

        <View style={styles.projectCardWrap} pointerEvents="box-none">
          <View style={styles.projectCard}>
            <View style={styles.projectThumb}>
              <Ionicons name="map" size={22} color={COLORS.teal} />
            </View>
            <View style={styles.projectInfo}>
              {loading ? (
                <ActivityIndicator color={COLORS.teal} />
              ) : project ? (
                <>
                  <Text style={styles.projectName} numberOfLines={1}>
                    {project.name}
                  </Text>
                  <Text style={styles.projectAddress} numberOfLines={1}>
                    {address || "No address on file"}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.projectName} numberOfLines={1}>
                    No active project
                  </Text>
                  <Text style={styles.projectAddress} numberOfLines={1}>
                    {error || "Sync CompanyCam to load a job."}
                  </Text>
                </>
              )}
            </View>
            <View style={styles.cornerFold} />
          </View>
        </View>

        <View style={styles.geofenceWrap} pointerEvents="none">
          <View style={styles.geofence}>
            <View style={styles.geofenceInner} />
          </View>
          <View style={styles.pinShadow} />
          <View style={styles.pinBubble}>
            <Ionicons name="location" size={22} color={COLORS.white} />
          </View>
        </View>

        <View style={styles.mapControls} pointerEvents="box-none">
          <Pressable style={styles.mapButton} hitSlop={6}>
            <Ionicons name="navigate" size={18} color={COLORS.teal} />
          </Pressable>
          <Pressable style={styles.mapButton} hitSlop={6}>
            <Ionicons name="layers-outline" size={20} color={COLORS.teal} />
          </Pressable>
        </View>

        <View style={styles.clockInWrap} pointerEvents="box-none">
          <Pressable
            style={({ pressed }) => [styles.clockInPill, pressed && styles.clockInPressed]}
            onPress={startClockIn}
          >
            <View style={styles.playCircle}>
              <Ionicons name="play" size={16} color={COLORS.navy} />
            </View>
            <Text style={styles.clockInText}>Clock In</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function formatAddress(project) {
  if (!project) return "";
  return (
    project.formatted_address ||
    [project.city, project.state, project.postal_code].filter(Boolean).join(", ")
  );
}

function formatClockTime(date) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function ActiveClockInView({
  project,
  address,
  workedSinceClockIn,
  activeTimer,
  startTimeLabel,
  onClockOut,
  onViewProject,
}) {
  return (
    <View style={styles.activeScreen}>
      <View style={styles.activeTopBar}>
        <View style={styles.activeTopText}>
          <Text style={styles.painterName}>Jad Slim</Text>
          <View style={styles.timeRow}>
            <Text style={styles.timeBig}>{workedSinceClockIn}</Text>
            <Text style={styles.timeLabel}>Logged Today</Text>
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.activeScheduleTime}>On this job</Text>
            <Text style={styles.timeLabel}>Active shift</Text>
          </View>
        </View>
      </View>

      <View style={styles.activeProgressTrack}>
        <View style={styles.activeProgressFill} />
      </View>

      <View style={styles.activeContent}>
        <View style={styles.activeTimerCard}>
          <View style={styles.activeProjectRow}>
            <View style={styles.activeProjectTitleWrap}>
              <Ionicons name="location" size={25} color="#70c5d8" />
              <Text style={styles.activeProjectName} numberOfLines={1}>
                {project?.name || "Selected Project"}
              </Text>
            </View>
            <View style={styles.autoPill}>
              <Text style={styles.autoPillText}>Auto</Text>
            </View>
          </View>

          <Text style={styles.activeProjectAddress} numberOfLines={1}>
            {address || "No address on file"}
          </Text>

          <View style={styles.bigTimerRow}>
            <Text style={styles.bigTimerMain}>{activeTimer.main}</Text>
            <Text style={styles.bigTimerSeconds}>{activeTimer.seconds}</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.clockOutButton, pressed && styles.clockOutPressed]}
            onPress={onClockOut}
          >
            <Ionicons name="stop-circle-outline" size={20} color={COLORS.white} />
            <Text style={styles.clockOutText}>Clock Out</Text>
          </Pressable>
        </View>

        <View style={styles.activeRowCard}>
          <Text style={styles.activeRowLabel}>Edit Start Time</Text>
          <View style={styles.startTimePill}>
            <Text style={styles.startTimeText}>{startTimeLabel}</Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.viewProjectButton,
            !onViewProject && styles.viewProjectDisabled,
            pressed && onViewProject && styles.viewProjectPressed,
          ]}
          disabled={!onViewProject}
          onPress={onViewProject}
        >
          <Ionicons name="folder-open" size={20} color={COLORS.white} />
          <Text style={styles.viewProjectText}>View Project</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MapBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.mapBase} />

      <View style={[styles.block, { top: 60, left: 24, width: 110, height: 70 }]} />
      <View style={[styles.block, { top: 110, right: 26, width: 90, height: 130 }]} />
      <View style={[styles.block, { top: 280, right: 30, width: 120, height: 70 }]} />
      <View style={[styles.block, { bottom: 80, left: 22, width: 130, height: 90 }]} />
      <View style={[styles.block, { bottom: 30, right: 60, width: 100, height: 60 }]} />
      <View style={[styles.block, { top: 200, left: 18, width: 70, height: 50 }]} />

      <View style={[styles.roadV, { left: "38%" }]} />
      <View style={[styles.roadV, { left: "82%", width: 6 }]} />
      <View style={[styles.roadH, { top: "48%" }]} />
      <View style={[styles.roadH, { top: "72%", height: 6 }]} />
      <View style={[styles.roadDiagonal]} />

      <View style={[styles.roadVEdgeL, { left: "38%" }]} />
      <View style={[styles.roadVEdgeR, { left: "38%" }]} />
      <View style={[styles.roadHEdgeT, { top: "48%" }]} />
      <View style={[styles.roadHEdgeB, { top: "48%" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  activeScreen: {
    flex: 1,
    backgroundColor: "#f7f7f7",
  },
  activeTopBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: COLORS.white,
  },
  activeTopText: {
    flex: 1,
    gap: 6,
  },
  activeScheduleTime: {
    color: COLORS.ink,
    fontSize: 14.5,
    fontWeight: "900",
    letterSpacing: 0.1,
  },
  activeProgressTrack: {
    height: 6,
    backgroundColor: "#dfe3e4",
  },
  activeProgressFill: {
    width: "32%",
    height: "100%",
    backgroundColor: "#70c5d8",
  },
  activeContent: {
    flex: 1,
    paddingHorizontal: 8,
    paddingTop: 10,
    gap: 10,
  },
  activeTimerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
  },
  activeProjectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  activeProjectTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  activeProjectName: {
    flex: 1,
    minWidth: 0,
    color: "#70c5d8",
    fontSize: 17,
    fontWeight: "900",
  },
  activeProjectAddress: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 35,
    marginTop: 2,
  },
  autoPill: {
    backgroundColor: "#eef8fb",
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  autoPillText: {
    color: "#63b7cc",
    fontSize: 12,
    fontWeight: "900",
  },
  bigTimerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    marginTop: 32,
    marginBottom: 28,
  },
  bigTimerMain: {
    color: "#202124",
    fontSize: 50,
    fontWeight: "400",
    letterSpacing: -1,
  },
  bigTimerSeconds: {
    color: "#202124",
    fontSize: 29,
    fontWeight: "400",
    marginLeft: 7,
  },
  clockOutButton: {
    height: 50,
    borderRadius: 4,
    backgroundColor: "#f26666",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  clockOutPressed: {
    opacity: 0.88,
  },
  clockOutText: {
    color: COLORS.white,
    fontSize: 19,
    fontWeight: "800",
  },
  activeRowCard: {
    minHeight: 66,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  activeRowLabel: {
    color: "#70c5d8",
    fontSize: 17,
    fontWeight: "800",
  },
  startTimePill: {
    backgroundColor: "#eeeeef",
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  startTimeText: {
    color: "#050505",
    fontSize: 17,
    fontWeight: "500",
  },
  addTaskWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  viewProjectButton: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: COLORS.navy,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  viewProjectPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  viewProjectDisabled: {
    opacity: 0.5,
  },
  viewProjectText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: "900",
  },
  header: {
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: COLORS.white,
    zIndex: 5,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
  },
  painterName: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 6,
  },
  timeBig: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  timeLabel: {
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: "700",
  },
  searchBox: {
    height: 48,
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: "#f4f7f5",
    borderWidth: 1,
    borderColor: "#e3ebe7",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  searchResults: {
    marginTop: 10,
    borderRadius: 18,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  searchResultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eef1ef",
  },
  searchResultIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: "#e9f3ee",
    alignItems: "center",
    justifyContent: "center",
  },
  searchResultText: {
    flex: 1,
    minWidth: 0,
  },
  searchResultName: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  searchResultAddress: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "600",
    marginTop: 1,
  },
  searchEmpty: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  canvas: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  mapBase: {
    flex: 1,
    backgroundColor: COLORS.mapBg,
  },
  block: {
    position: "absolute",
    backgroundColor: COLORS.mapBlock,
    borderRadius: 4,
  },
  roadV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 18,
    backgroundColor: COLORS.mapRoad,
    marginLeft: -9,
  },
  roadH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: COLORS.mapRoad,
    marginTop: -9,
  },
  roadVEdgeL: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: COLORS.mapRoadEdge,
    marginLeft: -9,
  },
  roadVEdgeR: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: COLORS.mapRoadEdge,
    marginLeft: 8,
  },
  roadHEdgeT: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.mapRoadEdge,
    marginTop: -9,
  },
  roadHEdgeB: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.mapRoadEdge,
    marginTop: 8,
  },
  roadDiagonal: {
    position: "absolute",
    width: 600,
    height: 14,
    backgroundColor: COLORS.mapRoad,
    top: 100,
    left: -150,
    transform: [{ rotate: "60deg" }],
    opacity: 0.9,
  },
  projectCardWrap: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
  },
  projectCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    overflow: "hidden",
  },
  projectThumb: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#e9f3ee",
    alignItems: "center",
    justifyContent: "center",
  },
  projectInfo: {
    flex: 1,
    minWidth: 0,
  },
  projectName: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  projectAddress: {
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: "600",
    marginTop: 2,
  },
  cornerFold: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    borderStyle: "solid",
    borderTopWidth: 14,
    borderLeftWidth: 14,
    borderTopColor: "transparent",
    borderLeftColor: "#d8dcd1",
  },
  geofenceWrap: {
    position: "absolute",
    top: "38%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  geofence: {
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "rgba(47,141,127,0.18)",
    borderWidth: 2,
    borderColor: "rgba(47,141,127,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  geofenceInner: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(47,141,127,0.06)",
  },
  pinShadow: {
    position: "absolute",
    top: 125 - 4,
    width: 22,
    height: 6,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.18)",
    transform: [{ translateY: 26 }],
  },
  pinBubble: {
    position: "absolute",
    top: 125 - 22,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.teal,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: COLORS.white,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  mapControls: {
    position: "absolute",
    right: 14,
    bottom: 110,
    gap: 10,
  },
  mapButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  clockInWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 22,
    alignItems: "center",
  },
  clockInPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.navy,
    paddingLeft: 6,
    paddingRight: 26,
    paddingVertical: 6,
    borderRadius: 32,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  clockInPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  playCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
  },
  clockInText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
});
