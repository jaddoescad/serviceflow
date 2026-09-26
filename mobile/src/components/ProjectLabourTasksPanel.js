import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { projectLabourTaskSummary } from "../lib/projectLabourTaskModel";
import { BudgetBurnMeter } from "./BudgetProgress";
import { useProjectBudgetProgress } from "../lib/projectBudget";
import { getProjectId } from "../lib/projectRepository";

const TEAL = "#2f8d7f";
const INK = "#11201d";
const MUTED = "#8b9692";
const BORDER = "#e0e3e1";
const HAIRLINE = "#edefee";
const WHITE = "#ffffff";

function formatHours(value) {
  const hours = Math.max(0, Number(value) || 0);
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

function completedLabel(completedAt) {
  const date = new Date(completedAt);
  if (!Number.isFinite(date.getTime())) return "Done";
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Done · ${time}`;
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `Done · ${day}, ${time}`;
}

export default function ProjectLabourTasksPanel({
  project,
  activeShift,
  tracking,
  showHoursMeter = true,
}) {
  const { plan } = tracking;

  const summary = useMemo(() => projectLabourTaskSummary(plan), [plan]);
  const budgetProjects = useMemo(() => (project ? [project] : []), [getProjectId(project)]);
  const { progressByProjectId } = useProjectBudgetProgress(budgetProjects, {
    enabled: showHoursMeter && Boolean(project),
  });
  const budgetProgress = showHoursMeter
    ? progressByProjectId[String(getProjectId(project) || "")] || null
    : null;

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

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Tasks</Text>
      </View>

      {showHoursMeter ? (
        <BudgetBurnMeter progress={budgetProgress} style={styles.meterBlock} />
      ) : null}

      {summary.taskCount > 0 ? (
        <View style={styles.progressBlock}>
          <View style={styles.progressRow}>
            <Text style={styles.progressCount}>{summary.completedCount}</Text>
            <Text style={styles.progressTotal}>
              {" "}of {summary.taskCount} done
              {summary.budgetedHours > 0
                ? ` · ${formatHours(summary.budgetedHours)} budgeted`
                : ""}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, summary.completionPercent)}%` },
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

      {tracking.syncNotice ? (
        <View style={styles.noticeRow}>
          <Ionicons name="cloud-upload-outline" size={14} color={MUTED} />
          <Text style={styles.noticeText}>{tracking.syncNotice}</Text>
        </View>
      ) : null}
      {tracking.error ? <Text style={styles.errorText}>{tracking.error}</Text> : null}

      <View style={styles.taskList}>
        {plan.tasks.length ? (
          plan.tasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              first={index === 0}
              pending={tracking.pendingTaskIds.has(task.id)}
              onToggle={() => tracking.toggleCompleted(task)}
            />
          ))
        ) : (
          <Text style={styles.zeroTasksText}>This job's plan has no tasks yet.</Text>
        )}
      </View>
    </View>
  );
}

function TaskRow({ task, first, pending, onToggle }) {
  const completed = task.status === "completed";

  return (
    <Pressable
      style={[styles.taskRow, !first && styles.taskRowDivider]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: completed, disabled: pending }}
      accessibilityLabel={`${task.title}${completed ? ", completed" : ""}`}
      disabled={pending}
      onPress={onToggle}
    >
      <View style={[styles.checkbox, completed && styles.checkboxChecked]}>
        {pending ? (
          <ActivityIndicator size="small" color={completed ? WHITE : TEAL} />
        ) : completed ? (
          <Ionicons name="checkmark" size={17} color={WHITE} />
        ) : null}
      </View>

      <View style={styles.taskBody}>
        <Text
          style={[styles.taskTitle, completed && styles.taskTitleDone]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        {completed && task.completedAt ? (
          <Text style={styles.completedText}>{completedLabel(task.completedAt)}</Text>
        ) : null}
        {!completed && task.notes ? (
          <Text style={styles.taskNotes} numberOfLines={2}>{task.notes}</Text>
        ) : null}
      </View>

      {task.budgetedHours > 0 ? (
        <Text style={styles.budgetChip}>{formatHours(task.budgetedHours)}</Text>
      ) : null}
    </Pressable>
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
  meterBlock: {
    marginTop: 10,
  },
  progressBlock: {
    marginTop: 8,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  progressCount: {
    color: INK,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  progressTotal: {
    color: MUTED,
    fontSize: 12.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 5,
    marginTop: 8,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: HAIRLINE,
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: TEAL,
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
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#b9d6cd",
    backgroundColor: "#f7fbfa",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    borderColor: TEAL,
    backgroundColor: TEAL,
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
  taskTitleDone: {
    color: MUTED,
    textDecorationLine: "line-through",
  },
  completedText: {
    marginTop: 2,
    color: TEAL,
    fontSize: 11.5,
    fontWeight: "800",
  },
  budgetChip: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  taskNotes: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11.5,
    lineHeight: 15,
  },
  zeroTasksText: {
    paddingVertical: 14,
    color: MUTED,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: "center",
  },
});
