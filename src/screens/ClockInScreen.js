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
import * as Location from "expo-location";
import { getLatestActiveCompanyCamProject, searchActiveCompanyCamProjects } from "../lib/projectRepository";
import { formatDistance } from "../lib/timeTracking";
import ClockInMap, {
  findNearestProject,
  formatProjectAddress as formatAddress,
  toCoordinate,
} from "./clock-in/ClockInMap";

const COLORS = {
  green: "#173f37",
  teal: "#2f8d7f",
  navy: "#31495d",
  white: "#ffffff",
  ink: "#11201d",
  muted: "#8b9692",
  border: "#e0e3e1",
};

export default function ClockInScreen({
  painterName = "Painter",
  onViewProject,
  activeShift,
  activeElapsedMs = 0,
  locationStatus,
  trackingNotice,
  suggestedProject,
  projects = [],
  onClockIn,
  onClockOut,
  onSwitchProject,
  onUpdateTimeEntry,
}) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [foregroundPoint, setForegroundPoint] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProject() {
      setLoading(true);
      setError("");
      const { project: latestProject, error: queryError } = await getLatestActiveCompanyCamProject();

      if (cancelled) return;

      if (queryError) {
        setError(queryError.message);
      } else {
        setProject(latestProject);
      }
      setLoading(false);
    }

    loadProject();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshForegroundLocation = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return null;

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const point = toCoordinate(position);
      if (point) setForegroundPoint(point);
      return point;
    } catch (_error) {
      return null;
    }
  };

  useEffect(() => {
    refreshForegroundLocation();
  }, []);

  const currentPoint = locationStatus?.point || foregroundPoint;
  const nearestProject = useMemo(
    () => findNearestProject(projects, currentPoint),
    [currentPoint?.latitude, currentPoint?.longitude, projects],
  );
  const displayProject = activeShift?.project || nearestProject?.project || project;
  const displayClockedInAt = activeShift?.startedAt ? new Date(activeShift.startedAt) : null;
  const isClockedIn = !!activeShift;

  const address = useMemo(() => {
    return formatAddress(displayProject);
  }, [displayProject]);

  const workedSinceClockIn = useMemo(() => {
    const elapsedMs = activeShift ? activeElapsedMs : 0;
    const totalMinutes = Math.max(0, Math.floor(elapsedMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}H ${String(minutes).padStart(2, "0")}M`;
  }, [activeElapsedMs, activeShift]);

  const activeTimer = useMemo(() => {
    const elapsedMs = activeShift ? activeElapsedMs : 0;
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
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
  }, [activeElapsedMs, activeShift]);

  const startTimeLabel = useMemo(
    () => (displayClockedInAt ? formatClockTime(displayClockedInAt) : "--"),
    [displayClockedInAt],
  );

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

      const { projects: matches, error: queryError } = await searchActiveCompanyCamProjects(query, { limit: 6 });

      if (cancelled) return;

      if (queryError) {
        setSearchError(queryError.message);
        setSearchResults([]);
      } else {
        setSearchResults(matches || []);
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
    setLoading(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
  };

  const startClockIn = async () => {
    if (!displayProject) return;
    await onClockIn?.(displayProject);
  };

  const stopClockIn = async () => {
    await onClockOut?.("manual");
  };

  const switchSuggestedProject = async () => {
    if (!suggestedProject) return;
    await onSwitchProject?.(suggestedProject);
  };

  const switchToSearchProject = async (nextProject) => {
    if (!nextProject) return;
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
    await onSwitchProject?.(nextProject);
  };

  const adjustActiveStart = async (minutes) => {
    if (!activeShift?.startedAt) return;
    const currentStart = new Date(activeShift.startedAt);
    const nextStart = new Date(currentStart.getTime() + minutes * 60000);
    if (nextStart.getTime() > Date.now()) return;
    await onUpdateTimeEntry?.(activeShift, { startedAt: nextStart.toISOString() });
  };

  if (isClockedIn) {
    return (
      <ActiveClockInView
        project={displayProject}
        address={address}
        workedSinceClockIn={workedSinceClockIn}
        activeTimer={activeTimer}
        startTimeLabel={startTimeLabel}
        trackingNotice={trackingNotice}
        locationStatus={locationStatus}
        suggestedProject={suggestedProject}
        painterName={painterName}
        searchQuery={searchQuery}
        searchResults={searchResults}
        searching={searching}
        searchError={searchError}
        onSearchChange={setSearchQuery}
        onClearSearch={() => setSearchQuery("")}
        onSelectSearchProject={switchToSearchProject}
        onAdjustStart={adjustActiveStart}
        onSwitchProject={switchSuggestedProject}
        onClockOut={stopClockIn}
        onViewProject={displayProject ? () => onViewProject?.(displayProject) : null}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.painterName}>{painterName}</Text>
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
        <ClockInMap
          project={displayProject}
          projects={projects}
          currentPoint={currentPoint}
          onSelectProject={selectProject}
          onRequestLocation={refreshForegroundLocation}
        />

        <View style={styles.projectCardWrap} pointerEvents="box-none">
          <View style={styles.projectCard}>
            <View style={styles.projectThumb}>
              <Ionicons name="map" size={22} color={COLORS.teal} />
            </View>
            <View style={styles.projectInfo}>
              {loading ? (
                <ActivityIndicator color={COLORS.teal} />
              ) : displayProject ? (
                <>
                  <Text style={styles.projectName} numberOfLines={1}>
                    {displayProject.name}
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
          </View>
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

function formatClockTime(date) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function ActiveClockInView({
  painterName,
  project,
  address,
  workedSinceClockIn,
  activeTimer,
  startTimeLabel,
  trackingNotice,
  locationStatus,
  suggestedProject,
  searchQuery,
  searchResults,
  searching,
  searchError,
  onSearchChange,
  onClearSearch,
  onSelectSearchProject,
  onAdjustStart,
  onSwitchProject,
  onClockOut,
  onViewProject,
}) {
  const distanceLabel =
    locationStatus?.activeDistance == null ? null : `${formatDistance(locationStatus.activeDistance)} from job`;
  const statusMessage = trackingNotice?.message || locationStatus?.label || null;

  return (
    <View style={styles.activeScreen}>
      <View style={styles.activeTopBar}>
        <View style={styles.activeTopText}>
          <Text style={styles.painterName}>{painterName}</Text>
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

      <View style={styles.activeSearchWrap}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={COLORS.muted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder="Search to switch projects"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searching ? (
            <ActivityIndicator size="small" color={COLORS.teal} />
          ) : searchQuery ? (
            <Pressable hitSlop={8} onPress={onClearSearch}>
              <Ionicons name="close-circle" size={20} color={COLORS.muted} />
            </Pressable>
          ) : null}
        </View>

        {String(searchQuery || "").trim() ? (
          <View style={styles.searchResults}>
            {searchResults.map((result) => (
              <Pressable
                key={result.companycam_id}
                style={styles.searchResultRow}
                onPress={() => onSelectSearchProject?.(result)}
              >
                <View style={styles.searchResultIcon}>
                  <Ionicons name="swap-horizontal" size={15} color={COLORS.teal} />
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

          {statusMessage ? (
            <View style={styles.activeLocationNotice}>
              <Ionicons
                name={locationStatus?.onSite === false ? "warning-outline" : "navigate-outline"}
                size={16}
                color={locationStatus?.onSite === false ? "#b56025" : COLORS.teal}
              />
              <Text style={styles.activeLocationText} numberOfLines={2}>
                {statusMessage}
                {distanceLabel && !String(statusMessage).includes("from job") ? ` (${distanceLabel})` : ""}
              </Text>
            </View>
          ) : null}

          {suggestedProject ? (
            <Pressable style={styles.switchProjectButton} onPress={onSwitchProject}>
              <Ionicons name="swap-horizontal" size={17} color={COLORS.white} />
              <Text style={styles.switchProjectText} numberOfLines={1}>
                Switch to {suggestedProject.name}
              </Text>
            </Pressable>
          ) : null}

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
          <View style={styles.startTimeControls}>
            <Pressable style={styles.startAdjustButton} onPress={() => onAdjustStart?.(-15)}>
              <Text style={styles.startAdjustText}>-15m</Text>
            </Pressable>
            <View style={styles.startTimePill}>
              <Text style={styles.startTimeText}>{startTimeLabel}</Text>
            </View>
            <Pressable style={styles.startAdjustButton} onPress={() => onAdjustStart?.(15)}>
              <Text style={styles.startAdjustText}>+15m</Text>
            </Pressable>
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
  activeSearchWrap: {
    paddingHorizontal: 8,
    paddingTop: 10,
    backgroundColor: "#f7f7f7",
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
  startTimeControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  startAdjustButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: COLORS.white,
  },
  startAdjustText: {
    color: COLORS.teal,
    fontSize: 11.5,
    fontWeight: "900",
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
  activeLocationNotice: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: "#f5f8f6",
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  activeLocationText: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 12.5,
    fontWeight: "800",
    lineHeight: 17,
  },
  switchProjectButton: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: COLORS.green,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  switchProjectText: {
    color: COLORS.white,
    fontSize: 13.5,
    fontWeight: "900",
  },
});
