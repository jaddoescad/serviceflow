import { StyleSheet, Text, View } from "react-native";
import { getBudgetProgressPresentation } from "../lib/projectBudget";

const TRACKED_STATUSES = new Set(["under", "at", "over"]);

export function getBudgetStatusLabel(status) {
  if (status === "under") return "Under budget";
  if (status === "at") return "At budget";
  if (status === "over") return "Over budget";
  if (status === "loading") return "Loading budget";
  if (status === "not_configured") return "Budget pending";
  if (status === "incomplete") return "Data incomplete";
  return "Budget unavailable";
}

export function getTeamHoursLabel(progress) {
  return formatHoursValue(Number(progress?.hoursUsed)) || "—";
}

function formatHoursValue(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}h`;
}

// Painter-friendly hours framing of budget progress. Hours left is derived
// from the two returned aggregates (used ÷ percent × remaining percent), so
// nothing beyond percent and team hours is ever exposed.
export function getBudgetHoursBreakdown(progress) {
  const presentation = getBudgetProgressPresentation(progress);
  const tracked = TRACKED_STATUSES.has(presentation.status);
  const hoursUsed = Number(progress?.hoursUsed);
  const percentUsed = Number(progress?.percentUsed);
  const derivable =
    tracked &&
    Number.isFinite(hoursUsed) && hoursUsed > 0 &&
    Number.isFinite(percentUsed) && percentUsed > 0;
  const hoursLeft = derivable ? (hoursUsed * (100 - percentUsed)) / percentUsed : null;
  return {
    presentation,
    tracked,
    derivable,
    noHoursYet: tracked && (!Number.isFinite(hoursUsed) || hoursUsed === 0),
    usedLabel: formatHoursValue(hoursUsed),
    leftLabel: derivable ? formatHoursValue(Math.abs(hoursLeft)) : null,
    // The full hours allowance the labour budget covers (used + left).
    totalLabel: derivable ? formatHoursValue((hoursUsed * 100) / percentUsed) : null,
    over: derivable && hoursLeft < 0,
  };
}

export function shouldShowBudgetProgress(progress) {
  const status = getBudgetProgressPresentation(progress).status;
  return TRACKED_STATUSES.has(status) || status === "incomplete";
}

export function BudgetMeter({ progress, dark = false, style }) {
  const presentation = getBudgetProgressPresentation(progress);
  const fillColor = dark && presentation.status !== "over"
    ? "#a9f1c4"
    : presentation.color;

  return (
    <View style={[styles.track, dark && styles.darkTrack, style]}>
      <View
        style={[
          styles.fill,
          { width: `${presentation.fillPercent}%`, backgroundColor: fillColor },
        ]}
      />
    </View>
  );
}

// Match the strip to the actual budget status. An under-budget job remains
// green all the way to its limit instead of turning orange prematurely.
function getBurnZone(progress) {
  const status = getBudgetProgressPresentation(progress).status;
  if (status === "over") return { color: "#c0432b", warning: true };
  if (status === "at") return { color: "#9a611f", warning: true };
  return { color: "#2f8d7f", warning: false };
}

function Tank({ progress, zone, segments = 12, height = 12 }) {
  const percentUsed = Number(progress?.percentUsed);
  const fillRatio = Number.isFinite(percentUsed)
    ? Math.min(1, Math.max(0, percentUsed / 100))
    : 0;
  const lit = !Number.isFinite(percentUsed)
    ? 0
    : percentUsed > 100
      ? segments
      : Math.min(segments, Math.max(percentUsed > 0 ? 1 : 0, Math.round(fillRatio * segments)));
  return (
    <View style={styles.tankTrack}>
      {Array.from({ length: segments }, (_, index) => (
        <View
          key={index}
          style={[
            styles.tankSegment,
            { height },
            index < lit ? { backgroundColor: zone.color } : styles.tankSegmentOff,
          ]}
        />
      ))}
    </View>
  );
}

// The one hours story, shared by the Clock In page and the project detail
// page: your hours | team hours used | hours left, with the burn tank and the
// percentage as a footnote. Falls back gracefully when the job has no budget
// or no hours yet.
export function BudgetHoursPanel({
  progress,
  title = "Job hours",
  primaryLabel,
  primaryValue,
  primaryCaption = "you",
  fallbackSecondaryLabel = "Team hours",
  fallbackSecondaryValue = "—",
  style,
}) {
  const breakdown = getBudgetHoursBreakdown(progress);
  const zone = getBurnZone(progress);
  const over = breakdown.over;

  return (
    <View style={style}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{title}</Text>
        {breakdown.tracked ? (
          <View style={[styles.panelChip, { backgroundColor: breakdown.presentation.backgroundColor }]}>
            <Text style={[styles.panelChipText, { color: zone.color }]}>
              {getBudgetStatusLabel(breakdown.presentation.status)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.panelStatsRow}>
        <View style={styles.panelStat}>
          <Text style={styles.panelStatLabel}>{primaryLabel}</Text>
          <Text style={styles.panelStatValue}>{primaryValue}</Text>
          {primaryCaption ? <Text style={styles.panelStatCaption}>{primaryCaption}</Text> : null}
        </View>
        <View style={styles.panelStatDivider} />
        {breakdown.derivable ? (
          <>
            <View style={styles.panelStat}>
              <Text style={styles.panelStatLabel}>Hours used</Text>
              <Text style={styles.panelStatValue}>{breakdown.usedLabel}</Text>
              <Text style={styles.panelStatCaption}>whole team</Text>
            </View>
            <View style={styles.panelStatDivider} />
            <View style={styles.panelStat}>
              <Text style={styles.panelStatLabel}>{over ? "Hours over" : "Hours left"}</Text>
              <Text style={[styles.panelStatValue, { color: zone.color }]}>
                {breakdown.leftLabel}
              </Text>
              <Text
                style={[
                  styles.panelStatCaption,
                  over && { color: zone.color, fontWeight: "800" },
                ]}
              >
                {over ? "over budget" : "in the budget"}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.panelStat}>
            <Text style={styles.panelStatLabel}>{fallbackSecondaryLabel}</Text>
            <Text style={styles.panelStatValue}>
              {breakdown.usedLabel || fallbackSecondaryValue}
            </Text>
            {breakdown.usedLabel ? (
              <Text style={styles.panelStatCaption}>whole team</Text>
            ) : null}
          </View>
        )}
      </View>

      {breakdown.tracked || breakdown.presentation.status === "loading" ? (
        <>
          <Tank progress={progress} zone={zone} />
          <Text style={styles.panelFootnote}>
            {breakdown.presentation.status === "loading"
              ? "Loading budget…"
              : breakdown.totalLabel
                ? `${breakdown.totalLabel} expected total · ${breakdown.presentation.percentLabel} used`
                : `${breakdown.presentation.percentLabel} of the labour budget used`}
          </Text>
        </>
      ) : null}
    </View>
  );
}

// Compact hours story for embedding in other cards (e.g. the tasks panel):
// used vs left, the segmented burn tank, and the percent footnote.
export function BudgetBurnMeter({ progress, style }) {
  const breakdown = getBudgetHoursBreakdown(progress);
  const zone = getBurnZone(progress);

  // While the budget is loading, hold the meter's full space with an empty
  // tank so the checklist below never jumps when the numbers arrive.
  if (!progress) {
    return (
      <View style={style}>
        <View style={styles.meterRow}>
          <Text style={styles.meterUsed}>–</Text>
          <Text style={styles.meterCaption}> used</Text>
        </View>
        <Tank progress={null} zone={zone} />
        <Text style={styles.panelFootnote}>Loading budget…</Text>
      </View>
    );
  }
  if (!breakdown.tracked) return null;

  return (
    <View style={style}>
      <View style={styles.meterRow}>
        <Text style={styles.meterUsed}>{breakdown.usedLabel || "0h"}</Text>
        <Text style={styles.meterCaption}> used</Text>
        {breakdown.derivable ? (
          <Text style={[styles.meterLeft, { color: zone.color }]}>
            {breakdown.over
              ? `${breakdown.leftLabel} over budget`
              : `${breakdown.leftLabel} left`}
          </Text>
        ) : null}
      </View>
      <Tank progress={progress} zone={zone} />
      <Text style={styles.panelFootnote}>
        {breakdown.totalLabel
          ? `${breakdown.totalLabel} expected total · ${breakdown.presentation.percentLabel} used`
          : `${breakdown.presentation.percentLabel} of the labour budget used`}
      </Text>
    </View>
  );
}

// One quiet line of budget context on project cards: a mini burn meter plus
// the single fact a painter acts on — hours left (or hours over). Renders
// nothing until a job has a budget and real hours, so cards stay clean.
export function BudgetProgressBadge({ progress, dark = false }) {
  const breakdown = getBudgetHoursBreakdown(progress);
  if (!breakdown.derivable) return null;
  const color = dark
    ? breakdown.over
      ? "#ffb3a1"
      : "rgba(255,255,255,0.9)"
    : breakdown.presentation.color;
  const fillColor = dark
    ? breakdown.over
      ? "#ffb3a1"
      : "#a9f1c4"
    : breakdown.presentation.color;

  return (
    <View style={styles.badgeRow}>
      <View style={[styles.badgeTrack, dark && styles.darkTrack]}>
        <View
          style={[
            styles.fill,
            { width: `${breakdown.presentation.fillPercent}%`, backgroundColor: fillColor },
          ]}
        />
      </View>
      <Text numberOfLines={1} style={[styles.badgeText, { color }]}>
        {breakdown.over ? `${breakdown.leftLabel} over budget` : `${breakdown.leftLabel} left`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  meterRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 8,
  },
  meterUsed: {
    color: "#11201d",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  meterCaption: {
    color: "#8b9692",
    fontSize: 12.5,
    fontWeight: "700",
  },
  meterLeft: {
    flex: 1,
    textAlign: "right",
    fontSize: 12.5,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  track: {
    height: 9,
    borderRadius: 999,
    backgroundColor: "#eceeed",
    overflow: "hidden",
  },
  darkTrack: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  panelTitle: {
    flexShrink: 1,
    color: "#11201d",
    fontSize: 13,
    fontWeight: "900",
  },
  panelChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  panelChipText: {
    fontSize: 11,
    fontWeight: "900",
  },
  panelStatsRow: {
    flexDirection: "row",
    marginTop: 11,
    marginBottom: 2,
  },
  panelStat: {
    flex: 1,
    gap: 2,
  },
  panelStatDivider: {
    width: 1,
    marginHorizontal: 12,
    backgroundColor: "#e2e7e8",
  },
  panelStatLabel: {
    color: "#8b9692",
    fontSize: 11,
    fontWeight: "800",
  },
  panelStatValue: {
    color: "#11201d",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  panelStatCaption: {
    color: "#aeb7b3",
    fontSize: 10.5,
    fontWeight: "700",
  },
  panelFootnote: {
    color: "#8b9692",
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 8,
  },
  tankTrack: {
    flexDirection: "row",
    gap: 3,
    marginTop: 8,
  },
  tankSegment: {
    flex: 1,
    borderRadius: 3,
  },
  tankSegmentOff: {
    backgroundColor: "#e6eae9",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 8,
  },
  badgeTrack: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#e5e9e8",
    overflow: "hidden",
  },
  badgeText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
  },
});
