import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ActiveClockInBody from "./clock-in/ActiveClockInBody";
import OverBudgetReasonSheet from "../components/OverBudgetReasonSheet";
import {
  evaluateJobOverBudget,
  hasAnsweredJobOverBudgetReason,
  markJobOverBudgetReasonAnswered,
  submitJobOverBudgetReason,
} from "../lib/jobOverBudget";
import { getLatestActiveCompanyCamProject, getProjectId, searchActiveCompanyCamProjects } from "../lib/projectRepository";
import { formatDistance } from "../lib/timeTracking";
import { summarizeAdjustments } from "../lib/timeEntryPresenters";
import { useProjectLabourTasks } from "../lib/useProjectLabourTasks";
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
  enabled = true,
  user,
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
  const [jobReasonPrompt, setJobReasonPrompt] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
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
  const labourTasks = useProjectLabourTasks(getProjectId(displayProject), {
    enabled: enabled && isClockedIn,
    userId: user?.id || null,
  });

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
  const switchProjects = useMemo(() => {
    const currentProjectId = getProjectId(activeShift?.project);
    const source = searchQuery.trim() ? searchResults : projects;
    const seen = new Set();
    return (source || [])
      .filter((project) => {
        const projectId = getProjectId(project);
        if (!projectId || projectId === currentProjectId || project?.is_archived || seen.has(projectId)) {
          return false;
        }
        seen.add(projectId);
        return true;
      })
      .slice(0, searchQuery.trim() ? 12 : 40);
  }, [activeShift?.project, projects, searchQuery, searchResults]);

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

  const maybePromptJobOverBudget = async (project) => {
    try {
      const projectId = getProjectId(project);
      if (!projectId || !user?.id) return;
      if (await hasAnsweredJobOverBudgetReason(user.id, projectId)) return;
      const { over, hoursOver } = await evaluateJobOverBudget(projectId);
      if (over) setJobReasonPrompt({ project, projectId, hoursOver });
    } catch (_error) {
      // The reason prompt is best effort; clock-out already succeeded.
    }
  };

  const stopClockIn = async () => {
    if (clockingOut) return;
    const project = displayProject;
    setClockingOut(true);
    setClockInError("");
    // Open the job page first so the map never flashes while the shift ends.
    // On failure the job page still shows the live shift and its own
    // Clock Out button, so the state stays coherent.
    if (project) onViewProject?.(project);
    try {
      const entry = await onClockOut?.("manual");
      if (!entry) {
        setClockInError("Clock out could not complete. Try again.");
        return;
      }
      if (project) maybePromptJobOverBudget(project);
    } catch (nextError) {
      setClockInError(nextError?.message || "Clock out could not complete. Try again.");
    } finally {
      setClockingOut(false);
    }
  };

  const jobReasonSheet = jobReasonPrompt ? (
    <OverBudgetReasonSheet
      task={{ title: jobReasonPrompt.project?.name || jobReasonPrompt.project?.title || "This job" }}
      hoursOver={jobReasonPrompt.hoursOver}
      onSubmit={async ({ reason, note }) => {
        await submitJobOverBudgetReason({
          projectId: jobReasonPrompt.projectId,
          userId: user?.id,
          reason,
          note,
          hoursOver: jobReasonPrompt.hoursOver,
        });
        await markJobOverBudgetReasonAnswered(user?.id, jobReasonPrompt.projectId);
        setJobReasonPrompt(null);
      }}
      onSkip={async () => {
        await markJobOverBudgetReasonAnswered(user?.id, jobReasonPrompt.projectId);
        setJobReasonPrompt(null);
      }}
    />
  ) : null;

  const closeProjectSwitcher = () => {
    if (switching) return;
    Keyboard.dismiss();
    setProjectSwitcherOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
  };

  const openProjectSwitcher = () => {
    if (switching) return;
    setClockInError("");
    setSearchQuery("");
    setSearchResults([]);
    setSearchError("");
    setProjectSwitcherOpen(true);
  };

  const switchToProject = async (nextProject) => {
    if (!nextProject || switching) return;
    if (getProjectId(nextProject) === getProjectId(activeShift?.project)) {
      closeProjectSwitcher();
      return;
    }
    setSwitching(true);
    setClockInError("");
    try {
      const shift = await onSwitchProject?.(nextProject);
      if (!shift) {
        setClockInError("Switch could not complete. Check location permissions and try again.");
      } else {
        Keyboard.dismiss();
        setProjectSwitcherOpen(false);
        setSearchQuery("");
        setSearchResults([]);
        setSearchError("");
      }
    } catch (nextError) {
      setClockInError(nextError?.message || "Switch could not complete. Try again.");
    } finally {
      setSwitching(false);
    }
  };

  const switchSuggestedProject = () => switchToProject(suggestedProject);

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
      <View style={styles.activeScreen}>
        <ActiveClockInView
          project={displayProject}
          address={address}
          activeShift={activeShift}
          labourTasks={labourTasks}
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
          onChangeJob={openProjectSwitcher}
          onSwitchProject={switchSuggestedProject}
          onClockOut={stopClockIn}
          onViewProject={displayProject ? () => onViewProject?.(displayProject) : null}
        />
        {jobReasonSheet}
        <ProjectSwitcherModal
          visible={projectSwitcherOpen}
          currentProject={displayProject}
          projects={switchProjects}
          query={searchQuery}
          searching={searching}
          searchError={searchError}
          switching={switching}
          actionError={clockInError}
          bottomInset={insets.bottom}
          onChangeQuery={(text) => {
            setSearchQuery(text);
            if (text.trim()) setSearching(true);
          }}
          onClose={closeProjectSwitcher}
          onSelectProject={switchToProject}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.painterName}>{painterName}</Text>
        <View style={styles.timeRow}>
          <Text style={styles.timeBig}>{workedSinceClockIn}</Text>
          <Text style={styles.timeLabel}>Hours used today</Text>
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
      {jobReasonSheet}
    </View>
  );
}

function formatClockTime(date) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function ProjectSwitcherModal({
  visible,
  currentProject,
  projects,
  query,
  searching,
  searchError,
  switching,
  actionError,
  bottomInset,
  onChangeQuery,
  onClose,
  onSelectProject,
}) {
  const hasQuery = Boolean(query.trim());
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.switcherBackdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close job selector"
          disabled={switching}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
          style={styles.switcherKeyboardAvoider}
        >
          <View style={[styles.switcherSheet, { paddingBottom: Math.max(18, bottomInset + 10) }]}>
          <View style={styles.switcherHandle} />
          <View style={styles.switcherHeader}>
            <View style={styles.switcherTitleWrap}>
              <Text style={styles.switcherTitle}>Change Job</Text>
              <Text style={styles.switcherSubtitle} numberOfLines={1}>
                Currently at {currentProject?.name || "selected job"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close job selector"
              disabled={switching}
              hitSlop={8}
              style={styles.switcherClose}
              onPress={onClose}
            >
              <Ionicons name="close" size={22} color={COLORS.navy} />
            </Pressable>
          </View>

          <View style={styles.switcherSearchBox}>
            <Ionicons name="search" size={19} color={COLORS.muted} />
            <TextInput
              autoFocus={Platform.OS !== "web"}
              style={styles.switcherSearchInput}
              value={query}
              editable={!switching}
              onChangeText={onChangeQuery}
              placeholder="Search active projects"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {searching ? (
              <ActivityIndicator size="small" color={COLORS.teal} />
            ) : query ? (
              <Pressable hitSlop={8} disabled={switching} onPress={() => onChangeQuery("")}>
                <Ionicons name="close-circle" size={20} color={COLORS.muted} />
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.switcherSectionLabel}>
            {hasQuery ? "Search results" : "Active projects"}
          </Text>
          <ScrollView
            style={styles.switcherList}
            contentContainerStyle={styles.switcherListContent}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
          >
            {projects.map((project) => (
              <Pressable
                key={getProjectId(project)}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${project.name || "project"}`}
                disabled={switching}
                style={({ pressed }) => [
                  styles.switcherProjectRow,
                  switching && styles.switcherDisabled,
                  pressed && !switching && styles.projectCardPressed,
                ]}
                onPress={() => onSelectProject(project)}
              >
                <View style={styles.switcherProjectIcon}>
                  {switching ? (
                    <Ionicons name="location" size={18} color={COLORS.teal} />
                  ) : (
                    <Ionicons name="briefcase-outline" size={18} color={COLORS.teal} />
                  )}
                </View>
                <View style={styles.switcherProjectText}>
                  <Text style={styles.switcherProjectName} numberOfLines={1}>
                    {project.name || "Project"}
                  </Text>
                  <Text style={styles.switcherProjectAddress} numberOfLines={1}>
                    {formatAddress(project) || "No address on file"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={COLORS.muted} />
              </Pressable>
            ))}
            {!searching && !projects.length ? (
              <Text style={styles.switcherEmpty}>
                {searchError || (hasQuery ? "No matching active projects found." : "No other active projects are available.")}
              </Text>
            ) : null}
          </ScrollView>
          {switching ? (
            <View style={styles.switcherProgress}>
              <ActivityIndicator size="small" color={COLORS.teal} />
              <Text style={styles.switcherProgressText}>Changing jobs…</Text>
            </View>
          ) : actionError ? (
            <Text style={styles.switcherError}>{actionError}</Text>
          ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function ActiveClockInView({
  painterName,
  project,
  address,
  activeShift,
  labourTasks,
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
  onChangeJob,
  onSwitchProject,
  onClockOut,
  onViewProject,
}) {
  const distanceText =
    locationStatus?.activeDistance == null ? null : formatDistance(locationStatus.activeDistance);
  const distanceLabel = distanceText ? `${distanceText} from job` : null;
  const baseMessage = trackingNotice?.message || locationStatus?.label || null;
  const statusMessage =
    baseMessage && distanceLabel && !String(baseMessage).includes(distanceText)
      ? `${baseMessage} (${distanceLabel})`
      : baseMessage;

  return (
    <View style={styles.activeScreen}>
      <ActiveClockInBody
        painterName={painterName}
        project={project}
        address={address}
        activeShift={activeShift}
        labourTasks={labourTasks}
        activeTimer={activeTimer}
        startTimeLabel={startTimeLabel}
        adjustmentSummary={adjustmentSummary}
        statusMessage={statusMessage}
        offSite={locationStatus?.onSite === false}
        suggestedProject={suggestedProject}
        clockingOut={clockingOut}
        switching={switching}
        adjustingStart={adjustingStart}
        actionError={actionError}
        onAdjustStart={onAdjustStart}
        onChangeJob={onChangeJob}
        onSwitchProject={onSwitchProject}
        onClockOut={onClockOut}
        onViewProject={onViewProject}
      />
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
  switcherBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(17, 32, 29, 0.42)",
  },
  switcherKeyboardAvoider: {
    flex: 1,
    justifyContent: "flex-end",
  },
  switcherSheet: {
    width: "100%",
    maxHeight: "82%",
    alignSelf: "center",
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    ...Platform.select({
      web: { maxWidth: 620 },
      default: {},
    }),
  },
  switcherHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#d7ddda",
    alignSelf: "center",
    marginBottom: 12,
  },
  switcherHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  switcherTitleWrap: { flex: 1, minWidth: 0 },
  switcherTitle: { color: COLORS.ink, fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
  switcherSubtitle: { color: COLORS.muted, fontSize: 12.5, fontWeight: "600", marginTop: 2 },
  switcherClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#edf2ef",
  },
  switcherSearchBox: {
    height: 48,
    marginTop: 16,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#dfe7e3",
    backgroundColor: "#f4f7f5",
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  switcherSearchInput: { flex: 1, height: "100%", color: COLORS.ink, fontSize: 15, fontWeight: "700" },
  switcherSectionLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 7,
  },
  switcherList: { flexGrow: 0 },
  switcherListContent: { paddingBottom: 4 },
  switcherProjectRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#edf0ee",
    paddingVertical: 9,
  },
  switcherProjectIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#e9f3ee",
    alignItems: "center",
    justifyContent: "center",
  },
  switcherProjectText: { flex: 1, minWidth: 0 },
  switcherProjectName: { color: COLORS.ink, fontSize: 14.5, fontWeight: "900" },
  switcherProjectAddress: { color: COLORS.muted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  switcherEmpty: { color: COLORS.muted, fontSize: 13, fontWeight: "700", textAlign: "center", paddingVertical: 24 },
  switcherDisabled: { opacity: 0.6 },
  switcherProgress: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 12 },
  switcherProgressText: { color: COLORS.navy, fontSize: 13, fontWeight: "800" },
  switcherError: { color: "#c0432b", fontSize: 12.5, fontWeight: "700", paddingTop: 10 },
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

});
