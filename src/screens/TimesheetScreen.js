import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { buildTimesheetDays } from "../lib/timeTracking";

const COLORS = {
  navy: "#0f2a3d",
  green: "#173f37",
  teal: "#2f8d7f",
  tealSoft: "#e6f3f0",
  tealInk: "#1e6b60",
  white: "#ffffff",
  bg: "#f4f6f7",
  surface: "#ffffff",
  border: "#e2e6e8",
  divider: "#eef1f2",
  muted: "#6b7a7e",
  ink: "#10222b",
  inkSoft: "#3c4c54",
  red: "#d24a4a",
  redInk: "#a83838",
  redBg: "#fdecec",
  amber: "#e0a000",
};

const PAY_PERIODS = buildPayPeriods();

function startOfWeek(date) {
  const result = new Date(date);
  const diff = (result.getDay() + 6) % 7;
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() - diff);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatPeriodPart(date) {
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

function formatDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildPayPeriods(referenceDate = new Date()) {
  const currentStart = startOfWeek(referenceDate);
  return [0, 1, 2].map((offset) => {
    const start = addDays(currentStart, -offset * 7);
    const end = addDays(start, 6);
    return {
      id: formatDayKey(start),
      label: `${formatPeriodPart(start)} - ${formatPeriodPart(end)}`,
      start,
      end,
    };
  });
}

function buildEmptyDaysForPeriod(period) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const days = [];

  for (let date = new Date(period.end); date >= period.start; date = addDays(date, -1)) {
    if (date > today) continue;
    days.push({
      id: formatDayKey(date),
      weekday: date.toLocaleDateString([], { weekday: "short" }),
      date: date.toLocaleDateString([], { month: "short", day: "2-digit" }),
      type: "missing",
    });
  }

  return days;
}

function isDayInPeriod(day, period) {
  const date = new Date(`${day.id}T12:00:00`);
  return date >= period.start && date <= period.end;
}

function initialsForName(name) {
  return String(name || "Painter")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "P";
}

export default function TimesheetScreen({
  entries = [],
  activeShift,
  projects = [],
  painterName = "Painter",
  onDeleteTimeEntry,
  onUpdateTimeEntry,
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [periodId, setPeriodId] = useState(PAY_PERIODS[0].id);
  const [selectedDayId, setSelectedDayId] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);

  const trackedDays = useMemo(() => buildTimesheetDays(entries, activeShift), [entries, activeShift]);
  const period = PAY_PERIODS.find((p) => p.id === periodId) || PAY_PERIODS[0];
  const periodTrackedDays = useMemo(
    () => trackedDays.filter((day) => isDayInPeriod(day, period)),
    [period, trackedDays],
  );
  const emptyDays = useMemo(() => buildEmptyDaysForPeriod(period), [period]);
  const sourceDays = periodTrackedDays.length ? periodTrackedDays : emptyDays;
  const weekTotalMin = sourceDays.reduce((sum, day) => sum + (day.totalMinutes || 0), 0);
  const weekTotal = `${Math.floor(weekTotalMin / 60)}h ${weekTotalMin % 60}m`;
  const daysWorked = sourceDays.filter((day) => day.type === "worked").length;
  const painterInitials = initialsForName(painterName);
  const selectedDay = selectedDayId
    ? sourceDays.find((d) => d.id === selectedDayId) || null
    : null;

  if (selectedEntry && selectedDay) {
    return (
      <EditTimeScreen
        day={selectedDay}
        entry={selectedEntry}
        projects={projects}
        painterName={painterName}
        onSave={async (entryToSave, updates) => {
          await onUpdateTimeEntry?.(entryToSave.raw || entryToSave, updates);
          setSelectedEntry(null);
          setSelectedDayId(null);
        }}
        onDelete={async (entryToDelete) => {
          await onDeleteTimeEntry?.(entryToDelete.raw || entryToDelete);
          setSelectedEntry(null);
          setSelectedDayId(null);
        }}
        onBack={() => setSelectedEntry(null)}
      />
    );
  }

  if (selectedDay) {
    return (
      <DayDetailScreen
        day={selectedDay}
        onBack={() => setSelectedDayId(null)}
        onEntryPress={setSelectedEntry}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <Pressable style={styles.topBar} onPress={() => setSheetOpen(true)}>
        <Text style={styles.topBarLabel}>{period.label}</Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.ink} />
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <WeekSummaryCard
          weekTotal={weekTotal}
          daysWorked={daysWorked}
          painterName={painterName}
          painterInitials={painterInitials}
        />

        <Text style={styles.sectionHeader}>This Week</Text>

        <View style={styles.timeline}>
          <View style={styles.timelineLine} />
          {sourceDays.map((day, idx) => (
            <DayRow
              key={day.id}
              day={day}
              last={idx === sourceDays.length - 1}
              onPress={() => {
                if (day.type === "worked") setSelectedDayId(day.id);
              }}
            />
          ))}
        </View>
      </ScrollView>

      <PayPeriodSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        periodId={periodId}
        onSelect={(id) => {
          setPeriodId(id);
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

function WeekSummaryCard({ weekTotal = "0h 0m", daysWorked = 0, painterName, painterInitials }) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHead}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{painterInitials}</Text>
        </View>
        <View style={styles.summaryHeadText}>
          <Text style={styles.summaryName}>{painterName}</Text>
          <Text style={styles.summarySubtitle}>Painter · Weekly Summary</Text>
        </View>
      </View>

      <View style={styles.summaryStats}>
        <View style={styles.summaryStat}>
          <Text style={styles.summaryStatValue}>{weekTotal}</Text>
          <Text style={styles.summaryStatLabel}>Logged</Text>
        </View>
        <View style={styles.summaryStatDivider} />
        <View style={styles.summaryStat}>
          <Text style={styles.summaryStatValue}>{daysWorked}</Text>
          <Text style={styles.summaryStatLabel}>Days</Text>
        </View>
        <View style={styles.summaryStatDivider} />
        <View style={styles.summaryStat}>
          <Text style={styles.summaryStatValue}>$0.00</Text>
          <Text style={styles.summaryStatLabel}>Earned</Text>
        </View>
      </View>
    </View>
  );
}

function DayRow({ day, last, onPress }) {
  const missing = day.type === "missing";
  return (
    <View style={[styles.dayRow, last && styles.dayRowLast]}>
      <View style={styles.dayDateCol}>
        <Text style={styles.dayWeekday}>{day.weekday}</Text>
        <Text style={styles.dayDate}>{day.date}</Text>
      </View>

      <View style={styles.dayMarkerCol}>
        <View
          style={[
            styles.dayMarker,
            missing ? styles.dayMarkerMissing : styles.dayMarkerActive,
          ]}
        >
          {missing ? (
            <Ionicons name="alert" size={11} color={COLORS.white} />
          ) : (
            <Ionicons name="checkmark" size={12} color={COLORS.white} />
          )}
        </View>
      </View>

      <View style={styles.dayCardWrap}>
        {missing ? <MissingCard /> : <WorkedCard day={day} onPress={onPress} />}
      </View>
    </View>
  );
}

function WorkedCard({ day, onPress }) {
  return (
    <Pressable style={styles.workedCard} onPress={onPress}>
      <View style={styles.workedTopRow}>
        <Text style={styles.workedTotal}>{day.total}</Text>
        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
      </View>

      <View style={styles.jobList}>
        {day.jobs.map((job) => (
          <View key={job} style={styles.jobPill}>
            <Ionicons name="briefcase" size={11} color={COLORS.tealInk} />
            <Text style={styles.jobName} numberOfLines={1}>
              {job}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.workedMetaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="location-sharp" size={13} color={COLORS.teal} />
          <Text style={styles.metaText}>
            On site <Text style={styles.metaStrong}>{day.onSite}</Text>
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="car-sport" size={14} color={COLORS.muted} />
          <Text style={styles.metaText}>
            Drive <Text style={styles.metaStrong}>{day.drive}</Text>
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function MissingCard() {
  return (
    <View style={styles.missingCard}>
      <View style={styles.missingHead}>
        <Ionicons name="close-circle" size={16} color={COLORS.red} />
        <Text style={styles.missingTitle}>No clock-in</Text>
      </View>
      <Text style={styles.missingHint}>Tap to add reason</Text>
    </View>
  );
}

function formatDayFull(day) {
  return `${day.date.replace(" 0", " ")}, 2026`;
}

function DayDetailScreen({ day, onBack, onEntryPress }) {
  return (
    <View style={styles.screen}>
      <View style={styles.detailHeader}>
        <Pressable hitSlop={10} style={styles.iconBackBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={28} color={COLORS.ink} />
        </Pressable>
        <View style={styles.detailHeaderText}>
          <Text style={styles.detailTitle}>
            {day.weekday}, {formatDayFull(day)}
          </Text>
          <Text style={styles.detailSub}>{day.total} logged</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.detailContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.detailSummary}>
          <Text style={styles.detailKicker}>TOTAL TIME</Text>
          <Text style={styles.detailTotal}>{day.total}</Text>

          <View style={styles.detailChipRow}>
            <View style={styles.detailChip}>
              <Ionicons name="location-sharp" size={14} color={COLORS.teal} />
              <Text style={styles.detailChipText}>{day.onSite} on site</Text>
            </View>
            <View style={[styles.detailChip, styles.detailChipDrive]}>
              <Ionicons name="car-sport" size={15} color={COLORS.inkSoft} />
              <Text style={[styles.detailChipText, styles.detailChipTextDrive]}>
                {day.drive} drive
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionHeaderInline}>Clock-ins</Text>
          <Text style={styles.sectionCount}>{day.entries.length}</Text>
        </View>

        {day.entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            onPress={() => onEntryPress(entry)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function EntryCard({ entry, onPress }) {
  const onSite = entry.status === "On Site";
  const mixed = entry.status === "Mixed";
  return (
    <Pressable style={styles.entryCard} onPress={onPress}>
      <View style={styles.entryTopRow}>
        <View
          style={[
            styles.entryIcon,
            { backgroundColor: onSite || mixed ? COLORS.teal : COLORS.inkSoft },
          ]}
        >
          <Ionicons
            name={mixed ? "swap-horizontal" : onSite ? "hammer" : "car-sport"}
            size={16}
            color={COLORS.white}
          />
        </View>
        <View style={styles.entryTitleWrap}>
          <Text style={styles.entryJob} numberOfLines={1}>
            {entry.job}
          </Text>
          <Text style={styles.entryAddress} numberOfLines={1}>
            {entry.address}
          </Text>
        </View>
        <Text style={styles.entryDuration}>{entry.duration}</Text>
      </View>

      <View style={styles.entryDivider} />

      <View style={styles.entryTimes}>
        <View style={styles.entryTimeCol}>
          <Text style={styles.entryTimeLabel}>IN</Text>
          <Text style={styles.entryTimeValue}>{entry.start}</Text>
          <Text style={styles.entryTimeSrc}>{entry.startSrc}</Text>
        </View>
        <View style={styles.entryArrow}>
          <Ionicons name="arrow-forward" size={16} color={COLORS.muted} />
        </View>
        <View style={styles.entryTimeCol}>
          <Text style={styles.entryTimeLabel}>OUT</Text>
          <Text style={styles.entryTimeValue}>{entry.end}</Text>
          <Text style={styles.entryTimeSrc}>{entry.endSrc}</Text>
        </View>
        <View style={styles.entryChevron}>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </View>
      </View>

      <View
        style={[
          styles.statusPill,
          onSite || mixed ? styles.statusPillOn : styles.statusPillOff,
        ]}
      >
        <View
          style={[
            styles.statusDot,
            { backgroundColor: onSite || mixed ? COLORS.teal : COLORS.red },
          ]}
        />
        <Text
          style={[
            styles.statusText,
            { color: onSite || mixed ? COLORS.tealInk : COLORS.redInk },
          ]}
        >
          {entry.status} · {entry.distance}
        </Text>
      </View>
      {mixed ? (
        <View style={styles.entryBreakdownRow}>
          <Text style={styles.entryBreakdownText}>On site {entry.onSiteDuration}</Text>
          <Text style={styles.entryBreakdownDivider}>·</Text>
          <Text style={styles.entryBreakdownText}>Travel/off site {entry.offSiteDuration}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function EditTimeScreen({ day, entry, projects = [], painterName, onSave, onDelete, onBack }) {
  const onSite = entry.status === "On Site";
  const rawEntry = entry.raw || entry;
  const initialStart = new Date(rawEntry.startedAt || Date.now());
  const initialEnd = new Date(rawEntry.endedAt || rawEntry.startedAt || Date.now());
  const [startAt, setStartAt] = useState(initialStart);
  const [endAt, setEndAt] = useState(initialEnd);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);
  const startChanged = startAt.getTime() !== initialStart.getTime();
  const endChanged = endAt.getTime() !== initialEnd.getTime();
  const projectChanged = !!selectedProject;
  const canSave = (startChanged || endChanged || projectChanged) && endAt.getTime() > startAt.getTime();
  const durationMs = Math.max(0, endAt.getTime() - startAt.getTime());
  const adjustedStart = formatTime(startAt);
  const adjustedEnd = formatTime(endAt);
  const adjustedDuration = formatDurationLabel(durationMs);
  const displayedJob = selectedProject?.name || entry.job;
  const displayedAddress = selectedProject ? formatProjectAddress(selectedProject) : entry.address;
  const projectOptions = useMemo(
    () => filterProjectOptions(projects, projectSearch),
    [projectSearch, projects],
  );

  return (
    <View style={styles.editScreen}>
      <View style={styles.editHeader}>
        <Pressable hitSlop={10} style={styles.iconBackBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={28} color={COLORS.ink} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.editContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.editTitle}>Edit Time</Text>
        <Text style={styles.editSubtitle}>Adjust this clock-in entry</Text>

        <View style={styles.editShiftCard}>
          <View style={styles.editShiftRow}>
            <View style={styles.editShiftText}>
              <Text style={styles.editShiftPainter}>{painterName}</Text>
              <View style={styles.editShiftJobRow}>
                <Ionicons name="briefcase" size={14} color={COLORS.teal} />
                <Text style={styles.editShiftJob} numberOfLines={1}>
                  {displayedJob}
                </Text>
              </View>
              <Text style={styles.editShiftAddress} numberOfLines={1}>
                {displayedAddress}
              </Text>
            </View>

            <View style={styles.editMapTile}>
              <Ionicons
                name="location-sharp"
                size={22}
                color={onSite ? COLORS.teal : COLORS.red}
              />
              <Text style={styles.editMapDistance}>{entry.distance}</Text>
            </View>
          </View>

          <View
            style={[
              styles.editShiftStatus,
              onSite ? styles.editShiftStatusOn : styles.editShiftStatusOff,
            ]}
          >
            <Ionicons
              name={onSite ? "checkmark-circle" : "alert-circle"}
              size={15}
              color={onSite ? COLORS.tealInk : COLORS.redInk}
            />
            <Text
              style={[
                styles.editShiftStatusText,
                { color: onSite ? COLORS.tealInk : COLORS.redInk },
              ]}
            >
              {onSite ? "On site during clock-in" : "Off site during clock-in"}
            </Text>
          </View>
        </View>

        <View style={styles.editFormCard}>
          <FormRow label="Date" value={formatDayFull(day)} />
          <View style={styles.formDivider} />
          <FormRow label="Clock-In Time" value={`${adjustedStart} · ${entry.startSrc}`} />
          <TimeAdjustRow
            onMinus={() => setStartAt((value) => addMinutes(value, -15))}
            onPlus={() => setStartAt((value) => addMinutes(value, 15))}
          />
          <View style={styles.formDivider} />
          <FormRow label="Clock-Out Time" value={`${adjustedEnd} · ${entry.endSrc}`} />
          <TimeAdjustRow
            onMinus={() => setEndAt((value) => addMinutes(value, -15))}
            onPlus={() => setEndAt((value) => addMinutes(value, 15))}
          />
          <View style={styles.formDivider} />
          <FormRow label="Duration" value={adjustedDuration} muted />
        </View>

        <Pressable
          style={styles.editActionRow}
          onPress={() => setProjectPickerOpen((open) => !open)}
        >
          <View style={styles.editActionLeft}>
            <View style={styles.editActionIcon}>
              <Ionicons name="swap-horizontal" size={17} color={COLORS.teal} />
            </View>
            <Text style={styles.editActionText}>
              {selectedProject ? `Project: ${selectedProject.name}` : "Change Project"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </Pressable>

        {projectPickerOpen ? (
          <View style={styles.projectPicker}>
            <TextInput
              style={styles.projectPickerInput}
              value={projectSearch}
              onChangeText={setProjectSearch}
              placeholder="Search projects"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {projectOptions.map((project) => (
              <Pressable
                key={project.companycam_id}
                style={styles.projectPickerOption}
                onPress={() => {
                  setSelectedProject(project);
                  setProjectPickerOpen(false);
                  setProjectSearch("");
                }}
              >
                <Text style={styles.projectPickerName} numberOfLines={1}>
                  {project.name}
                </Text>
                <Text style={styles.projectPickerAddress} numberOfLines={1}>
                  {formatProjectAddress(project) || "No address on file"}
                </Text>
              </Pressable>
            ))}
            {!projectOptions.length ? (
              <Text style={styles.projectPickerEmpty}>No matching projects.</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.editFooter}>
        <Pressable
          style={[styles.editSaveBtn, !canSave && styles.editSaveBtnDisabled]}
          disabled={!canSave}
          onPress={() =>
            onSave?.(entry, {
              startedAt: startAt.toISOString(),
              endedAt: endAt.toISOString(),
              project: selectedProject || undefined,
            })
          }
        >
          <Text style={styles.editSaveText}>Save Changes</Text>
        </Pressable>
        <View style={styles.editFooterRow}>
          <Pressable style={styles.editCancelBtn} onPress={onBack}>
            <Text style={styles.editCancelText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.editDeleteBtn} onPress={() => onDelete?.(entry)}>
            <Ionicons name="trash-outline" size={16} color={COLORS.red} />
            <Text style={styles.editDeleteText}>Delete</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function TimeAdjustRow({ onMinus, onPlus }) {
  return (
    <View style={styles.timeAdjustRow}>
      <Pressable style={styles.timeAdjustButton} onPress={onMinus}>
        <Text style={styles.timeAdjustText}>-15m</Text>
      </Pressable>
      <Pressable style={styles.timeAdjustButton} onPress={onPlus}>
        <Text style={styles.timeAdjustText}>+15m</Text>
      </Pressable>
    </View>
  );
}

function FormRow({ label, value, muted }) {
  return (
    <View style={styles.formRow}>
      <Text style={styles.formLabel}>{label}</Text>
      <Text style={[styles.formValue, muted && styles.formValueMuted]}>
        {value}
      </Text>
    </View>
  );
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDurationLabel(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatProjectAddress(project) {
  return (
    project?.formatted_address ||
    [project?.street_address_1, project?.city, project?.state, project?.postal_code]
      .filter(Boolean)
      .join(", ")
  );
}

function filterProjectOptions(projects, query) {
  const normalized = String(query || "").trim().toLowerCase();
  return (projects || [])
    .filter((project) => {
      if (!project || project.is_archived || project.is_lead) return false;
      if (!normalized) return true;
      return [project.name, formatProjectAddress(project), project.city, project.postal_code]
        .some((value) => String(value || "").toLowerCase().includes(normalized));
    })
    .slice(0, 6);
}

function PayPeriodSheet({ visible, onClose, periodId, onSelect }) {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, progress]);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.sheetBackdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Select Pay Period</Text>

          {PAY_PERIODS.map((p) => {
            const selected = p.id === periodId;
            return (
              <Pressable
                key={p.id}
                style={[styles.sheetRow, selected && styles.sheetRowActive]}
                onPress={() => onSelect(p.id)}
              >
                <Text
                  style={[
                    styles.sheetRowText,
                    selected && styles.sheetRowTextActive,
                  ]}
                >
                  {p.label}
                </Text>
                {selected ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={COLORS.teal}
                  />
                ) : (
                  <View style={styles.radioEmpty} />
                )}
              </Pressable>
            );
          })}

          <View style={styles.sheetBottomSafe} />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 36,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: COLORS.bg,
  },
  topBarLabel: {
    color: COLORS.ink,
    fontSize: 15.5,
    fontWeight: "700",
  },
  iconBackBtn: {
    width: 38,
    height: 38,
    alignItems: "flex-start",
    justifyContent: "center",
  },

  // --- Week summary ---
  summaryCard: {
    marginHorizontal: 16,
    marginTop: 2,
    borderRadius: 16,
    backgroundColor: COLORS.green,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  summaryHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  summaryHeadText: {
    flex: 1,
    minWidth: 0,
  },
  summaryName: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "800",
  },
  summarySubtitle: {
    marginTop: 2,
    color: "#a8c7c0",
    fontSize: 12,
    fontWeight: "600",
  },
  summaryStats: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    paddingVertical: 12,
  },
  summaryStat: {
    flex: 1,
    alignItems: "center",
  },
  summaryStatDivider: {
    width: 1,
    height: 26,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  summaryStatValue: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  summaryStatLabel: {
    marginTop: 3,
    color: "#a8c7c0",
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },

  // --- Section headers ---
  sectionHeader: {
    marginTop: 22,
    marginBottom: 10,
    marginHorizontal: 16,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionRow: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionHeaderInline: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionCount: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
  },

  // --- Timeline ---
  timeline: {
    paddingHorizontal: 16,
    position: "relative",
  },
  timelineLine: {
    position: "absolute",
    top: 26,
    bottom: 30,
    left: 16 + 56 + 12,
    width: 2,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "stretch",
    marginBottom: 12,
  },
  dayRowLast: {
    marginBottom: 0,
  },
  dayDateCol: {
    width: 56,
    justifyContent: "center",
  },
  dayWeekday: {
    color: COLORS.ink,
    fontSize: 13.5,
    fontWeight: "800",
  },
  dayDate: {
    marginTop: 2,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  dayMarkerCol: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 18,
  },
  dayMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: COLORS.bg,
    zIndex: 2,
  },
  dayMarkerActive: {
    backgroundColor: COLORS.teal,
  },
  dayMarkerMissing: {
    backgroundColor: COLORS.red,
  },
  dayCardWrap: {
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
  },

  // --- Worked card ---
  workedCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  workedTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  workedTotal: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  jobList: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  jobPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: COLORS.tealSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: "100%",
  },
  jobName: {
    color: COLORS.tealInk,
    fontSize: 11.5,
    fontWeight: "800",
  },
  workedMetaRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  metaStrong: {
    color: COLORS.ink,
    fontWeight: "800",
  },

  // --- Missing card ---
  missingCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f3c8c8",
    backgroundColor: COLORS.redBg,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  missingHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  missingTitle: {
    color: COLORS.redInk,
    fontSize: 14,
    fontWeight: "800",
  },
  missingHint: {
    marginTop: 4,
    color: COLORS.red,
    fontSize: 12.5,
    fontWeight: "600",
  },

  // --- Day detail ---
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: COLORS.bg,
  },
  detailHeaderText: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 4,
  },
  detailTitle: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  detailSub: {
    marginTop: 2,
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  detailContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 40,
  },
  detailSummary: {
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  detailKicker: {
    color: COLORS.teal,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  detailTotal: {
    marginTop: 4,
    color: COLORS.ink,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  detailChipRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  detailChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.tealSoft,
  },
  detailChipDrive: {
    backgroundColor: "#eef1f3",
  },
  detailChipText: {
    color: COLORS.tealInk,
    fontSize: 12.5,
    fontWeight: "800",
  },
  detailChipTextDrive: {
    color: COLORS.inkSoft,
  },

  // --- Entry card ---
  entryCard: {
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  entryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  entryIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  entryTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  entryJob: {
    color: COLORS.ink,
    fontSize: 14.5,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  entryAddress: {
    marginTop: 1,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  entryDuration: {
    color: COLORS.ink,
    fontSize: 14.5,
    fontWeight: "900",
  },
  entryDivider: {
    marginTop: 11,
    marginBottom: 11,
    height: 1,
    backgroundColor: COLORS.divider,
  },
  entryTimes: {
    flexDirection: "row",
    alignItems: "center",
  },
  entryTimeCol: {
    flex: 1,
  },
  entryTimeLabel: {
    color: COLORS.muted,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  entryTimeValue: {
    marginTop: 2,
    color: COLORS.ink,
    fontSize: 14.5,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  entryTimeSrc: {
    marginTop: 1,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  entryArrow: {
    paddingHorizontal: 8,
  },
  entryChevron: {
    paddingLeft: 8,
  },
  statusPill: {
    marginTop: 11,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusPillOn: {
    backgroundColor: COLORS.tealSoft,
  },
  statusPillOff: {
    backgroundColor: COLORS.redBg,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11.5,
    fontWeight: "800",
  },

  // --- Edit time screen ---
  editScreen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  editHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  editContent: {
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 220,
  },
  editTitle: {
    color: COLORS.ink,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -1,
  },
  editSubtitle: {
    marginTop: 4,
    color: COLORS.muted,
    fontSize: 13.5,
    fontWeight: "600",
  },
  editShiftCard: {
    marginTop: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    padding: 14,
  },
  editShiftRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  editShiftText: {
    flex: 1,
    minWidth: 0,
  },
  editShiftPainter: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "900",
  },
  editShiftJobRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  editShiftJob: {
    flex: 1,
    color: COLORS.tealInk,
    fontSize: 14,
    fontWeight: "800",
  },
  editShiftAddress: {
    marginTop: 4,
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: "600",
  },
  editMapTile: {
    width: 86,
    height: 80,
    borderRadius: 10,
    backgroundColor: COLORS.tealSoft,
    borderWidth: 1,
    borderColor: "#d5e7e2",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    gap: 4,
  },
  editMapDistance: {
    color: COLORS.tealInk,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  editShiftStatus: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  editShiftStatusOn: {
    backgroundColor: COLORS.tealSoft,
  },
  editShiftStatusOff: {
    backgroundColor: COLORS.redBg,
  },
  editShiftStatusText: {
    fontSize: 12,
    fontWeight: "800",
  },
  editFormCard: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
  },
  formRow: {
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  formLabel: {
    color: COLORS.muted,
    fontSize: 13.5,
    fontWeight: "700",
  },
  formValue: {
    color: COLORS.ink,
    fontSize: 14.5,
    fontWeight: "800",
    textAlign: "right",
    flexShrink: 1,
  },
  formValueMuted: {
    color: COLORS.muted,
    fontWeight: "700",
  },
  formDivider: {
    height: 1,
    backgroundColor: COLORS.divider,
  },
  editActionRow: {
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editActionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  editActionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  editActionText: {
    color: COLORS.ink,
    fontSize: 14.5,
    fontWeight: "800",
  },
  editFooter: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
  },
  editSaveBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: COLORS.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  editSaveBtnDisabled: {
    backgroundColor: "#d7dcde",
  },
  editSaveText: {
    color: "#f8f9f9",
    fontSize: 15.5,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  editFooterRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
  },
  editCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  editCancelText: {
    color: COLORS.inkSoft,
    fontSize: 14.5,
    fontWeight: "800",
  },
  editDeleteBtn: {
    flex: 1,
    height: 46,
    flexDirection: "row",
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f3c8c8",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.redBg,
  },
  editDeleteText: {
    color: COLORS.red,
    fontSize: 14.5,
    fontWeight: "800",
  },
  timeAdjustRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    paddingHorizontal: 2,
    paddingBottom: 10,
  },
  timeAdjustButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
  },
  timeAdjustText: {
    color: COLORS.tealInk,
    fontSize: 12,
    fontWeight: "800",
  },
  projectPicker: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    overflow: "hidden",
  },
  projectPickerInput: {
    minHeight: 44,
    paddingHorizontal: 14,
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: "700",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  projectPickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  projectPickerName: {
    color: COLORS.ink,
    fontSize: 13.5,
    fontWeight: "800",
  },
  projectPickerAddress: {
    marginTop: 2,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  projectPickerEmpty: {
    padding: 14,
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  entryBreakdownRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  entryBreakdownText: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "700",
  },
  entryBreakdownDivider: {
    color: COLORS.border,
    fontSize: 12,
    fontWeight: "900",
  },

  // --- Pay period sheet ---
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,30,28,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d5dadc",
    marginBottom: 12,
  },
  sheetTitle: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 6,
  },
  sheetRowActive: {
    backgroundColor: COLORS.tealSoft,
  },
  sheetRowText: {
    color: COLORS.ink,
    fontSize: 14.5,
    fontWeight: "700",
  },
  sheetRowTextActive: {
    color: COLORS.tealInk,
    fontWeight: "800",
  },
  radioEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  sheetBottomSafe: {
    height: 28,
  },
});
