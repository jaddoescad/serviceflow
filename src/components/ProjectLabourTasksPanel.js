import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  isSameLabourTaskProject,
  projectLabourTaskSummary,
} from "../lib/projectLabourTaskModel";

// TEMPORARY DEMO — set to false (or delete this block) after checking.
// Fakes another painter being active on the first task so the presence UI
// (tinted row + "Pat is on this task") can be previewed with one account.
const DEMO_OTHER_PAINTER_PRESENCE = false;

const TEAL = "#2f8d7f";
const INK = "#11201d";
const MUTED = "#8b9692";
const BORDER = "#e0e3e1";
const HAIRLINE = "#edefee";
const WARNING = "#b56025";
const WHITE = "#ffffff";

function formatHours(value) {
  const hours = Math.max(0, Number(value) || 0);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

function formatElapsed(startedAt, now) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function visibleTaskHours(task, plan, now) {
  const activeTimerCount = task.activePainters?.length || (task.myActiveStartedAt ? 1 : 0);
  const liveHours = activeTimerCount > 0
    ? (Math.max(0, now - Number(plan.fetchedAt || now)) / 3_600_000) * activeTimerCount
    : 0;
  return Math.max(0, Number(task.hoursSpent) || 0) + liveHours;
}

function formatMinutesLabel(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function sessionStartLabel(startedAt) {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return "Last session";
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Started ${time}`;
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `Started ${day}, ${time}`;
}

function shortPainterName(value) {
  const name = String(value || "Painter").trim();
  return name.split(/\s+/)[0] || "Painter";
}

function painterPresenceLabel(task, currentUserId) {
  const painters = Array.isArray(task.activePainters) ? task.activePainters : [];
  const others = painters.filter((painter) => painter.userId !== currentUserId);
  if (others.length === 1) {
    return `${shortPainterName(others[0].displayName)} is on this task`;
  }
  if (others.length > 1) {
    return `${shortPainterName(others[0].displayName)} +${others.length - 1} are on this task`;
  }
  return null;
}

export default function ProjectLabourTasksPanel({
  project,
  activeShift,
  tracking,
  onOpenClockTab,
}) {
  const { plan } = tracking;
  const [now, setNow] = useState(Date.now());
  const [editingTask, setEditingTask] = useState(null);
  const activeTask = plan.tasks.find((task) => task.myActiveStartedAt) || null;
  const isClockedIntoProject = isSameLabourTaskProject(project, activeShift);

  useEffect(() => {
    if (!activeTask) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeTask?.id]);

  const summary = useMemo(
    () => projectLabourTaskSummary(plan, now),
    [now, plan],
  );

  if (tracking.loading && !plan.tasks.length && !plan.budget) {
    return (
      <View style={[styles.card, styles.centerState]}>
        <ActivityIndicator color={TEAL} />
        <Text style={styles.centerStateText}>Loading tasks…</Text>
      </View>
    );
  }

  if (!plan.budget && !plan.tasks.length) {
    return (
      <View style={[styles.card, styles.centerState]}>
        <Ionicons name="checkbox-outline" size={26} color={MUTED} />
        <Text style={styles.emptyTitle}>No tasks for this job yet</Text>
        {tracking.error ? (
          <Text style={styles.errorText}>{tracking.error}</Text>
        ) : null}
        <Pressable
          style={styles.refreshChip}
          accessibilityRole="button"
          accessibilityLabel="Refresh tasks"
          onPress={() => tracking.refresh()}
        >
          <Ionicons name="refresh" size={15} color={TEAL} />
          <Text style={styles.refreshChipText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  const overBudget = summary.budgetedHours > 0 && summary.spentHours > summary.budgetedHours;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Tasks</Text>
        <Pressable
          style={styles.refreshButton}
          accessibilityRole="button"
          accessibilityLabel="Refresh tasks"
          onPress={() => tracking.refresh()}
        >
          {tracking.loading ? (
            <ActivityIndicator size="small" color={MUTED} />
          ) : (
            <Ionicons name="refresh" size={16} color={MUTED} />
          )}
        </Pressable>
      </View>

      {summary.budgetedHours > 0 ? (
        <View style={styles.budgetBlock}>
          <View style={styles.budgetRow}>
            <Text style={[styles.budgetSpent, overBudget && styles.budgetOver]}>
              {formatHours(summary.spentHours)}
            </Text>
            <Text style={styles.budgetTotal}>
              {" "}of {formatHours(summary.budgetedHours)} budget
            </Text>
          </View>
          <View style={styles.budgetTrack}>
            <View
              style={[
                styles.budgetFill,
                {
                  width: `${Math.min(100, summary.hoursPercent)}%`,
                  backgroundColor: overBudget ? WARNING : TEAL,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      {plan.budget?.instructions ? (
        <Text style={styles.instructions} numberOfLines={3}>
          {plan.budget.instructions}
        </Text>
      ) : null}

      {!isClockedIntoProject ? (
        <View style={styles.noticeRow}>
          <Ionicons name="time-outline" size={14} color={MUTED} />
          <Text style={styles.noticeText}>
            {activeShift
              ? "Switch to this job to track task time."
              : "Clock in to track task time."}
          </Text>
        </View>
      ) : null}
      {tracking.syncNotice ? (
        <View style={styles.noticeRow}>
          <Ionicons name="cloud-upload-outline" size={14} color={MUTED} />
          <Text style={styles.noticeText}>{tracking.syncNotice}</Text>
        </View>
      ) : null}
      {tracking.error ? <Text style={styles.errorText}>{tracking.error}</Text> : null}

      <View style={styles.taskList}>
        {plan.tasks.length ? (
          // TEMPORARY DEMO — remove the map below with the flag above.
          plan.tasks.map((task, index) =>
            DEMO_OTHER_PAINTER_PRESENCE && index === 0 && !task.myActiveStartedAt
              ? {
                  ...task,
                  activePainters: [
                    ...(task.activePainters || []),
                    { userId: "demo-painter", displayName: "Pat Painter" },
                  ],
                }
              : task,
          ).map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              plan={plan}
              now={now}
              first={index === 0}
              canTrackTime={isClockedIntoProject}
              currentUserId={tracking.userId}
              pending={tracking.pendingTaskIds.has(task.id)}
              onStart={() => tracking.startTimer(task.id, activeShift)}
              onStop={() => tracking.stopTimer(task.id)}
              onEdit={() => setEditingTask(task)}
            />
          ))
        ) : (
          <Text style={styles.zeroTasksText}>This job's plan has no tasks yet.</Text>
        )}
      </View>


      {editingTask ? (
        <TaskTimeEditor
          task={editingTask}
          tracking={tracking}
          onClose={() => setEditingTask(null)}
        />
      ) : null}
    </View>
  );
}

function TaskTimeEditor({ task, tracking, onClose }) {
  const [session, setSession] = useState(null);
  const [minutes, setMinutes] = useState(0);
  const [originalMinutes, setOriginalMinutes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await tracking.fetchLastSession(task.id);
      if (cancelled) return;
      if (result.error) {
        setError(result.friendlyError || "Your recent time could not load.");
      } else if (result.data) {
        const durationMinutes = Math.max(
          0,
          Math.round(
            (new Date(result.data.ended_at).getTime() -
              new Date(result.data.started_at).getTime()) /
              60_000,
          ),
        );
        setSession(result.data);
        setMinutes(durationMinutes);
        setOriginalMinutes(durationMinutes);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const bump = (delta) => setMinutes((current) => Math.max(0, current + delta));

  const save = async () => {
    if (!session || saving) return;
    setSaving(true);
    const result = await tracking.adjustSession(task.id, session, minutes);
    setSaving(false);
    if (result?.error && !result?.queued) {
      setError(String(result.error.message || "The change could not be saved."));
      return;
    }
    onClose();
  };

  const dirty = Boolean(session) && minutes !== originalMinutes;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.editorBackdrop} onPress={onClose}>
        <Pressable style={styles.editorCard} onPress={() => {}}>
          <Text style={styles.editorTitle} numberOfLines={2}>{task.title}</Text>

          {loading ? (
            <View style={styles.editorCenter}>
              <ActivityIndicator color={TEAL} />
            </View>
          ) : session ? (
            <>
              <Text style={styles.editorCaption}>
                Your last session · {sessionStartLabel(session.started_at)}
              </Text>
              <Text style={styles.editorMinutes}>{formatMinutesLabel(minutes)}</Text>
              <View style={styles.editorSteppers}>
                {[-15, -5, 5, 15].map((delta) => (
                  <Pressable
                    key={delta}
                    style={styles.editorStepButton}
                    accessibilityRole="button"
                    accessibilityLabel={`${delta > 0 ? "Add" : "Remove"} ${Math.abs(delta)} minutes`}
                    disabled={saving || (delta < 0 && minutes === 0)}
                    onPress={() => bump(delta)}
                  >
                    <Text style={styles.editorStepText}>
                      {delta > 0 ? `+${delta}m` : `${delta}m`}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.editorHint}>
                Set it to 0m if this timer was started by accident.
              </Text>
            </>
          ) : (
            <Text style={styles.editorEmpty}>
              You haven't recorded time on this task yet. Only your own finished
              sessions can be adjusted.
            </Text>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.editorActions}>
            <Pressable
              style={styles.editorCancel}
              accessibilityRole="button"
              disabled={saving}
              onPress={onClose}
            >
              <Text style={styles.editorCancelText}>Cancel</Text>
            </Pressable>
            {session ? (
              <Pressable
                style={[styles.editorSave, (!dirty || saving) && styles.editorSaveDisabled]}
                accessibilityRole="button"
                accessibilityLabel="Save adjusted time"
                disabled={!dirty || saving}
                onPress={save}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={WHITE} />
                ) : (
                  <Text style={styles.editorSaveText}>Save</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TaskRow({
  task,
  plan,
  now,
  first,
  canTrackTime,
  currentUserId,
  pending,
  onStart,
  onStop,
  onEdit,
}) {
  const active = Boolean(task.myActiveStartedAt);
  const presenceLabel = painterPresenceLabel(task, currentUserId);
  const spentHours = visibleTaskHours(task, plan, now);
  const budgetedHours = Math.max(0, Number(task.budgetedHours) || 0);
  const percent = budgetedHours > 0 ? (spentHours / budgetedHours) * 100 : 0;
  const over = budgetedHours > 0 && spentHours > budgetedHours;

  const hoursLine = budgetedHours > 0
    ? `${formatHours(spentHours)} of ${formatHours(budgetedHours)}`
    : spentHours > 0
      ? `${formatHours(spentHours)} spent`
      : null;

  if (active) {
    return (
      <View style={styles.activeCard}>
        <View style={styles.activeHeader}>
          <Text style={[styles.taskTitle, styles.activeTitle]} numberOfLines={2}>
            {task.title}
          </Text>
          <Pressable
            style={styles.pillStop}
            accessibilityRole="button"
            accessibilityLabel={`Stop timer for ${task.title}`}
            disabled={pending}
            onPress={onStop}
          >
            {pending ? (
              <ActivityIndicator size="small" color={WHITE} />
            ) : (
              <Ionicons name="stop" size={13} color={WHITE} />
            )}
            <Text style={styles.pillStopText}>Stop</Text>
          </Pressable>
        </View>
        <Text style={styles.activeElapsed}>
          {formatElapsed(task.myActiveStartedAt, now)}
        </Text>
        {hoursLine ? (
          <Text style={[styles.taskHours, over && styles.taskHoursOver]}>
            {hoursLine}
          </Text>
        ) : null}
        {budgetedHours > 0 ? (
          <View style={styles.taskTrack}>
            <View
              style={[
                styles.taskFill,
                {
                  width: `${Math.min(100, percent)}%`,
                  backgroundColor: over ? WARNING : TEAL,
                },
              ]}
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.taskRow, !first && styles.taskRowDivider]}>
      <View style={styles.taskBody}>
        <Text style={styles.taskTitle} numberOfLines={2}>
          {task.title}
        </Text>
        {hoursLine || canTrackTime ? (
          <View style={styles.taskHoursRow}>
            {hoursLine ? (
              <Text style={[styles.taskHours, over && styles.taskHoursOver]}>
                {hoursLine}
              </Text>
            ) : null}
            {canTrackTime ? (
              <Pressable
                style={styles.editButton}
                accessibilityRole="button"
                accessibilityLabel={`Adjust time for ${task.title}`}
                hitSlop={10}
                disabled={pending}
                onPress={onEdit}
              >
                <Ionicons name="create-outline" size={15} color={MUTED} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {presenceLabel ? (
          <View style={styles.presenceRow}>
            <Ionicons name="people" size={13} color={TEAL} />
            <Text style={styles.presenceText} numberOfLines={1}>
              {presenceLabel}
            </Text>
          </View>
        ) : null}
        {task.notes ? (
          <Text style={styles.taskNotes} numberOfLines={2}>{task.notes}</Text>
        ) : null}
      </View>

      {canTrackTime ? (
        <Pressable
          style={styles.pillStart}
          accessibilityRole="button"
          accessibilityLabel={`Start timer for ${task.title}`}
          disabled={pending}
          onPress={onStart}
        >
          {pending ? (
            <ActivityIndicator size="small" color={TEAL} />
          ) : (
            <Ionicons name="play" size={13} color={TEAL} />
          )}
          <Text style={styles.pillStartText}>Start</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  centerState: {
    alignItems: "center",
    paddingVertical: 26,
    paddingBottom: 26,
  },
  centerStateText: {
    marginTop: 9,
    color: MUTED,
    fontSize: 12.5,
    fontWeight: "600",
  },
  emptyTitle: {
    marginTop: 8,
    color: INK,
    fontSize: 13.5,
    fontWeight: "800",
  },
  refreshChip: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#b9d6cd",
  },
  refreshChipText: {
    color: TEAL,
    fontSize: 12,
    fontWeight: "900",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerLabel: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  refreshButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  budgetBlock: {
    marginTop: 8,
  },
  budgetRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  budgetSpent: {
    color: INK,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  budgetOver: {
    color: WARNING,
  },
  budgetTotal: {
    color: MUTED,
    fontSize: 12.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  budgetTrack: {
    height: 5,
    marginTop: 8,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: HAIRLINE,
  },
  budgetFill: {
    height: "100%",
    borderRadius: 3,
  },
  instructions: {
    marginTop: 9,
    color: "#4c5a56",
    fontSize: 12.5,
    lineHeight: 18,
  },
  noticeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 9,
  },
  noticeText: {
    flex: 1,
    color: MUTED,
    fontSize: 11.5,
    fontWeight: "600",
    lineHeight: 15,
  },
  errorText: {
    marginTop: 9,
    color: "#c0432b",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  taskList: {
    marginTop: 6,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
  },
  taskRowDivider: {
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  taskHoursRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 3,
  },
  pillStart: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minWidth: 76,
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#b9d6cd",
    backgroundColor: "#f2f9f7",
  },
  pillStartText: {
    color: TEAL,
    fontSize: 12.5,
    fontWeight: "900",
  },
  activeCard: {
    marginVertical: 6,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#b9d6cd",
    backgroundColor: "#f2f9f7",
  },
  activeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  activeTitle: {
    flex: 1,
  },
  activeElapsed: {
    marginTop: 6,
    color: INK,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.8,
    fontVariant: ["tabular-nums"],
  },
  taskBody: {
    flex: 1,
  },
  taskTitle: {
    color: INK,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: "700",
  },
  presenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 3,
  },
  presenceText: {
    flex: 1,
    color: TEAL,
    fontSize: 11.5,
    fontWeight: "800",
  },
  taskHours: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  taskHoursOver: {
    color: WARNING,
  },
  taskNotes: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 15,
  },
  pillStop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minWidth: 74,
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: TEAL,
  },
  pillStopText: {
    color: WHITE,
    fontSize: 12.5,
    fontWeight: "900",
  },
  taskTrack: {
    height: 4,
    marginTop: 9,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: HAIRLINE,
  },
  taskFill: {
    height: "100%",
    borderRadius: 2,
  },
  editButton: {
    padding: 2,
  },
  editorBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(17, 32, 29, 0.45)",
  },
  editorCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    backgroundColor: WHITE,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
  },
  editorTitle: {
    color: INK,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  editorCenter: {
    paddingVertical: 30,
    alignItems: "center",
  },
  editorCaption: {
    marginTop: 4,
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
  },
  editorMinutes: {
    marginTop: 14,
    color: INK,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -1,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  editorSteppers: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  editorStepButton: {
    minWidth: 58,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  editorStepText: {
    color: TEAL,
    fontSize: 13,
    fontWeight: "900",
  },
  editorHint: {
    marginTop: 12,
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 15,
    textAlign: "center",
  },
  editorEmpty: {
    marginTop: 12,
    color: MUTED,
    fontSize: 12.5,
    lineHeight: 18,
  },
  editorActions: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  editorCancel: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  editorCancelText: {
    color: MUTED,
    fontSize: 13.5,
    fontWeight: "800",
  },
  editorSave: {
    minWidth: 84,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEAL,
  },
  editorSaveDisabled: {
    opacity: 0.45,
  },
  editorSaveText: {
    color: WHITE,
    fontSize: 13.5,
    fontWeight: "900",
  },
  zeroTasksText: {
    paddingVertical: 14,
    color: MUTED,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: "center",
  },
});
