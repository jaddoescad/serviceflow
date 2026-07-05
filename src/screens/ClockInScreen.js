import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getLatestActiveCompanyCamProject, searchActiveCompanyCamProjects } from "../lib/projectRepository";
import { formatDistance } from "../lib/timeTracking";
import { summarizeAdjustments } from "../lib/timeEntryPresenters";
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
const BOX_NONE_PROPS = Platform.OS === "web" ? {} : { pointerEvents: "box-none" };
// Don't auto-target a "nearest" project for clock-in if it's unreasonably far away.
const NEAREST_PROJECT_RADIUS_METERS = 2000;

function formatSignedMinutes(minutes) {
  const value = Math.round(minutes || 0);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value)}m`;
}

export default function ClockInScreen({
  painterName = "Painter",
  onViewProject,
  activeShift,
  activeElapsedMs = 0,
  todayWorkedMs = 0,
  locationStatus,
  trackingNotice,
  trackingPermissions,
  suggestedProject,
  projects = [],
  onClockIn,
  onClockOut,
  onSwitchProject,
  onUpdateTimeEntry,
}) {
  const insets = useSafeAreaInsets();
  const [defaultProject, setDefaultProject] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [foregroundPoint, setForegroundPoint] = useState(null);
  const [clockingIn, setClockingIn] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [adjustingStart, setAdjustingStart] = useState(false);
  const [clockInError, setClockInError] = useState("");

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
        setDefaultProject(latestProject);
      }
      setLoading(false);
    }

    loadProject();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshForegroundLocation = async ({ request = true } = {}) => {
    try {
      const permission = request
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
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
    if (trackingPermissions?.foreground) refreshForegroundLocation({ request: false });
  }, [trackingPermissions?.foreground]);

  const currentPoint = locationStatus?.point || foregroundPoint;
  const nearestProject = useMemo(
    () => findNearestProject(projects, currentPoint),
    [currentPoint?.latitude, currentPoint?.longitude, projects],
  );
  const nearestWithinRadius =
    nearestProject && nearestProject.distanceMeters <= NEAREST_PROJECT_RADIUS_METERS
      ? nearestProject.project
      : null;
  const displayProject = activeShift?.project || selectedProject || nearestWithinRadius || defaultProject;
  const displayClockedInAt = activeShift?.startedAt ? new Date(activeShift.startedAt) : null;
  const isClockedIn = !!activeShift;

  const address = useMemo(() => {
    return formatAddress(displayProject);
  }, [displayProject]);

  const workedSinceClockIn = useMemo(() => {
    const totalMinutes = Math.max(0, Math.floor(todayWorkedMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}H ${String(minutes).padStart(2, "0")}M`;
  }, [todayWorkedMs]);

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

  const adjustmentSummary = useMemo(() => summarizeAdjustments(activeShift), [activeShift]);

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
    Keyboard.dismiss();
    setSelectedProject(nextProject);
    setLoading(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
    setClockInError("");
  };

  const startClockIn = async () => {
    if (clockingIn) return;
    if (!displayProject) {
      setClockInError(error || "Choose an active project before clocking in.");
      return;
    }

    setClockingIn(true);
    setClockInError("");
    try {
      const shift = await onClockIn?.(displayProject);
      if (!shift) {
        setClockInError("Clock in could not start. Check location permissions and try again.");
      }
    } catch (nextError) {
      setClockInError(nextError?.message || "Clock in could not start. Try again.");
    } finally {
      setClockingIn(false);
    }
  };

  const stopClockIn = async () => {
    if (clockingOut) return;
    setClockingOut(true);
    setClockInError("");
    try {
      const entry = await onClockOut?.("manual");
      if (!entry) setClockInError("Clock out could not complete. Try again.");
    } catch (nextError) {
      setClockInError(nextError?.message || "Clock out could not complete. Try again.");
    } finally {
      setClockingOut(false);
    }
  };

  const switchSuggestedProject = async () => {
    if (!suggestedProject || switching) return;
    setSwitching(true);
    setClockInError("");
    try {
      const shift = await onSwitchProject?.(suggestedProject);
      if (!shift) {
        setClockInError("Switch could not complete. Check location permissions and try again.");
      }
    } catch (nextError) {
      setClockInError(nextError?.message || "Switch could not complete. Try again.");
    } finally {
      setSwitching(false);
    }
  };

  const adjustActiveStart = async (minutes) => {
    if (!activeShift?.startedAt || adjustingStart) return;
    const currentStart = new Date(activeShift.startedAt);
    const nextStart = new Date(currentStart.getTime() + minutes * 60000);
    if (nextStart.getTime() > Date.now()) {
      setClockInError("Start time can't be later than now.");
      return;
    }
    setAdjustingStart(true);
    setClockInError("");
    try {
      await onUpdateTimeEntry?.(activeShift, {
        startedAt: nextStart.toISOString(),
        adjustmentSource: "active_start_edit",
        skipAdjustmentHistory: true,
      });
    } catch (nextError) {
      setClockInError(nextError?.message || "Could not adjust start time. Try again.");
    } finally {
      setAdjustingStart(false);
    }
  };

  const clockInFeedback = trackingNotice?.message || clockInError;
  const clockInDisabled = clockingIn || !displayProject;

  if (isClockedIn) {
    return (
      <ActiveClockInView
        project={displayProject}
        address={address}
        workedSinceClockIn={workedSinceClockIn}
        activeTimer={activeTimer}
        startTimeLabel={startTimeLabel}
        adjustmentSummary={adjustmentSummary}
        trackingNotice={trackingNotice}
        locationStatus={locationStatus}
        suggestedProject={suggestedProject}
        painterName={painterName}
        clockingOut={clockingOut}
        switching={switching}
        adjustingStart={adjustingStart}
        actionError={clockInError}
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
          <Text style={styles.timeLabel}>Logged today</Text>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={COLORS.muted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              // Flip to the pending/searching state synchronously so the
              // "No matching projects found." empty state doesn't flash during
              // the 250ms debounce before the query has actually run.
              if (text.trim()) setSearching(true);
            }}
            placeholder="Search projects"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
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
          onDismissSearch={Keyboard.dismiss}
          onRequestLocation={refreshForegroundLocation}
          bottomInset={insets.bottom}
        />

        <View style={styles.projectCardWrap} {...BOX_NONE_PROPS}>
          <Pressable
            style={({ pressed }) => [styles.projectCard, pressed && displayProject && styles.projectCardPressed]}
            disabled={!displayProject}
            onPress={() => {
              Keyboard.dismiss();
              if (displayProject) onViewProject?.(displayProject);
            }}
          >
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
            {displayProject ? (
              <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
            ) : null}
          </Pressable>
        </View>

        <View style={[styles.clockInWrap, { bottom: insets.bottom + 22 }]} {...BOX_NONE_PROPS}>
          {clockInFeedback ? (
            <View style={styles.clockInFeedback}>
              <Ionicons name="alert-circle" size={16} color={COLORS.navy} />
              <Text style={styles.clockInFeedbackText}>{clockInFeedback}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start clock in"
            disabled={clockInDisabled}
            style={({ pressed }) => [
              styles.clockInPill,
              clockInDisabled && styles.clockInDisabled,
              pressed && !clockInDisabled && styles.clockInPressed,
            ]}
            onPress={() => {
              Keyboard.dismiss();
              startClockIn();
            }}
          >
            <View style={styles.playCircle}>
              {clockingIn ? (
                <ActivityIndicator size="small" color={COLORS.navy} />
              ) : (
                <Ionicons name="play" size={16} color={COLORS.navy} />
              )}
            </View>
            <Text style={styles.clockInText}>{clockingIn ? "Clocking In" : "Clock In"}</Text>
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
  adjustmentSummary,
  trackingNotice,
  locationStatus,
  suggestedProject,
  clockingOut = false,
  switching = false,
  adjustingStart = false,
  actionError = "",
  onAdjustStart,
  onSwitchProject,
  onClockOut,
  onViewProject,
}) {
  const [editedOpen, setEditedOpen] = useState(false);
  const distanceText =
    locationStatus?.activeDistance == null ? null : formatDistance(locationStatus.activeDistance);
  const distanceLabel = distanceText ? `${distanceText} from job` : null;
  const statusMessage = trackingNotice?.message || locationStatus?.label || null;
  const showDistanceLabel =
    distanceLabel && distanceText && !String(statusMessage).includes(distanceText);

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

      <View style={styles.activeContent}>
        <View style={styles.activeTimerCard}>
          <View style={styles.activeProjectRow}>
            <View style={styles.activeProjectTitleWrap}>
              <Ionicons name="location" size={25} color="#70c5d8" />
              <Text style={styles.activeProjectName} numberOfLines={1}>
                {project?.name || "Selected Project"}
              </Text>
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
                {showDistanceLabel ? ` (${distanceLabel})` : ""}
              </Text>
            </View>
          ) : null}

          {suggestedProject ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${suggestedProject.name}`}
              disabled={switching}
              style={({ pressed }) => [
                styles.switchProjectButton,
                switching && styles.buttonBusy,
                pressed && !switching && styles.clockOutPressed,
              ]}
              onPress={onSwitchProject}
            >
              {switching ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Ionicons name="swap-horizontal" size={17} color={COLORS.white} />
              )}
              <Text style={styles.switchProjectText} numberOfLines={1}>
                {switching ? "Switching…" : `Switch to ${suggestedProject.name}`}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.bigTimerRow}>
            <Text style={styles.bigTimerMain}>{activeTimer.main}</Text>
            <Text style={styles.bigTimerSeconds}>{activeTimer.seconds}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clock out current shift"
            disabled={clockingOut}
            style={({ pressed }) => [
              styles.clockOutButton,
              clockingOut && styles.buttonBusy,
              pressed && !clockingOut && styles.clockOutPressed,
            ]}
            onPress={onClockOut}
          >
            {clockingOut ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="stop-circle-outline" size={20} color={COLORS.white} />
            )}
            <Text style={styles.clockOutText}>{clockingOut ? "Clocking Out" : "Clock Out"}</Text>
          </Pressable>

          {actionError ? <Text style={styles.activeErrorText}>{actionError}</Text> : null}
        </View>

        <View style={styles.activeRowCard}>
          <Text style={styles.activeRowLabel}>Edit Start Time</Text>
          <View style={styles.startTimeControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Move start time 5 minutes earlier"
              disabled={adjustingStart}
              style={[styles.startAdjustButton, adjustingStart && styles.buttonBusy]}
              onPress={() => onAdjustStart?.(-5)}
            >
              <Text style={styles.startAdjustText}>-5m</Text>
            </Pressable>
            <View style={styles.startTimePill}>
              <Text style={styles.startTimeText}>{startTimeLabel}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Move start time 5 minutes later"
              disabled={adjustingStart}
              style={[styles.startAdjustButton, adjustingStart && styles.buttonBusy]}
              onPress={() => onAdjustStart?.(5)}
            >
              <Text style={styles.startAdjustText}>+5m</Text>
            </Pressable>
          </View>
        </View>

        {adjustmentSummary ? (
          <View style={styles.editedCard}>
            <Pressable
              style={styles.editedHeader}
              onPress={() => setEditedOpen((open) => !open)}
            >
              <Text style={styles.editedTitle}>Edited</Text>
              <Ionicons
                name={editedOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={COLORS.muted}
              />
            </Pressable>
            {editedOpen ? (
              <View style={styles.editedDetail}>
                <Text style={styles.editedDetailTime}>{adjustmentSummary.editedAtLabel}</Text>
                <Text style={styles.editedDetailDelta}>
                  {formatSignedMinutes(adjustmentSummary.netMinutes)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

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
  buttonBusy: {
    opacity: 0.6,
  },
  activeErrorText: {
    marginTop: 10,
    color: "#b42318",
    fontSize: 12.5,
    fontWeight: "800",
    textAlign: "center",
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
  editedCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  editedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editedTitle: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  editedDetail: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  editedDetailTime: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: "600",
  },
  editedDetailDelta: {
    color: COLORS.teal,
    fontSize: 13,
    fontWeight: "800",
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
    ...Platform.select({
      web: { boxShadow: "0 4px 10px rgba(0,0,0,0.08)" },
      default: {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      },
    }),
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
    ...Platform.select({
      web: { boxShadow: "0 4px 10px rgba(0,0,0,0.08)" },
      default: {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      },
    }),
    overflow: "hidden",
  },
  projectCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
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
    ...Platform.select({
      web: { boxShadow: "0 6px 12px rgba(0,0,0,0.2)" },
      default: {
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      },
    }),
  },
  clockInFeedback: {
    maxWidth: "86%",
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...Platform.select({
      web: { boxShadow: "0 4px 8px rgba(0,0,0,0.12)" },
      default: {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      },
    }),
  },
  clockInFeedbackText: {
    flex: 1,
    color: COLORS.ink,
    fontSize: 12.5,
    fontWeight: "700",
    lineHeight: 17,
  },
  clockInDisabled: {
    opacity: 0.55,
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
