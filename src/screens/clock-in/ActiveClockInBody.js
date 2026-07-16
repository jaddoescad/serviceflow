import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BudgetHoursPanel } from "../../components/BudgetProgress";

// The active (clocked-in) Clock In page. Structured white panels with the
// job-hours budget panel front and centre: team hours used, hours left at the
// current pace, tank meter, and percent as a footnote. All figures stay
// aggregate — no dollar amounts or rates.

const TEAL = "#2f8d7f";
const NAVY = "#31495d";
const INK = "#11201d";
const MUTED = "#8b9692";
const BORDER = "#e0e3e1";
const RED = "#c0432b";
const WHITE = "#ffffff";

function formatSignedMinutes(minutes) {
  const value = Math.round(minutes || 0);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value)}m`;
}

export default function ActiveClockInBody({
  painterName,
  project,
  address,
  workedSinceClockIn,
  projectHoursUsed,
  projectHoursLabel,
  activeTimer,
  startTimeLabel,
  adjustmentSummary,
  budgetProgress,
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
      <View style={styles.topBar}>
        <Text style={styles.name}>{painterName}</Text>
        <BudgetHoursPanel
          progress={budgetProgress}
          primaryLabel="Hours today"
          primaryValue={workedSinceClockIn}
          primaryCaption="you"
          fallbackSecondaryLabel={projectHoursLabel}
          fallbackSecondaryValue={projectHoursUsed}
          style={styles.hoursPanel}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.projectRow}>
          <Ionicons name="location" size={22} color="#70c5d8" />
          <Text style={styles.projectName} numberOfLines={1}>{project?.name || "Selected Project"}</Text>
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
        <Text style={styles.projectAddress} numberOfLines={1}>{address || "No address on file"}</Text>

        {statusMessage ? (
          <View style={styles.locationRow}>
            <Ionicons
              name={offSite ? "warning-outline" : "navigate-outline"}
              size={15}
              color={offSite ? "#b56025" : TEAL}
            />
            <Text style={styles.locationText} numberOfLines={2}>{statusMessage}</Text>
          </View>
        ) : null}

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
            <Ionicons name="stop-circle-outline" size={20} color={WHITE} />
          )}
          <Text style={styles.clockOutText}>{clockingOut ? "Clocking Out" : "Clock Out"}</Text>
        </Pressable>

        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      </View>

      <View style={styles.rowCard}>
        <Text style={styles.rowLabel}>Edit start time</Text>
        <View style={styles.adjustRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Move start time 5 minutes earlier"
            disabled={adjustingStart}
            style={[styles.adjustButton, adjustingStart && styles.busy]}
            onPress={() => onAdjustStart?.(-5)}
          >
            <Text style={styles.adjustButtonText}>-5m</Text>
          </Pressable>
          <View style={styles.adjustCenter}>
            <Text style={styles.adjustCaption}>Started</Text>
            <Text style={styles.adjustTime}>{startTimeLabel}</Text>
          </View>
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
        {adjustmentSummary ? (
          <View style={styles.editedRow}>
            <Ionicons name="create-outline" size={13} color={MUTED} />
            <Text style={styles.editedText} numberOfLines={1}>
              Edited {formatSignedMinutes(adjustmentSummary.netMinutes)} · {adjustmentSummary.editedAtLabel}
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [styles.viewProject, !onViewProject && styles.busy, pressed && onViewProject && styles.pressedDim]}
        disabled={!onViewProject}
        onPress={onViewProject}
      >
        <Ionicons name="folder-open" size={19} color={WHITE} />
        <Text style={styles.viewProjectText}>View Project</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f6f6" },
  content: { paddingBottom: 20 },
  topBar: { backgroundColor: WHITE, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 13 },
  name: { flexShrink: 1, color: INK, fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  card: {
    backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    marginHorizontal: 10, marginTop: 12, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 14,
  },
  projectRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  projectName: { flex: 1, color: INK, fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  changeJob: {
    minHeight: 34, borderWidth: 1, borderColor: "#b9d6cd", borderRadius: 999,
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10,
  },
  changeJobText: { color: TEAL, fontSize: 11.5, fontWeight: "900" },
  projectAddress: { color: MUTED, fontSize: 13, fontWeight: "500", marginTop: 3, marginLeft: 29 },
  locationRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 10, paddingHorizontal: 8,
  },
  locationText: { color: "#4c5a56", fontSize: 12.5, fontWeight: "600", flexShrink: 1 },
  switchChip: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: TEAL, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
    alignSelf: "center", marginTop: 12, maxWidth: "100%",
  },
  switchChipText: { color: WHITE, fontSize: 13, fontWeight: "900", flexShrink: 1 },
  timerRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", marginTop: 14, marginBottom: 14 },
  timerMain: { color: INK, fontSize: 56, fontWeight: "900", letterSpacing: -2, lineHeight: 60 },
  timerSeconds: { color: MUTED, fontSize: 24, fontWeight: "800", marginBottom: 6 },
  clockOut: {
    minHeight: 52, borderRadius: 14, backgroundColor: RED,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  clockOutText: { color: WHITE, fontSize: 16, fontWeight: "900" },
  errorText: { color: RED, fontSize: 12.5, fontWeight: "700", marginTop: 9 },
  rowCard: {
    backgroundColor: WHITE, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    marginHorizontal: 10, marginTop: 10, paddingHorizontal: 14, paddingVertical: 12,
  },
  rowLabel: { color: MUTED, fontSize: 11, fontWeight: "800", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  adjustRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 10 },
  adjustButton: {
    minWidth: 52, borderWidth: 1.5, borderColor: BORDER, borderRadius: 10, paddingVertical: 7,
    alignItems: "center", justifyContent: "center",
  },
  adjustButtonText: { color: TEAL, fontSize: 13.5, fontWeight: "900" },
  adjustCenter: { alignItems: "center", minWidth: 86 },
  adjustCaption: { color: MUTED, fontSize: 10, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  adjustTime: { color: INK, fontSize: 15, fontWeight: "900", marginTop: 1 },
  editedRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 8 },
  editedText: { color: MUTED, fontSize: 11.5, fontWeight: "700" },
  viewProject: {
    minHeight: 54, borderRadius: 14, backgroundColor: NAVY, marginHorizontal: 10, marginTop: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9,
  },
  viewProjectText: { color: WHITE, fontSize: 15.5, fontWeight: "900" },
  busy: { opacity: 0.55 },
  pressedDim: { opacity: 0.85 },

  hoursPanel: { marginTop: 11 },
});
