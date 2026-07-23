import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ProjectLabourTasksPanel from "../../components/ProjectLabourTasksPanel";

// Active shift layout: the job is the header, every fixed control (timer,
// clock out, start-time edit, view project) sits in one card up top, and the
// open-ended task list comes last so it can grow without burying actions.

const TEAL = "#2f8d7f";
const NAVY = "#31495d";
const INK = "#11201d";
const MUTED = "#8b9692";
const BORDER = "#e0e3e1";
const HAIRLINE = "#edefee";
const RED = "#c0432b";
const WHITE = "#ffffff";

function formatSignedMinutes(minutes) {
  const value = Math.round(minutes || 0);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value)}m`;
}

export default function ActiveClockInBody({
  project,
  address,
  activeShift,
  labourTasks,
  activeTimer,
  startTimeLabel,
  adjustmentSummary,
  statusMessage,
  offSite,
  suggestedProject,
  clockingOut,
  switching,
  adjustingStart,
  actionError,
  onAdjustStart,
  onChangeJob,
  onSwitchProject,
  onClockOut,
  onViewProject,
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.jobName} numberOfLines={1}>
            {project?.name || "Selected Project"}
          </Text>
          <Text style={styles.jobAddress} numberOfLines={1}>
            {address || "No address on file"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose a different job"
          disabled={switching}
          style={({ pressed }) => [
            styles.changeJob,
            switching && styles.busy,
            pressed && !switching && styles.pressedDim,
          ]}
          onPress={onChangeJob}
        >
          <Ionicons name="swap-horizontal" size={15} color={TEAL} />
          <Text style={styles.changeJobText}>Change Job</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.locationRow}>
          {statusMessage ? (
            <>
              <Ionicons
                name={offSite ? "warning-outline" : "navigate-outline"}
                size={15}
                color={offSite ? "#b56025" : TEAL}
              />
              <Text style={styles.locationText} numberOfLines={2}>{statusMessage}</Text>
            </>
          ) : null}
        </View>

        {suggestedProject ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${suggestedProject.name}`}
            disabled={switching}
            style={({ pressed }) => [styles.switchChip, switching && styles.busy, pressed && !switching && styles.pressedDim]}
            onPress={onSwitchProject}
          >
            {switching ? (
              <ActivityIndicator size="small" color={WHITE} />
            ) : (
              <Ionicons name="swap-horizontal" size={16} color={WHITE} />
            )}
            <Text style={styles.switchChipText} numberOfLines={1}>
              {switching ? "Switching…" : `Switch to ${suggestedProject.name}`}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.shiftActions}>
          <View style={styles.timerRow}>
            <Text style={styles.timerMain}>{activeTimer.main}</Text>
            <Text style={styles.timerSeconds}>{activeTimer.seconds}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clock out current shift"
            disabled={clockingOut}
            style={({ pressed }) => [styles.clockOut, clockingOut && styles.busy, pressed && !clockingOut && styles.pressedDim]}
            onPress={onClockOut}
          >
            {clockingOut ? (
              <ActivityIndicator size="small" color={WHITE} />
            ) : (
              <Ionicons name="stop-circle-outline" size={19} color={WHITE} />
            )}
            <Text style={styles.clockOutText}>{clockingOut ? "Clocking Out" : "Clock Out"}</Text>
          </Pressable>
        </View>

        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

        <View style={styles.startRow}>
          <View style={styles.startInfo}>
            <Text style={styles.startCaption}>Started</Text>
            <Text style={styles.startTime}>{startTimeLabel}</Text>
            {adjustmentSummary ? (
              <Text style={styles.editedText} numberOfLines={1}>
                Edited {formatSignedMinutes(adjustmentSummary.netMinutes)}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Move start time 5 minutes earlier"
            disabled={adjustingStart}
            style={[styles.adjustButton, adjustingStart && styles.busy]}
            onPress={() => onAdjustStart?.(-5)}
          >
            <Text style={styles.adjustButtonText}>-5m</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Move start time 5 minutes later"
            disabled={adjustingStart}
            style={[styles.adjustButton, adjustingStart && styles.busy]}
            onPress={() => onAdjustStart?.(5)}
          >
            <Text style={styles.adjustButtonText}>+5m</Text>
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [styles.viewProjectRow, !onViewProject && styles.busy, pressed && onViewProject && styles.pressedDim]}
          accessibilityRole="button"
          accessibilityLabel="View project details"
          disabled={!onViewProject}
          onPress={onViewProject}
        >
          <Ionicons name="folder-open-outline" size={17} color={NAVY} />
          <Text style={styles.viewProjectText}>View Project</Text>
          <Ionicons name="chevron-forward" size={16} color={MUTED} />
        </Pressable>
      </View>

      <View style={styles.tasksSection}>
        <ProjectLabourTasksPanel
          project={project}
          activeShift={activeShift}
          tracking={labourTasks}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f6f6" },
  content: { paddingBottom: 24 },
  header: {
    backgroundColor: WHITE, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 13,
    flexDirection: "row", alignItems: "center", gap: 10,
    borderBottomWidth: 1, borderBottomColor: HAIRLINE,
  },
  headerText: { flex: 1 },
  jobName: { color: INK, fontSize: 18, fontWeight: "900", letterSpacing: -0.3 },
  jobAddress: { color: MUTED, fontSize: 12.5, fontWeight: "500", marginTop: 2 },
  changeJob: {
    minHeight: 34, borderWidth: 1, borderColor: "#b9d6cd", borderRadius: 999,
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10,
  },
  changeJobText: { color: TEAL, fontSize: 11.5, fontWeight: "900" },
  card: {
    backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    marginHorizontal: 10, marginTop: 12, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4,
  },
  locationRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 8,
    minHeight: 20,
  },
  locationText: { color: "#4c5a56", fontSize: 12.5, fontWeight: "600", flexShrink: 1 },
  switchChip: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: TEAL, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
    alignSelf: "center", marginTop: 10, maxWidth: "100%",
  },
  switchChipText: { color: WHITE, fontSize: 13, fontWeight: "900", flexShrink: 1 },
  shiftActions: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12,
    marginTop: 8, marginBottom: 12,
  },
  timerRow: { flexDirection: "row", alignItems: "flex-end", flexShrink: 1 },
  timerMain: { color: INK, fontSize: 34, fontWeight: "900", letterSpacing: -1, lineHeight: 39 },
  timerSeconds: { color: MUTED, fontSize: 17, fontWeight: "800", marginBottom: 3 },
  clockOut: {
    minHeight: 44, borderRadius: 12, backgroundColor: RED, paddingHorizontal: 15,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  clockOutText: { color: WHITE, fontSize: 14, fontWeight: "900" },
  errorText: { color: RED, fontSize: 12.5, fontWeight: "700", marginBottom: 10 },
  startRow: {
    flexDirection: "row", alignItems: "center", gap: 9,
    borderTopWidth: 1, borderTopColor: HAIRLINE, paddingVertical: 10,
  },
  startInfo: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 7, flexWrap: "wrap" },
  startCaption: { color: MUTED, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  startTime: { color: INK, fontSize: 14.5, fontWeight: "900" },
  editedText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  adjustButton: {
    minWidth: 48, borderWidth: 1.5, borderColor: BORDER, borderRadius: 10, paddingVertical: 6,
    alignItems: "center", justifyContent: "center",
  },
  adjustButtonText: { color: TEAL, fontSize: 13, fontWeight: "900" },
  viewProjectRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderTopWidth: 1, borderTopColor: HAIRLINE, paddingVertical: 12,
  },
  viewProjectText: { flex: 1, color: NAVY, fontSize: 13.5, fontWeight: "800" },
  tasksSection: { marginHorizontal: 10, marginTop: 10 },
  busy: { opacity: 0.55 },
  pressedDim: { opacity: 0.85 },
});
