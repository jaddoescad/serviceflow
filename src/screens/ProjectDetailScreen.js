import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BudgetHoursPanel } from '../components/BudgetProgress';
import {
  getBudgetProgressPresentation,
  useProjectBudgetProgress,
} from '../lib/projectBudget';
import { supabase } from '../lib/supabase';
import { buildPainterClockInSummaries } from '../lib/projectClockInSummary';
import { buildProjectClockInDays } from '../lib/timeTracking';
import ProjectLabourTasksPanel from '../components/ProjectLabourTasksPanel';
import OverBudgetReasonSheet from '../components/OverBudgetReasonSheet';
import { useProjectLabourTasks } from '../lib/useProjectLabourTasks';
import {
  evaluateJobOverBudget,
  hasAnsweredJobOverBudgetReason,
  markJobOverBudgetReasonAnswered,
  submitJobOverBudgetReason,
} from '../lib/jobOverBudget';

const BRAND = '#2b8496';
const NAVY = '#31495d';
const INK = '#1f2933';
const TEXT = '#2f3136';
const MUTED = '#8a8f95';
const SUBTLE = '#b8bcc1';
const BORDER = '#e6e8eb';
const SOFT = '#f6f8f9';
const TILE_BG = '#ffffff';
const EDIT_TIME_STEP_MINUTES = 5;

function firstValue(values, fallback = '') {
  return (
    values.find(
      (value) => value !== undefined && value !== null && String(value).trim() !== '',
    ) ?? fallback
  );
}

function formatDate(value) {
  if (!value) return 'Added recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Added recently';
  return `Added ${date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

function formatHours(value, fallback = '0.0h') {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return `${number.toFixed(1)}h`;
}

function formatMsAsHours(ms) {
  const hours = Math.max(0, ms || 0) / 3600000;
  return `${hours.toFixed(1)}h`;
}

function toNumericHours(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getProjectTitle(project) {
  return firstValue(
    [
      project?.name,
      project?.project_name,
      project?.customer_name,
      project?.client_name,
      project?.contact_name,
    ],
    'Project',
  );
}

function getProjectAddress(project) {
  const fullAddress = firstValue([
    project?.address,
    project?.full_address,
    project?.formatted_address,
    project?.location?.address,
  ]);
  if (fullAddress) return fullAddress;

  const parts = [
    project?.street_address,
    project?.address_line_1,
    project?.city,
    project?.province,
    project?.state,
    project?.postal_code,
    project?.zip,
  ].filter(Boolean);

  return parts.length ? parts.join(', ') : 'No address on file';
}

function getInitials(title) {
  const words = String(title).trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]).join('').toUpperCase() || 'P';
}

function getCompanyCamProjectId(project) {
  return firstValue(
    [
      project?.companycam_id,
      project?.companycamId,
      project?.company_cam_id,
      project?.companycam_project_id,
      project?.project_id,
    ],
    null,
  );
}

function isSameCompanyCamProject(a, b) {
  const aId = getCompanyCamProjectId(a);
  const bId = getCompanyCamProjectId(b);
  return Boolean(aId && bId && String(aId) === String(bId));
}

function getEntryDurationMs(entry, nowMs = Date.now()) {
  const isActive = entry?.clockOutReason === 'active' || !entry?.endedAt;
  if (isActive) {
    const start = new Date(entry?.startedAt).getTime();
    return Number.isFinite(start) ? Math.max(0, nowMs - start) : 0;
  }

  const duration = Number(entry?.durationMs);
  if (Number.isFinite(duration)) return Math.max(0, duration);

  const start = new Date(entry?.startedAt).getTime();
  const end = new Date(entry?.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function getProjectEntryTotals(entries, project, user, nowMs = Date.now()) {
  const projectId = getCompanyCamProjectId(project);
  const userId = user?.id || null;
  const userEmail = user?.email || null;
  const seen = new Set();

  return (entries || []).reduce(
    (totals, entry) => {
      const key = entry?.serverId || entry?.id || entry?.localId;
      if (key) {
        if (seen.has(key)) return totals;
        seen.add(key);
      }

      if (!projectId || String(getCompanyCamProjectId(entry?.project)) !== String(projectId)) {
        return totals;
      }

      const durationMs = getEntryDurationMs(entry, nowMs);
      totals.teamMs += durationMs;

      if (
        (userId && entry?.userId === userId) ||
        (userEmail && entry?.userEmail === userEmail)
      ) {
        totals.yourMs += durationMs;
      }

      return totals;
    },
    { teamMs: 0, yourMs: 0 },
  );
}

function formatPhotoDate(value) {
  if (!value) return 'CompanyCam';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'CompanyCam';

  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  });
}

function PinGlyph({ color = BRAND }) {
  return <Ionicons name="location" size={16} color={color} />;
}

function ClockGlyph({ color = '#fff', size = 16 }) {
  return <Ionicons name="time" size={size} color={color} />;
}

function CameraGlyph({ color = BRAND }) {
  return <Ionicons name="images" size={18} color={color} />;
}

function PlayGlyph() {
  return <Ionicons name="play" size={23} color="#fff" />;
}

function formatMinutesLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatElapsedClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function StatusPill({ status, distanceLabel }) {
  const presentation = getLocationStatusPresentation(status);
  return (
    <View
      style={[
        styles.segStatusPill,
        { backgroundColor: presentation.backgroundColor },
      ]}
    >
      <View
        style={[
          styles.segStatusDot,
          { backgroundColor: presentation.color },
        ]}
      />
      <Text
        style={[
          styles.segStatusText,
          { color: presentation.color },
        ]}
      >
        {presentation.label}
      </Text>
      {distanceLabel ? (
        <>
          <Text
            style={[
              styles.segStatusText,
              styles.segStatusDistanceDivider,
              { color: presentation.color },
            ]}
          >
            -
          </Text>
          <Text
            style={[
              styles.segStatusText,
              { color: presentation.color },
            ]}
          >
            {distanceLabel}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function getLocationStatusPresentation(status) {
  if (status === 'on') {
    return { label: 'On Site', color: BRAND, backgroundColor: '#e6f2f4' };
  }
  if (status === 'off') {
    return { label: 'Off Site', color: '#c0432b', backgroundColor: '#fbecea' };
  }
  if (status === 'mixed') {
    return { label: 'Mixed location', color: '#9a611f', backgroundColor: '#fff3df' };
  }
  return { label: 'Location unavailable', color: '#6f7774', backgroundColor: '#eef1ef' };
}

function getPainterClockInMeta(painter) {
  const parts = [
    `${painter.clockInCount} ${painter.clockInCount === 1 ? 'clock-in' : 'clock-ins'}`,
  ];
  if (painter.onSiteCount > 0) parts.push(`${painter.onSiteCount} on site`);
  if (painter.offSiteCount > 0) parts.push(`${painter.offSiteCount} off site`);
  if (painter.mixedCount > 0) parts.push(`${painter.mixedCount} mixed`);
  if (painter.unknownLocationCount > 0) {
    parts.push(`${painter.unknownLocationCount} location unavailable`);
  }
  return parts.join(' · ');
}

function getLocationBreakdownLabel(clockIn) {
  const breakdown = clockIn?.locationBreakdown;
  if (!breakdown) return null;
  const parts = [];
  if (breakdown.onSiteMs > 0) {
    parts.push(`${formatMinutesLabel(Math.floor(breakdown.onSiteMs / 60000))} on site`);
  }
  if (breakdown.offSiteMs > 0) {
    parts.push(`${formatMinutesLabel(Math.floor(breakdown.offSiteMs / 60000))} off site`);
  }
  if (breakdown.unknownMs > 0) {
    parts.push(`${formatMinutesLabel(Math.floor(breakdown.unknownMs / 60000))} location unavailable`);
  }
  return parts.length > 1 ? `GPS breakdown · ${parts.join(' · ')}` : null;
}

function PainterSummaryRow({ painter, onPress }) {
  return (
    <TouchableOpacity
      style={styles.painterSummaryCard}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={[styles.painterAvatar, painter.isYou && styles.painterAvatarYou]}>
        <Text
          style={[
            styles.painterAvatarText,
            painter.isYou && styles.painterAvatarTextYou,
          ]}
        >
          {painter.initials}
        </Text>
      </View>
      <View style={styles.painterSummaryBody}>
        <View style={styles.painterSummaryTopRow}>
          <View style={styles.painterNameWrap}>
            <Text style={styles.painterName} numberOfLines={1}>
              {painter.name}
            </Text>
            {painter.isYou ? <Text style={styles.painterYouTag}>You</Text> : null}
          </View>
          <Text style={styles.painterTotal}>
            {formatMinutesLabel(painter.totalMinutes)}
          </Text>
        </View>
        <View style={styles.painterSummaryMetaRow}>
          <Text style={styles.painterMetaText}>
            {painter.clockInCount} {painter.clockInCount === 1 ? 'clock-in' : 'clock-ins'}
          </Text>
          {painter.onSiteCount > 0 ? (
            <>
              <View style={styles.painterMetaDivider} />
              <View style={styles.painterStatusInline}>
                <View style={[styles.segStatusDot, { backgroundColor: BRAND }]} />
                <Text style={[styles.painterMetaText, styles.painterMetaOn]}>
                  {painter.onSiteCount} On Site
                </Text>
              </View>
            </>
          ) : null}
          {painter.offSiteCount > 0 ? (
            <>
              <View style={styles.painterMetaDivider} />
              <View style={styles.painterStatusInline}>
                <View style={[styles.segStatusDot, { backgroundColor: '#c0432b' }]} />
                <Text style={[styles.painterMetaText, styles.painterMetaOff]}>
                  {painter.offSiteCount} Off Site
                </Text>
              </View>
            </>
          ) : null}
          {painter.mixedCount > 0 ? (
            <>
              <View style={styles.painterMetaDivider} />
              <Text style={[styles.painterMetaText, styles.painterMetaMixed]}>
                {painter.mixedCount} Mixed
              </Text>
            </>
          ) : null}
          {painter.unknownLocationCount > 0 ? (
            <>
              <View style={styles.painterMetaDivider} />
              <Text style={styles.painterMetaText}>
                {painter.unknownLocationCount} Location unavailable
              </Text>
            </>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={SUBTLE} />
    </TouchableOpacity>
  );
}

function PainterDetailView({ painter, onBack, onSegmentPress }) {
  return (
    <View>
      <TouchableOpacity
        style={styles.detailBackRow}
        activeOpacity={0.7}
        onPress={onBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="chevron-back" size={18} color={BRAND} />
        <Text style={styles.detailBackText}>All painters</Text>
      </TouchableOpacity>

      <View style={styles.detailHeaderCard}>
        <View
          style={[
            styles.painterAvatar,
            styles.detailHeaderAvatar,
            painter.isYou && styles.painterAvatarYou,
          ]}
        >
          <Text
            style={[
              styles.painterAvatarText,
              styles.detailHeaderAvatarText,
              painter.isYou && styles.painterAvatarTextYou,
            ]}
          >
            {painter.initials}
          </Text>
        </View>
        <View style={styles.detailHeaderTextWrap}>
          <Text style={styles.detailHeaderName} numberOfLines={1}>
            {painter.name}
            {painter.isYou ? ' (You)' : ''}
          </Text>
          <Text style={styles.detailHeaderMeta} numberOfLines={1}>
            {getPainterClockInMeta(painter)}
          </Text>
        </View>
        <Text style={styles.detailHeaderTotal}>
          {formatMinutesLabel(painter.totalMinutes)}
        </Text>
      </View>

      {painter.days.map((day) => {
        const dayMinutes = day.clockIns.reduce(
          (acc, clockIn) => acc + clockIn.durationMinutes,
          0,
        );
        return (
          <View key={day.dayId} style={styles.dayGroup}>
            <View style={styles.dayHeader}>
              <View style={styles.dayHeaderLeft}>
                <Text style={styles.dayLabel}>{day.label},</Text>
                <Text style={styles.dayDate}> {day.dateLabel}</Text>
              </View>
              <Text style={styles.dayTotal}>{formatMinutesLabel(dayMinutes)}</Text>
            </View>
            <View style={styles.segmentListCard}>
              {day.clockIns.map((clockIn, index) => {
                const canEdit = painter.isYou;
                const breakdownLabel = getLocationBreakdownLabel(clockIn);
                const RowComponent = canEdit ? TouchableOpacity : View;
                const rowProps = canEdit
                  ? {
                      activeOpacity: 0.78,
                      onPress: () =>
                        onSegmentPress?.({
                          painter,
                          day,
                          segment: clockIn,
                          index,
                        }),
                    }
                  : {};

                return (
                  <RowComponent
                    key={clockIn.id}
                    style={[styles.segmentRow, index > 0 && styles.segmentRowBorder]}
                    {...rowProps}
                  >
                    <View style={styles.segmentLeft}>
                      <Text style={styles.segmentTime} numberOfLines={1}>
                        <Text style={styles.segmentTimeStrong}>{clockIn.start}</Text>
                        <Text style={styles.segmentSrc}> {clockIn.startSrc}</Text>
                        <Text style={styles.segmentDash}>  -  </Text>
                        <Text style={styles.segmentTimeStrong}>{clockIn.end}</Text>
                        <Text style={styles.segmentSrc}> {clockIn.endSrc}</Text>
                      </Text>
                      <StatusPill
                        status={clockIn.status}
                        distanceLabel={clockIn.distanceLabel}
                      />
                      {breakdownLabel ? (
                        <Text style={styles.locationBreakdownText}>{breakdownLabel}</Text>
                      ) : null}
                    </View>
                    <View style={styles.segmentRight}>
                      <Text style={styles.segmentDuration}>{clockIn.duration}</Text>
                      {canEdit ? (
                        <Ionicons name="chevron-forward" size={16} color={SUBTLE} />
                      ) : null}
                    </View>
                  </RowComponent>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function formatEditDateLabel(dateLabel) {
  return String(dateLabel || '').replace(/(\D)0(\d,)/, '$1$2');
}

function getDistanceLabel(segment) {
  if (segment?.distanceLabel) return segment.distanceLabel;
  return 'distance unknown';
}

function EditMapPreview({ distanceLabel, distanceVisible, onPress }) {
  return (
    <TouchableOpacity
      style={styles.editMapPreview}
      activeOpacity={0.82}
      onPress={onPress}
    >
      <View style={[styles.editMapRoad, styles.editMapRoadOne]} />
      <View style={[styles.editMapRoad, styles.editMapRoadTwo]} />
      <View style={[styles.editMapRoad, styles.editMapRoadThree]} />
      <View style={styles.editMapZone} />
      <View style={styles.editMapPin}>
        <Ionicons name="location" size={17} color="#fff" />
      </View>
      <View style={styles.editMapClock}>
        <Ionicons name="time" size={14} color={BRAND} />
      </View>
      {distanceVisible ? (
        <View style={styles.editDistanceBubble}>
          <Text style={styles.editDistanceText}>{distanceLabel}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function EditTimeScreen({ title, address, entry, projects = [], onSave, onDelete, onBack }) {
  const insets = useSafeAreaInsets();
  const { painter, day, segment } = entry;
  const [distanceVisible, setDistanceVisible] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const distanceLabel = getDistanceLabel(segment);
  const rawEntry = segment.raw || segment;
  const isActiveEntry = !rawEntry.endedAt || rawEntry.clockOutReason === 'active';
  const initialStart = new Date(rawEntry.startedAt || Date.now());
  const initialEnd = new Date(rawEntry.endedAt || rawEntry.startedAt || Date.now());
  const [startAt, setStartAt] = useState(initialStart);
  const [endAt, setEndAt] = useState(initialEnd);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const startChanged = startAt.getTime() !== initialStart.getTime();
  const endChanged = endAt.getTime() !== initialEnd.getTime();
  const projectChanged = !!selectedProject;
  const canSave = isActiveEntry
    ? startChanged || projectChanged
    : (startChanged || endChanged || projectChanged) && endAt.getTime() > startAt.getTime();
  const adjustedDuration = isActiveEntry
    ? formatEditDuration(Date.now() - startAt.getTime())
    : formatEditDuration(endAt.getTime() - startAt.getTime());
  const endDisplay = isActiveEntry ? 'In progress' : formatEditTime(endAt);
  const originalTimeNote = buildEditOriginalTimeNote(rawEntry, startAt, endAt, isActiveEntry);
  const handleSave = async () => {
    if (busy || !canSave) return;
    setBusy(true);
    setActionError('');
    try {
      const updates = {
        startedAt: startAt.toISOString(),
        project: selectedProject || undefined,
        adjustmentSource: 'project_detail_edit',
      };
      // Never send endedAt for an active/in-progress shift: it would prematurely close it.
      if (!isActiveEntry) updates.endedAt = endAt.toISOString();
      await onSave?.(entry, updates);
    } catch (error) {
      setActionError(error?.message || 'Could not save changes. Try again.');
      setBusy(false);
    }
  };
  const handleDelete = () => {
    if (busy) return;
    Alert.alert('Delete time entry?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setActionError('');
          try {
            await onDelete?.(entry);
          } catch (error) {
            setActionError(error?.message || 'Could not delete entry. Try again.');
            setBusy(false);
          }
        },
      },
    ]);
  };
  const displayedTitle = selectedProject ? getProjectTitle(selectedProject) : title;
  const projectOptions = useMemo(
    () => filterProjectOptions(projects, projectSearch),
    [projectSearch, projects],
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.editSafeArea}>
      <View style={styles.editHeader}>
        <TouchableOpacity
          style={styles.editBackButton}
          activeOpacity={0.7}
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={34} color="#000" />
        </TouchableOpacity>
        <Text style={styles.editTitle}>Edit Time</Text>
      </View>

      <ScrollView
        style={styles.editContent}
        contentContainerStyle={[
          styles.editContentInner,
          { paddingBottom: 14 },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
        alwaysBounceVertical={false}
      >
        <View style={styles.editShiftCard}>
          <View style={styles.editShiftTop}>
            <View style={styles.editShiftText}>
              <Text style={styles.editPainterName}>{painter.name}</Text>
              <View style={styles.editLocationRow}>
                <Ionicons name="location" size={20} color="#4e659f" />
                <Text style={styles.editLocationText} numberOfLines={1}>
                  {displayedTitle}
                </Text>
              </View>
            </View>
            <EditMapPreview
              distanceLabel={distanceLabel}
              distanceVisible={distanceVisible}
              onPress={() => setDistanceVisible((visible) => !visible)}
            />
          </View>

          <View style={styles.editTimeline}>
            <View style={styles.editTimeBlock}>
              <Text style={styles.editTimeValue}>{formatEditTime(startAt)}</Text>
              <Text style={styles.editTimeSource}>{segment.startSrc}</Text>
            </View>
            <View style={styles.editTimelineLine} />
            <View style={[styles.editTimeBlock, styles.editTimeBlockRight]}>
              <Text style={[styles.editTimeValue, styles.editTimeEnd]}>{endDisplay}</Text>
              <Text style={styles.editTimeSource}>{segment.endSrc}</Text>
            </View>
          </View>
        </View>

        <View style={styles.editDots}>
          {[0, 1, 2, 3, 4, 5].map((dot) => (
            <View
              key={dot}
              style={[styles.editDot, dot === 5 && styles.editDotActive]}
            />
          ))}
        </View>

        <View style={styles.editFormCard}>
          <View style={styles.editFormRow}>
            <Text style={styles.editFieldLabel}>Date</Text>
            <View style={styles.editFieldPill}>
              <Text style={styles.editFieldPillText}>{formatEditDateLabel(day.dateLabel)}</Text>
            </View>
          </View>
          <View style={styles.editFormRow}>
            <Text style={styles.editFieldLabel}>Clock-In Time</Text>
            <View style={styles.editFieldPill}>
              <Text style={styles.editFieldPillText}>{formatEditTime(startAt)}</Text>
            </View>
          </View>
          {originalTimeNote ? <Text style={styles.editOriginalNote}>{originalTimeNote}</Text> : null}
          <EditTimeAdjustRow
            label="clock-in time"
            onMinus={() => setStartAt((value) => addEditMinutes(value, -EDIT_TIME_STEP_MINUTES))}
            onPlus={() => setStartAt((value) => addEditMinutes(value, EDIT_TIME_STEP_MINUTES))}
          />
          <View style={styles.editFormRow}>
            <Text style={styles.editFieldLabel}>Clock-Out Time</Text>
            <View style={styles.editFieldPill}>
              <Text style={styles.editFieldPillText}>{endDisplay}</Text>
            </View>
          </View>
          <EditTimeAdjustRow
            label="clock-out time"
            disabled={isActiveEntry}
            onMinus={() => setEndAt((value) => addEditMinutes(value, -EDIT_TIME_STEP_MINUTES))}
            onPlus={() => setEndAt((value) => addEditMinutes(value, EDIT_TIME_STEP_MINUTES))}
          />
          <View style={styles.editFormRow}>
            <Text style={styles.editFieldLabel}>Duration</Text>
            <View style={styles.editFieldPill}>
              <Text style={styles.editFieldPillText}>{adjustedDuration}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.editActionCard}
          activeOpacity={0.85}
          onPress={() => setProjectPickerOpen((open) => !open)}
        >
          <Text style={styles.editActionText}>
            {selectedProject ? `Project: ${getProjectTitle(selectedProject)}` : 'Change Project'}
          </Text>
          <Ionicons name="location-outline" size={27} color="#77bed1" />
        </TouchableOpacity>

        {projectPickerOpen ? (
          <View style={styles.editProjectPicker}>
            <TextInput
              style={styles.editProjectPickerInput}
              value={projectSearch}
              onChangeText={setProjectSearch}
              placeholder="Search projects"
              placeholderTextColor={MUTED}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {projectOptions.map((projectOption) => (
              <TouchableOpacity
                key={getCompanyCamProjectId(projectOption)}
                style={styles.editProjectPickerOption}
                activeOpacity={0.82}
                onPress={() => {
                  setSelectedProject(projectOption);
                  setProjectPickerOpen(false);
                  setProjectSearch('');
                }}
              >
                <Text style={styles.editProjectPickerName} numberOfLines={1}>
                  {getProjectTitle(projectOption)}
                </Text>
                <Text style={styles.editProjectPickerAddress} numberOfLines={1}>
                  {getProjectAddress(projectOption)}
                </Text>
              </TouchableOpacity>
            ))}
            {!projectOptions.length ? (
              <Text style={styles.editProjectPickerEmpty}>No matching projects.</Text>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.editAddressHint} numberOfLines={2}>
          Tap the map preview to show distance from the job site. {address}
        </Text>
      </ScrollView>

      <View style={[styles.editBottomActions, { paddingBottom: insets.bottom + 16 }]}>
        {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
        {isActiveEntry ? (
          <Text style={styles.editActiveHint}>This shift is still in progress. Only the start time can be changed.</Text>
        ) : null}
        <TouchableOpacity
          style={[styles.editSaveButton, (!canSave || busy) && styles.editSaveButtonDisabled]}
          activeOpacity={0.75}
          disabled={!canSave || busy}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          onPress={handleSave}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.editSaveText}>Save Changes</Text>
          )}
        </TouchableOpacity>
        <View style={styles.editSplitActions}>
          <TouchableOpacity
            style={styles.editCancelButton}
            activeOpacity={0.75}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
            onPress={onBack}
          >
            <Text style={styles.editCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.editDeleteButton, busy && styles.editSaveButtonDisabled]}
            activeOpacity={0.75}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Delete time entry"
            onPress={handleDelete}
          >
            <Text style={styles.editDeleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function EditTimeAdjustRow({ onMinus, onPlus, disabled = false, label = 'time' }) {
  return (
    <View style={styles.editTimeAdjustRow}>
      <TouchableOpacity
        style={[styles.editTimeAdjustButton, disabled && styles.editTimeAdjustButtonDisabled]}
        activeOpacity={0.8}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Subtract ${EDIT_TIME_STEP_MINUTES} minutes from ${label}`}
        onPress={onMinus}
      >
        <Text style={styles.editTimeAdjustText}>-{EDIT_TIME_STEP_MINUTES}m</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.editTimeAdjustButton, disabled && styles.editTimeAdjustButtonDisabled]}
        activeOpacity={0.8}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Add ${EDIT_TIME_STEP_MINUTES} minutes to ${label}`}
        onPress={onPlus}
      >
        <Text style={styles.editTimeAdjustText}>+{EDIT_TIME_STEP_MINUTES}m</Text>
      </TouchableOpacity>
    </View>
  );
}

function addEditMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function formatEditTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatEditDuration(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function buildEditOriginalTimeNote(rawEntry, startAt, endAt, isActiveEntry) {
  const history = Array.isArray(rawEntry?.adjustmentHistory) ? rawEntry.adjustmentHistory : [];
  const originalStart = rawEntry?.originalStartedAt || history[0]?.previousStartedAt;
  const originalEnd = history.find((item) => item?.previousEndedAt)?.previousEndedAt;
  const lastEdit = history[history.length - 1]?.adjustedAt || rawEntry?.startEditedAt;
  const parts = [];

  if (isDifferentEditMinute(originalStart, startAt)) {
    parts.push(`Original in ${formatEditTime(new Date(originalStart))}`);
  }

  if (!isActiveEntry && isDifferentEditMinute(originalEnd, endAt)) {
    parts.push(`original out ${formatEditTime(new Date(originalEnd))}`);
  }

  if (!parts.length) return '';
  if (lastEdit) parts.push(`edited ${formatEditTime(new Date(lastEdit))}`);
  return parts.join(' · ');
}

function isDifferentEditMinute(originalValue, currentDate) {
  if (!originalValue || !currentDate) return false;
  const original = new Date(originalValue);
  if (Number.isNaN(original.getTime())) return false;
  return Math.round(original.getTime() / 60000) !== Math.round(currentDate.getTime() / 60000);
}

function filterProjectOptions(projects, query) {
  const normalized = String(query || '').trim().toLowerCase();
  return (projects || [])
    .filter((project) => {
      if (!project || project.is_archived || project.is_lead) return false;
      if (!normalized) return true;
      return [getProjectTitle(project), getProjectAddress(project), project.city, project.postal_code]
        .some((value) => String(value || '').toLowerCase().includes(normalized));
    })
    .slice(0, 6);
}

export default function ProjectDetailScreen({
  project,
  onBack,
  entries = [],
  activeShift,
  activeElapsedMs = 0,
  clockOutPending = false,
  trackingNotice,
  projects = [],
  user,
  canViewTeamTime = false,
  onClockIn,
  onClockOut,
  onSwitchProject,
  onOpenActiveClock,
  onDeleteTimeEntry,
  onUpdateTimeEntry,
}) {
  const insets = useSafeAreaInsets();
  const isLead = project?.is_lead === true;
  const [activeTab, setActiveTab] = useState('clock');
  const [selectedPainterId, setSelectedPainterId] = useState(null);
  const [selectedTimeEntry, setSelectedTimeEntry] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [photosError, setPhotosError] = useState('');
  const [clockActionPending, setClockActionPending] = useState(false);
  const [jobReasonPrompt, setJobReasonPrompt] = useState(null);
  const [clockActionError, setClockActionError] = useState('');
  const [liveNowMs, setLiveNowMs] = useState(Date.now);
  const hasActiveProjectEntry = useMemo(
    () => Boolean(activeShift) ||
      (entries || []).some((entry) => entry?.clockOutReason === 'active' || !entry?.endedAt),
    [activeShift, entries],
  );

  useEffect(() => {
    if (!hasActiveProjectEntry) return undefined;
    setLiveNowMs(Date.now());
    const interval = setInterval(() => setLiveNowMs(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, [hasActiveProjectEntry]);

  const clockInDays = useMemo(() => {
    const trackedDays = buildProjectClockInDays(entries, activeShift, project, user, liveNowMs);
    return trackedDays;
  }, [entries, activeShift, project, user, liveNowMs]);
  const painterSummaries = buildPainterClockInSummaries(clockInDays);
  const selectedPainter =
    selectedPainterId === null
      ? null
      : painterSummaries.find((painter) => painter.id === selectedPainterId) ?? null;

  const title = getProjectTitle(project);
  const companyCamProjectId = getCompanyCamProjectId(project);
  const labourTasks = useProjectLabourTasks(companyCamProjectId, {
    enabled: Boolean(companyCamProjectId) && !isLead,
    userId: user?.id,
  });
  const budgetProjects = useMemo(() => (project ? [project] : []), [project]);
  const {
    progressByProjectId,
    error: budgetProgressError,
    refresh: refreshBudgetProgress,
  } = useProjectBudgetProgress(budgetProjects, { enabled: !isLead });
  const budgetProgress =
    progressByProjectId[String(companyCamProjectId || '')] ||
    (budgetProgressError ? { status: 'unavailable' } : null);
  const budgetPresentation = getBudgetProgressPresentation(budgetProgress);
  const address = getProjectAddress(project);
  const addedDate = formatDate(
    firstValue([project?.created_at, project?.added_at, project?.inserted_at]),
  );
  const projectEntryTotals = useMemo(
    () => getProjectEntryTotals(entries, project, user, liveNowMs),
    [entries, project, user, liveNowMs],
  );
  const fallbackYourHours = toNumericHours(firstValue([project?.your_hours, project?.user_hours, project?.my_hours], null));
  const fallbackTeamHours = toNumericHours(firstValue([project?.team_hours, project?.total_hours, project?.crew_hours], null));
  const yourHours = projectEntryTotals.yourMs > 0
    ? formatMsAsHours(projectEntryTotals.yourMs)
    : formatHours(fallbackYourHours, '0.0h');
  const teamHoursRaw = projectEntryTotals.teamMs > 0 ? projectEntryTotals.teamMs / 3600000 : fallbackTeamHours || 0;
  const teamHours = projectEntryTotals.teamMs > 0 ? formatMsAsHours(projectEntryTotals.teamMs) : `${teamHoursRaw.toFixed(1)}h`;
  const visibleHoursKicker = canViewTeamTime ? 'Team' : 'Visible';
  const visibleHoursLabel = canViewTeamTime ? 'Team total' : 'Entries shown';
  const recentTitle = canViewTeamTime ? 'Hours by Painter' : 'Your Clock-ins';
  const recentCount = canViewTeamTime ? `${painterSummaries.length} crew` : `${clockInDays.length} day${clockInDays.length === 1 ? '' : 's'}`;
  const isActiveProject = isSameCompanyCamProject(activeShift?.project, project) && !clockOutPending;
  const activeStartLabel =
    isActiveProject && activeShift?.startedAt ? formatEditTime(new Date(activeShift.startedAt)) : null;
  const activeElapsedLabel = isActiveProject ? formatElapsedClock(activeElapsedMs) : null;
  const primaryClockLabel = isActiveProject ? 'Clock Out' : activeShift ? 'Switch Job' : 'Clock In';
  const primaryClockIcon = isActiveProject ? 'stop-circle-outline' : activeShift ? 'swap-horizontal' : 'play';
  const floatingClockLabel = isActiveProject ? 'Clock Out' : activeShift ? 'Switch Job' : 'Clock In';
  const handlePrimaryClockAction = async () => {
    if (clockActionPending) return;
    setClockActionPending(true);
    setClockActionError('');
    try {
      if (isActiveProject) {
        const entry = await onClockOut?.('project_detail');
        if (!entry) {
          setClockActionError('Clock out could not complete. Try again.');
        } else {
          await refreshBudgetProgress();
          maybePromptJobOverBudget();
        }
        return;
      }

      if (activeShift) {
        const nextShift = await onSwitchProject?.(project);
        if (!nextShift) {
          setClockActionError('Switch job could not complete. Check location permissions and try again.');
        } else {
          await refreshBudgetProgress();
          onOpenActiveClock?.();
        }
        return;
      }

      const shift = await onClockIn?.(project);
      if (!shift) {
        setClockActionError('Clock in could not start. Check location permissions and try again.');
      } else {
        await refreshBudgetProgress();
        onOpenActiveClock?.();
      }
    } catch (error) {
      setClockActionError(error?.message || 'Clock action could not complete. Try again.');
    } finally {
      setClockActionPending(false);
    }
  };
  const clockFeedback = trackingNotice?.message || clockActionError;

  const maybePromptJobOverBudget = async () => {
    try {
      if (!companyCamProjectId || !user?.id) return;
      if (await hasAnsweredJobOverBudgetReason(user.id, companyCamProjectId)) return;
      const { over, hoursOver } = await evaluateJobOverBudget(companyCamProjectId);
      if (over) setJobReasonPrompt({ hoursOver });
    } catch (_error) {
      // The reason prompt is best effort; clock-out already succeeded.
    }
  };

  useEffect(() => {
    if (isLead || activeTab !== 'photos' || photosLoaded) return;

    let cancelled = false;

    async function loadPhotos() {
      if (!companyCamProjectId) {
        setPhotosError('This project is not linked to CompanyCam.');
        setPhotosLoaded(true);
        return;
      }

      setPhotosLoading(true);
      setPhotosError('');

      const { data, error } = await supabase.functions.invoke('companycam-project-photos', {
        body: {
          projectId: companyCamProjectId,
          perPage: 30,
        },
      });

      if (cancelled) return;

      if (error) {
        setPhotosError(error.message || 'Unable to load CompanyCam photos.');
        setPhotos([]);
      } else {
        setPhotos(Array.isArray(data?.photos) ? data.photos : []);
      }

      setPhotosLoaded(true);
      setPhotosLoading(false);
    }

    loadPhotos();

    return () => {
      cancelled = true;
    };
  }, [activeTab, companyCamProjectId, isLead, photosLoaded]);

  if (isLead) {
    return (
      <LeadDetailScreen
        project={project}
        title={title}
        address={address}
        addedDate={addedDate}
        insets={insets}
        onBack={onBack}
      />
    );
  }

  if (selectedTimeEntry) {
    return (
      <EditTimeScreen
        title={title}
        address={address}
        entry={selectedTimeEntry}
        projects={projects}
        onSave={async (entryToSave, updates) => {
          await onUpdateTimeEntry?.(entryToSave.segment?.raw || entryToSave.segment || entryToSave, updates);
          await refreshBudgetProgress();
          setSelectedTimeEntry(null);
        }}
        onDelete={async (entryToDelete) => {
          await onDeleteTimeEntry?.(entryToDelete.segment?.raw || entryToDelete.segment || entryToDelete);
          await refreshBudgetProgress();
          setSelectedTimeEntry(null);
        }}
        onBack={() => setSelectedTimeEntry(null)}
      />
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={34} color={INK} />
        </TouchableOpacity>

        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {addedDate}
          </Text>
        </View>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'clock' && styles.activeTab]}
          activeOpacity={0.85}
          accessibilityRole="tab"
          accessibilityLabel="Clock Ins"
          accessibilityState={{ selected: activeTab === 'clock' }}
          onPress={() => setActiveTab('clock')}
        >
          <ClockGlyph color={activeTab === 'clock' ? '#fff' : BRAND} size={14} />
          <Text style={[styles.tabText, activeTab === 'clock' && styles.activeTabText]}>
            Clock Ins
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'photos' && styles.activeTab]}
          activeOpacity={0.85}
          accessibilityRole="tab"
          accessibilityLabel="Photos"
          accessibilityState={{ selected: activeTab === 'photos' }}
          onPress={() => setActiveTab('photos')}
        >
          <CameraGlyph color={activeTab === 'photos' ? '#fff' : BRAND} />
          <Text style={[styles.tabText, activeTab === 'photos' && styles.activeTabText]}>
            Photos
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[
          styles.contentInner,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'clock' && !selectedPainter ? (
          <View style={styles.infoCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(title)}</Text>
            </View>
            <View style={styles.infoTextWrap}>
              <Text style={styles.infoLabel}>PROJECT</Text>
              <Text style={styles.infoTitle} numberOfLines={1}>
                {title}
              </Text>
              <View style={styles.addressRow}>
                <PinGlyph />
                <Text style={styles.addressText} numberOfLines={2}>
                  {address}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {activeTab === 'clock' ? (
          selectedPainter ? (
            <PainterDetailView
              painter={selectedPainter}
              onBack={() => setSelectedPainterId(null)}
              onSegmentPress={setSelectedTimeEntry}
            />
          ) : (
            <>
              {isActiveProject ? (
                <View style={styles.activeShiftBanner}>
                  <View style={styles.activeShiftPulse}>
                    <Ionicons name="time" size={18} color="#fff" />
                  </View>
                  <View style={styles.activeShiftText}>
                    <Text style={styles.activeShiftLabel}>Current clock-in{activeStartLabel ? ` · since ${activeStartLabel}` : ''}</Text>
                    <Text style={styles.activeShiftTimer}>{activeElapsedLabel}</Text>
                  </View>
                  <View style={styles.activeShiftLiveDot} />
                </View>
              ) : null}

              <View style={styles.hoursPanelCard}>
                <BudgetHoursPanel
                  progress={budgetProgress}
                  primaryLabel="Your hours"
                  primaryValue={yourHours}
                  primaryCaption="you"
                  fallbackSecondaryLabel={visibleHoursLabel}
                  fallbackSecondaryValue={teamHours}
                />
              </View>

              <TouchableOpacity
                style={[styles.clockButton, clockActionPending && styles.clockButtonPending]}
                activeOpacity={0.9}
                disabled={clockActionPending}
                accessibilityRole="button"
                accessibilityLabel={primaryClockLabel}
                onPress={handlePrimaryClockAction}
              >
                <View style={styles.clockIconCircle}>
                  {clockActionPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : primaryClockIcon === 'play' ? (
                    <PlayGlyph />
                  ) : (
                    <Ionicons name={primaryClockIcon} size={23} color="#fff" />
                  )}
                </View>
                <Text style={styles.clockButtonText}>
                  {clockActionPending ? 'Working…' : primaryClockLabel}
                </Text>
              </TouchableOpacity>

              {clockFeedback ? (
                <Text style={styles.errorText}>{clockFeedback}</Text>
              ) : null}

              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>{recentTitle}</Text>
                <Text style={styles.recentSeeAll}>{recentCount}</Text>
              </View>

              {painterSummaries.length ? (
                painterSummaries.map((painter) => (
                  <PainterSummaryRow
                    key={painter.id}
                    painter={painter}
                    onPress={() => setSelectedPainterId(painter.id)}
                  />
                ))
              ) : (
                <View style={[styles.emptyState, styles.emptyStateCompact]}>
                  <View style={[styles.emptyArt, styles.emptyArtCompact]}>
                    <ClockGlyph color={BRAND} size={32} />
                  </View>
                  <Text style={styles.emptyTitle}>No clock-ins yet</Text>
                  <Text style={styles.emptyHint}>
                    Time entries will appear here after painters clock into this project.
                  </Text>
                </View>
              )}

              <View style={styles.tasksSection}>
                <ProjectLabourTasksPanel
                  project={project}
                  activeShift={activeShift}
                  tracking={labourTasks}
                  showHoursMeter={false}
                />
              </View>
            </>
          )
        ) : (
          <PhotosPanel
            photos={photos}
            loading={photosLoading}
            error={photosError}
            onRetry={() => {
              setPhotosLoaded(false);
              setPhotosError('');
            }}
          />
        )}
      </ScrollView>

      {activeTab === 'clock' && !selectedPainter ? (
        <TouchableOpacity
          style={[
            styles.addTimeButton,
            { bottom: insets.bottom + 22 },
            clockActionPending && styles.clockButtonPending,
          ]}
          activeOpacity={0.9}
          disabled={clockActionPending}
          accessibilityRole="button"
          accessibilityLabel={floatingClockLabel}
          onPress={handlePrimaryClockAction}
        >
          <Text style={styles.addTimeText}>{clockActionPending ? 'Working…' : floatingClockLabel}</Text>
          <View style={styles.addDivider} />
          {clockActionPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name={primaryClockIcon === 'play' ? 'time-outline' : primaryClockIcon} size={27} color="#fff" />
          )}
        </TouchableOpacity>
      ) : null}

      {jobReasonPrompt ? (
        <OverBudgetReasonSheet
          task={{ title }}
          hoursOver={jobReasonPrompt.hoursOver}
          onSubmit={async ({ reason, note }) => {
            await submitJobOverBudgetReason({
              projectId: companyCamProjectId,
              userId: user?.id,
              reason,
              note,
              hoursOver: jobReasonPrompt.hoursOver,
            });
            await markJobOverBudgetReasonAnswered(user?.id, companyCamProjectId);
            setJobReasonPrompt(null);
          }}
          onSkip={async () => {
            await markJobOverBudgetReasonAnswered(user?.id, companyCamProjectId);
            setJobReasonPrompt(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function LeadDetailScreen({ project, title, address, addedDate, insets, onBack }) {
  const details = [
    ['Status', formatLeadValue(project?.lead_stage || project?.status)],
    ['Source', formatLeadValue(project?.source)],
    ['Email', project?.contact_email || 'Not provided'],
    ['Phone', project?.contact_phone || 'Not provided'],
  ];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={34} color={INK} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{addedDate}</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        <View style={[styles.tab, styles.activeTab]}>
          <Ionicons name="person-outline" size={16} color="#fff" />
          <Text style={[styles.tabText, styles.activeTabText]}>Overview</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentInner, { paddingBottom: insets.bottom + 36 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.infoCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(title)}</Text>
          </View>
          <View style={styles.infoTextWrap}>
            <Text style={styles.infoLabel}>LEAD</Text>
            <Text style={styles.infoTitle} numberOfLines={1}>{title}</Text>
            <View style={styles.addressRow}>
              <PinGlyph />
              <Text style={styles.addressText} numberOfLines={2}>{address}</Text>
            </View>
          </View>
        </View>

        <View style={styles.leadOverviewCard}>
          {details.map(([label, value], index) => (
            <View key={label} style={[styles.leadOverviewRow, index > 0 && styles.leadOverviewRowBorder]}>
              <Text style={styles.leadOverviewLabel}>{label}</Text>
              <Text style={styles.leadOverviewValue} numberOfLines={2}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.leadReadOnlyNotice}>
          <Ionicons name="information-circle-outline" size={19} color={BRAND} />
          <Text style={styles.leadReadOnlyText}>
            This lead becomes operational after an accepted quote creates a job.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatLeadValue(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Not provided';
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PhotosPanel({ photos, loading, error, onRetry }) {
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);

  if (loading) {
    return (
      <View style={styles.photosLoading}>
        <ActivityIndicator color={BRAND} />
        <Text style={styles.photosLoadingText}>Loading CompanyCam photos</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.photosNotice}>
        <View style={styles.emptyArt}>
          <View style={styles.artCircle} />
          <CameraGlyph color={BRAND} />
        </View>
        <Text style={styles.emptyTitle}>Photos unavailable</Text>
        <Text style={styles.emptyHint}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} activeOpacity={0.85} onPress={onRetry}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!photos.length) {
    return (
      <View style={styles.photosNotice}>
        <View style={styles.emptyArt}>
          <View style={styles.artCircle} />
          <CameraGlyph color={BRAND} />
        </View>
        <Text style={styles.emptyTitle}>No photos yet</Text>
        <Text style={styles.emptyHint}>
          Photos from the linked CompanyCam project will appear here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.photosSection}>
      <View style={styles.photosHeader}>
        <Text style={styles.photosTitle}>CompanyCam Photos</Text>
        <Text style={styles.photosCount}>{photos.length}</Text>
      </View>
      <View style={styles.photoGrid}>
        {photos.map((photo, index) => (
          <TouchableOpacity
            key={photo.id || photo.thumbnailUrl || photo.url}
            style={styles.photoCard}
            activeOpacity={0.9}
            onPress={() => setSelectedPhotoIndex(index)}
          >
            <Image
              source={{ uri: photo.thumbnailUrl || photo.url }}
              style={styles.photoImage}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ))}
      </View>
      <PhotoLightbox
        photos={photos}
        selectedIndex={selectedPhotoIndex}
        onClose={() => setSelectedPhotoIndex(null)}
      />
    </View>
  );
}

function PhotoLightbox({ photos, selectedIndex, onClose }) {
  const scrollRef = useRef(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(selectedIndex ?? 0);
  const visible = selectedIndex !== null;
  const viewerTopInset = Math.max(insets.top, 16) + 10;
  const viewerPageHeight = Math.max(0, height - viewerTopInset - insets.bottom - 54);
  onCloseRef.current = onClose;

  const heightRef = useRef(height);
  heightRef.current = height;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
      onPanResponderGrant: () => translateY.stopAnimation(),
      onPanResponderMove: (_event, gesture) => {
        translateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        const screenHeight = heightRef.current;
        const shouldDismiss =
          gesture.dy > Math.min(140, screenHeight * 0.18) ||
          (gesture.dy > 24 && gesture.vy > 0.8);

        if (shouldDismiss) {
          Animated.timing(translateY, {
            toValue: screenHeight,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            translateY.setValue(0);
            onCloseRef.current?.();
          });
          return;
        }

        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    }),
  ).current;

  const closeViewer = () => {
    translateY.stopAnimation();
    translateY.setValue(0);
    onClose();
  };

  useEffect(() => {
    if (!visible) return undefined;

    const nextIndex = selectedIndex ?? 0;
    setCurrentIndex(nextIndex);
    translateY.setValue(0);

    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: nextIndex * width, animated: false });
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedIndex, translateY, visible, width]);

  if (!visible) return null;

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeViewer}
    >
      <View style={styles.viewerBackdrop}>
        <StatusBar style="light" backgroundColor="#050607" />
        <Animated.View
          style={[
            styles.viewer,
            {
              paddingTop: viewerTopInset,
              paddingBottom: insets.bottom,
              transform: [{ translateY }],
            },
          ]}
          accessibilityViewIsModal
          onAccessibilityEscape={closeViewer}
          {...panResponder.panHandlers}
        >
          <View style={styles.viewerTopBar}>
            <TouchableOpacity
              style={styles.viewerCloseButton}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Close picture viewer"
              hitSlop={8}
              onPress={closeViewer}
            >
              <Ionicons name="close" size={24} color="#ffffff" />
              <Text style={styles.viewerCloseText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.viewerCounter}>
              Picture {currentIndex + 1} / {photos.length}
            </Text>
            <View style={styles.viewerTopSpacer} />
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.viewerPages}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
              setCurrentIndex(Math.max(0, Math.min(photos.length - 1, nextIndex)));
            }}
          >
            {photos.map((photo) => (
              <View
                key={photo.id || photo.thumbnailUrl || photo.url}
                style={[styles.viewerSlide, { width, height: viewerPageHeight }]}
              >
                <Image
                  source={{ uri: photo.url || photo.thumbnailUrl }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tasksSection: {
    marginTop: 18,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: '#fff',
  },
  backButton: {
    width: 32,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  chevron: {
    width: 11,
    height: 11,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: INK,
    transform: [{ rotate: '45deg' }],
    marginLeft: 4,
  },
  headerText: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    color: INK,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    marginTop: 1,
    color: MUTED,
    fontSize: 12,
    fontWeight: '500',
  },
  headerAction: {
    height: 32,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: {
    color: '#5a6068',
    fontSize: 13,
    fontWeight: '600',
  },

  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    backgroundColor: '#fff',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: SOFT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  activeTab: {
    backgroundColor: NAVY,
    borderColor: NAVY,
  },
  tabText: {
    color: '#5a6068',
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#fff',
    fontWeight: '700',
  },

  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 120,
  },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 2px 6px rgba(0,0,0,0.03)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.03,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eaf4f6',
    marginRight: 12,
  },
  avatarText: {
    color: BRAND,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  infoTextWrap: {
    flex: 1,
  },
  infoLabel: {
    color: SUBTLE,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  infoTitle: {
    marginTop: 2,
    color: INK,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
  },
  addressText: {
    flex: 1,
    color: '#73777a',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  leadOverviewCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  leadOverviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  leadOverviewRowBorder: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  leadOverviewLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '700',
  },
  leadOverviewValue: {
    flex: 1,
    color: INK,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  leadReadOnlyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#eaf4f6',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  leadReadOnlyText: {
    flex: 1,
    color: NAVY,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },

  pinGlyph: {
    width: 12,
    height: 14,
    alignItems: 'center',
    marginTop: 1,
  },
  pinDrop: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pinDot: {
    position: 'absolute',
    bottom: 0,
    width: 2,
    height: 4,
    borderRadius: 1,
    backgroundColor: BRAND,
  },

  activeShiftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#eaf4f6',
    borderWidth: 1,
    borderColor: '#cfe6ea',
  },
  activeShiftPulse: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeShiftText: {
    flex: 1,
    minWidth: 0,
  },
  activeShiftLabel: {
    color: '#4a6b72',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  activeShiftTimer: {
    marginTop: 2,
    color: INK,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  activeShiftLiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#27ae60',
  },
  hoursPanelCard: {
    marginTop: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: TILE_BG,
  },
  hourCard: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: TILE_BG,
  },
  youCard: {
    flex: 1,
    justifyContent: 'space-between',
  },
  comboCard: {
    flex: 1.6,
    paddingHorizontal: 12,
  },
  comboHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  comboStats: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  comboStat: {
    flex: 1,
  },
  comboKicker: {
    color: NAVY,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  comboValue: {
    marginTop: 6,
  },
  comboDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: BORDER,
    marginHorizontal: 10,
  },
  detailBudgetProgress: {
    marginTop: 10,
  },
  hourBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  hourBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  hourValue: {
    marginTop: 10,
    color: INK,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  hourLabel: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11,
    fontWeight: '600',
  },

  clockButton: {
    height: 50,
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: BRAND,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#fff',
  },
  clockIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND,
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 9,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#fff',
    marginLeft: 3,
  },
  clockButtonText: {
    color: BRAND,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  clockButtonPending: {
    opacity: 0.6,
  },
  errorText: {
    marginTop: 10,
    color: '#c0432b',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  editActiveHint: {
    marginBottom: 10,
    color: MUTED,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  editTimeAdjustButtonDisabled: {
    opacity: 0.4,
  },

  glyphCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockHandV: {
    position: 'absolute',
    width: 1.6,
    top: 2,
    borderRadius: 1,
  },
  clockHandH: {
    position: 'absolute',
    height: 1.6,
    right: 2,
    borderRadius: 1,
  },

  cameraGlyph: {
    width: 18,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBody: {
    width: 18,
    height: 12,
    borderWidth: 1.6,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLens: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.4,
  },
  cameraBump: {
    position: 'absolute',
    top: -1,
    width: 6,
    height: 2,
    borderRadius: 1,
  },

  emptyState: {
    alignItems: 'center',
    marginTop: 40,
    paddingHorizontal: 20,
  },
  emptyArt: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyStateCompact: {
    marginTop: 14,
    marginBottom: 6,
  },
  emptyArtCompact: {
    width: 44,
    height: 44,
    marginBottom: 6,
  },
  artCircle: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#eef6f8',
  },
  emptyTitle: {
    color: INK,
    fontSize: 15,
    fontWeight: '700',
  },
  emptyHint: {
    marginTop: 4,
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    textAlign: 'center',
  },
  photosLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 58,
  },
  photosLoadingText: {
    marginTop: 10,
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  photosNotice: {
    alignItems: 'center',
    marginTop: 40,
    paddingHorizontal: 20,
  },
  retryButton: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#eaf4f6',
  },
  retryText: {
    color: BRAND,
    fontSize: 13,
    fontWeight: '800',
  },
  photosSection: {
    marginTop: 18,
    paddingBottom: 42,
  },
  photosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  photosTitle: {
    color: INK,
    fontSize: 15,
    fontWeight: '800',
  },
  photosCount: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '700',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoCard: {
    width: '48.5%',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: SOFT,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: '#050607',
  },
  viewer: {
    flex: 1,
    backgroundColor: '#050607',
  },
  viewerTopBar: {
    height: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#050607',
  },
  viewerCloseButton: {
    minWidth: 68,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  viewerCloseText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  viewerCounter: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  viewerTopSpacer: {
    width: 68,
  },
  viewerPages: {
    flex: 1,
  },
  viewerSlide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },

  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  recentTitle: {
    color: INK,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  recentSeeAll: {
    color: BRAND,
    fontSize: 13,
    fontWeight: '700',
  },

  dayGroup: {
    marginBottom: 14,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: SOFT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
  },
  dayHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flex: 1,
  },
  dayLabel: {
    color: INK,
    fontSize: 13,
    fontWeight: '800',
  },
  dayDate: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  dayTotal: {
    color: NAVY,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.1,
  },

  painterCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  painterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  painterAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#eef1f4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  painterAvatarYou: {
    backgroundColor: BRAND,
  },
  painterAvatarText: {
    color: NAVY,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  painterAvatarTextYou: {
    color: '#fff',
  },
  painterNameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  painterName: {
    color: INK,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  painterYouTag: {
    color: BRAND,
    backgroundColor: '#eaf4f6',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  painterTotal: {
    color: INK,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },

  segmentList: {
    paddingTop: 8,
  },
  segmentListCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 14,
  },
  segmentRowBorder: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  painterSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    gap: 4,
  },
  painterSummaryBody: {
    flex: 1,
    paddingRight: 6,
  },
  painterSummaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  painterSummaryMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  painterMetaText: {
    color: MUTED,
    fontSize: 11.5,
    fontWeight: '600',
  },
  painterMetaOn: {
    color: BRAND,
    fontWeight: '800',
  },
  painterMetaOff: {
    color: '#c0432b',
    fontWeight: '800',
  },
  painterMetaMixed: {
    color: '#9a611f',
    fontWeight: '800',
  },
  painterMetaDivider: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: SUBTLE,
  },
  painterStatusInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  detailBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    marginTop: 6,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  detailBackText: {
    color: BRAND,
    fontSize: 13,
    fontWeight: '700',
  },
  detailHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#fff',
    marginBottom: 16,
    gap: 12,
  },
  detailHeaderAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 0,
  },
  detailHeaderAvatarText: {
    fontSize: 14,
  },
  detailHeaderTextWrap: {
    flex: 1,
  },
  detailHeaderName: {
    color: INK,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  detailHeaderMeta: {
    marginTop: 2,
    color: MUTED,
    fontSize: 11.5,
    fontWeight: '600',
  },
  detailHeaderTotal: {
    color: NAVY,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  segmentLeft: {
    flex: 1,
    paddingRight: 10,
  },
  segmentRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  segmentTime: {
    color: BRAND,
    fontSize: 12.5,
    fontWeight: '700',
  },
  segmentTimeStrong: {
    color: BRAND,
    fontWeight: '800',
  },
  segmentSrc: {
    color: BRAND,
    fontWeight: '600',
    opacity: 0.85,
  },
  segmentDash: {
    color: SUBTLE,
    fontWeight: '600',
  },
  segmentDuration: {
    color: INK,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  locationBreakdownText: {
    marginTop: 5,
    color: MUTED,
    fontSize: 10.5,
    fontWeight: '600',
  },
  segStatusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 5,
  },
  segStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  segStatusText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  segStatusDistanceDivider: {
    marginHorizontal: -2,
  },

  editSafeArea: {
    flex: 1,
    backgroundColor: '#f6f6f6',
  },
  editHeader: {
    height: 116,
    paddingHorizontal: 18,
    paddingTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  editBackButton: {
    width: 42,
    height: 42,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginRight: 10,
  },
  editTitle: {
    color: '#202124',
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1.2,
  },
  editContent: {
    flex: 1,
  },
  editContentInner: {
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 14,
  },
  editShiftCard: {
    borderWidth: 1.2,
    borderColor: '#8f9296',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
  },
  editShiftTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  editShiftText: {
    flex: 1,
    minWidth: 0,
  },
  editPainterName: {
    color: TEXT,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  editLocationRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editLocationText: {
    flex: 1,
    color: '#4e659f',
    fontSize: 16,
    fontWeight: '800',
  },
  editMapPreview: {
    width: 86,
    height: 76,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e8f2ef',
    borderWidth: 1,
    borderColor: '#d9e4df',
  },
  editMapRoad: {
    position: 'absolute',
    height: 9,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    opacity: 0.9,
  },
  editMapRoadOne: {
    width: 110,
    top: 16,
    left: -18,
    transform: [{ rotate: '-22deg' }],
  },
  editMapRoadTwo: {
    width: 90,
    top: 46,
    left: 8,
    transform: [{ rotate: '26deg' }],
  },
  editMapRoadThree: {
    width: 76,
    top: 36,
    left: 20,
    transform: [{ rotate: '-62deg' }],
  },
  editMapZone: {
    position: 'absolute',
    width: 55,
    height: 55,
    borderRadius: 28,
    right: 8,
    top: 10,
    borderWidth: 2,
    borderColor: 'rgba(43,132,150,0.35)',
    backgroundColor: 'rgba(43,132,150,0.13)',
  },
  editMapPin: {
    position: 'absolute',
    right: 16,
    top: 18,
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: '#91cbb1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  editMapClock: {
    position: 'absolute',
    left: 13,
    top: 35,
    width: 29,
    height: 29,
    borderRadius: 15,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#8fc7d5',
  },
  editDistanceBubble: {
    position: 'absolute',
    left: 5,
    right: 5,
    bottom: 5,
    minHeight: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(49,73,93,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  editDistanceText: {
    color: '#fff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  editTimeline: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
  },
  editTimeBlock: {
    minWidth: 90,
  },
  editTimeBlockRight: {
    alignItems: 'flex-end',
  },
  editTimeValue: {
    color: '#6ba7ff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  editTimeEnd: {
    color: '#7087bd',
  },
  editTimeSource: {
    marginTop: 2,
    color: '#6482bd',
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '800',
  },
  editTimelineLine: {
    flex: 1,
    height: 1,
    marginHorizontal: 12,
    backgroundColor: '#c8ccd0',
  },
  editDots: {
    marginTop: 28,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
  },
  editDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#e0e0e0',
  },
  editDotActive: {
    backgroundColor: '#949494',
  },
  editFormCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  editFormRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
  },
  editFieldLabel: {
    color: '#000',
    fontSize: 20,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  editFieldPill: {
    minHeight: 41,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: '#eeeeef',
  },
  editFieldPillText: {
    color: '#000',
    fontSize: 20,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  editOriginalNote: {
    marginTop: -2,
    marginBottom: 8,
    color: MUTED,
    fontSize: 12,
    fontWeight: '700',
  },
  editActionCard: {
    minHeight: 72,
    marginTop: 12,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 7,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editActionText: {
    color: '#77bed1',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  editAddressHint: {
    marginTop: 12,
    paddingHorizontal: 4,
    color: MUTED,
    fontSize: 11,
    fontWeight: '600',
  },
  editBottomActions: {
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: '#f6f6f6',
  },
  editSaveButton: {
    height: 54,
    borderRadius: 4,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSaveButtonDisabled: {
    backgroundColor: '#d7dcde',
  },
  editSaveText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  editSplitActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 18,
  },
  editCancelButton: {
    flex: 1,
    height: 58,
    borderWidth: 1,
    borderColor: '#8d8d8d',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  editCancelText: {
    color: '#8d8d8d',
    fontSize: 20,
    fontWeight: '800',
  },
  editDeleteButton: {
    flex: 1,
    height: 58,
    borderWidth: 1,
    borderColor: '#f36b65',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  editDeleteText: {
    color: '#ef716d',
    fontSize: 20,
    fontWeight: '800',
  },
  editTimeAdjustRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  editTimeAdjustButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  editTimeAdjustText: {
    color: BRAND,
    fontSize: 12,
    fontWeight: '800',
  },
  editProjectPicker: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  editProjectPickerInput: {
    minHeight: 44,
    paddingHorizontal: 14,
    color: INK,
    fontSize: 14,
    fontWeight: '700',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  editProjectPickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  editProjectPickerName: {
    color: INK,
    fontSize: 13.5,
    fontWeight: '800',
  },
  editProjectPickerAddress: {
    marginTop: 2,
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  editProjectPickerEmpty: {
    padding: 14,
    color: MUTED,
    fontSize: 13,
    fontWeight: '700',
  },

  addTimeButton: {
    position: 'absolute',
    right: 16,
    bottom: 22,
    height: 50,
    paddingHorizontal: 20,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NAVY,
    ...Platform.select({
      web: { boxShadow: '0 6px 14px rgba(0,0,0,0.18)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      },
    }),
  },
  addTimeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  addDivider: {
    width: 1,
    height: 18,
    marginHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  addTimeIcon: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '500',
  },
});
