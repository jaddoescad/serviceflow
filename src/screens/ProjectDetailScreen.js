import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Alert,
  FlatList,
  Image,
  Modal,
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
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BudgetHoursPanel } from '../components/BudgetProgress';
import {
  getBudgetProgressPresentation,
  useProjectBudgetProgress,
} from '../lib/projectBudget';
import { buildPainterClockInSummaries } from '../lib/projectClockInSummary';
import { buildProjectClockInDays } from '../lib/timeTracking';
import ProjectLabourTasksPanel from '../components/ProjectLabourTasksPanel';
import ProjectCameraScreen from '../components/ProjectCameraScreen';
import JobPhotosPanel from './clock-in/JobPhotosPanel';
import OverBudgetReasonSheet from '../components/OverBudgetReasonSheet';
import { useProjectLabourTasks } from '../lib/useProjectLabourTasks';
import { getProjectId } from '../lib/projectRepository';
import {
  deleteProjectMedia,
  listProjectMedia,
} from '../lib/projectMedia';
import { useProjectMediaUploadQueue } from '../lib/useProjectMediaUploadQueue';
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

function isSameProject(a, b) {
  const aId = getProjectId(a);
  const bId = getProjectId(b);
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
  const projectId = getProjectId(project);
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

      if (!projectId || String(getProjectId(entry?.project)) !== String(projectId)) {
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

function getMediaCapturedAt(media) {
  const value = media?.captured_at || media?.created_at;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatMediaDayHeading(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return 'Recently';

  return date.toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatMediaTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return 'Recently';

  return date.toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildProjectMediaSections(media) {
  const orderedMedia = [...(media || [])].sort(
    (left, right) => getMediaCapturedAt(right) - getMediaCapturedAt(left),
  );
  const sectionsByDay = new Map();

  orderedMedia.forEach((item, index) => {
    const timestamp = getMediaCapturedAt(item);
    const date = timestamp ? new Date(timestamp) : null;
    const key = date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      : 'recent';

    if (!sectionsByDay.has(key)) {
      sectionsByDay.set(key, {
        key,
        title: formatMediaDayHeading(timestamp),
        items: [],
      });
    }
    sectionsByDay.get(key).items.push({ item, index });
  });

  return { orderedMedia, sections: [...sectionsByDay.values()] };
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
                key={getProjectId(projectOption)}
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
  initialAction = null,
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
  const projectKind = isLead ? 'lead' : 'job';
  const [activeTab, setActiveTab] = useState(() => (isLead ? 'photos' : 'clock'));
  const [selectedPainterId, setSelectedPainterId] = useState(null);
  const [selectedTimeEntry, setSelectedTimeEntry] = useState(null);
  const [projectMedia, setProjectMedia] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mediaDeletePending, setMediaDeletePending] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  // Opened from the clock-in screen with an intent: land on photos, and raise
  // the camera when that is what was asked for.
  useEffect(() => {
    if (!initialAction) return;
    setActiveTab('photos');
    if (initialAction === 'camera') setCameraOpen(true);
  }, [initialAction]);
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
  const jobId = getProjectId(project);
  const linkedLeadId = isLead ? null : project?.lead_id || null;
  const labourTasks = useProjectLabourTasks(jobId, {
    enabled: Boolean(jobId) && !isLead,
    userId: user?.id,
  });
  const budgetProjects = useMemo(() => (project ? [project] : []), [project]);
  const {
    progressByProjectId,
    error: budgetProgressError,
    refresh: refreshBudgetProgress,
  } = useProjectBudgetProgress(budgetProjects, { enabled: !isLead });
  const budgetProgress =
    progressByProjectId[String(jobId || '')] ||
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
  const isActiveProject = isSameProject(activeShift?.project, project) && !clockOutPending;
  const activeStartLabel =
    isActiveProject && activeShift?.startedAt ? formatEditTime(new Date(activeShift.startedAt)) : null;
  const activeElapsedLabel = isActiveProject ? formatElapsedClock(activeElapsedMs) : null;
  const primaryClockLabel = isActiveProject ? 'Clock Out' : activeShift ? 'Switch Job' : 'Clock In';
  const primaryClockIcon = isActiveProject ? 'stop-circle-outline' : activeShift ? 'swap-horizontal' : 'play';
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

  const mediaUploads = useProjectMediaUploadQueue({
    projectId: jobId,
    projectKind,
    onUploaded: (created, upload) => {
      if (
        String(upload?.projectId || '') !== String(jobId || '') ||
        upload?.projectKind !== projectKind
      ) return;
      setProjectMedia((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ]);
      setMediaError('');
      setMediaLoaded(true);
    },
  });
  const currentMediaUploadItems = useMemo(
    () => mediaUploads.items.filter((item) =>
      String(item.projectId || '') === String(jobId || '') &&
      item.projectKind === projectKind),
    [jobId, mediaUploads.items, projectKind],
  );
  const currentPendingMediaUploadItems = useMemo(
    () => currentMediaUploadItems.filter((item) => item.status !== 'uploaded'),
    [currentMediaUploadItems],
  );
  const currentMediaUploadCounts = useMemo(() => ({
    queued: currentMediaUploadItems.filter((item) => item.status === 'queued').length,
    uploading: currentMediaUploadItems.filter((item) => item.status === 'uploading').length,
    failed: currentMediaUploadItems.filter((item) => item.status === 'failed').length,
    total: currentMediaUploadItems.filter((item) => item.status !== 'uploaded').length,
  }), [currentMediaUploadItems]);

  const maybePromptJobOverBudget = async () => {
    try {
      if (!jobId || !user?.id) return;
      if (await hasAnsweredJobOverBudgetReason(user.id, jobId)) return;
      const { over, hoursOver } = await evaluateJobOverBudget(jobId);
      if (over) setJobReasonPrompt({ hoursOver });
    } catch (_error) {
      // The reason prompt is best effort; clock-out already succeeded.
    }
  };

  const refreshProjectMedia = useCallback(async () => {
    if (!jobId) {
      setMediaError('This job is missing its project id.');
      setMediaLoaded(true);
      return;
    }

    setMediaLoading(true);
    setMediaError('');
    try {
      const result = await listProjectMedia(jobId, { projectKind, linkedLeadId });
      if (result.error) {
        setProjectMedia([]);
        setMediaError(result.error.message || 'Unable to load project media.');
      } else {
        setProjectMedia(result.media);
      }
    } catch (error) {
      setProjectMedia([]);
      setMediaError(error?.message || 'Unable to load project media.');
    } finally {
      setMediaLoaded(true);
      setMediaLoading(false);
    }
  }, [jobId, linkedLeadId, projectKind]);

  useEffect(() => {
    setProjectMedia([]);
    setMediaError('');
    setMediaLoaded(false);
    setActiveTab(isLead ? 'photos' : 'clock');
  }, [isLead, jobId]);

  useEffect(() => {
    if (activeTab !== 'photos' || mediaLoaded) return;
    refreshProjectMedia();
  }, [activeTab, mediaLoaded, refreshProjectMedia]);

  const handleCaptureProjectPhoto = async () => {
    if (!jobId || mediaDeletePending) return;
    setMediaError('');
    setActiveTab('photos');
    if (Platform.OS === 'web') {
      try {
        const asset = await selectProjectMediaAsset({ source: 'camera', mediaKind: null });
        if (asset) mediaUploads.enqueue(asset);
      } catch (error) {
        Alert.alert('Camera', error?.message || 'Unable to open the camera.');
      }
      return;
    }
    mediaUploads.clearCompleted();
    setCameraOpen(true);
  };

  const handleDeleteProjectMedia = (media) => new Promise((resolve) => {
    Alert.alert(
      media?.media_type === 'video' ? 'Delete video?' : 'Delete photo?',
      'This permanently removes it from the project.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setMediaDeletePending(true);
            setMediaError('');
            try {
              await deleteProjectMedia(media?.id);
              setProjectMedia((current) => current.filter((item) => item.id !== media?.id));
              resolve(true);
            } catch (error) {
              const message = error?.message || 'Unable to delete this media.';
              setMediaError(message);
              Alert.alert('Delete failed', message);
              resolve(false);
            } finally {
              setMediaDeletePending(false);
            }
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

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
        {!isLead ? (
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
        ) : null}
        <TouchableOpacity
          style={[styles.tab, activeTab === 'photos' && styles.activeTab]}
          activeOpacity={0.85}
          accessibilityRole="tab"
          accessibilityLabel="Photos and videos"
          accessibilityState={{ selected: activeTab === 'photos' }}
          onPress={() => {
            setActiveTab('photos');
            setMediaLoaded(false);
          }}
        >
          <CameraGlyph color={activeTab === 'photos' ? '#fff' : BRAND} />
          <Text style={[styles.tabText, activeTab === 'photos' && styles.activeTabText]}>
            Media
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
        {!isLead && activeTab === 'clock' && !selectedPainter ? (
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

        {!isLead && activeTab === 'clock' ? (
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

              <View style={styles.photosPanelSlot}>
                <JobPhotosPanel
                  project={project}
                  showCamera={false}
                  onOpenAll={() => setActiveTab('photos')}
                />
              </View>

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
          <ProjectMediaPanel
            media={projectMedia}
            pendingItems={currentPendingMediaUploadItems}
            uploadCounts={currentMediaUploadCounts}
            loading={mediaLoading}
            error={mediaError}
            onRetry={refreshProjectMedia}
            onRetryUpload={mediaUploads.retry}
            onRetryAllUploads={mediaUploads.retryAll}
            onDiscardUpload={mediaUploads.discard}
            onDelete={handleDeleteProjectMedia}
            canDelete={(item) =>
              Boolean(item?.uploaded_by === user?.id || canViewTeamTime)
            }
          />
        )}
      </ScrollView>

      {!selectedPainter ? (
        <TouchableOpacity
          style={[
            styles.cameraFab,
            { bottom: insets.bottom + 22 },
            mediaDeletePending && styles.cameraFabDisabled,
          ]}
          activeOpacity={0.9}
          disabled={mediaDeletePending}
          accessibilityRole="button"
          accessibilityLabel="Take project photo"
          onPress={handleCaptureProjectPhoto}
        >
          {mediaDeletePending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="camera" size={28} color="#fff" />
          )}
        </TouchableOpacity>
      ) : null}

      <ProjectCameraScreen
        visible={cameraOpen}
        projectName={title}
        queueItems={currentMediaUploadItems}
        onRetryUpload={mediaUploads.retry}
        onCapture={(asset) => {
          mediaUploads.enqueue(asset);
          setMediaLoaded(true);
          setActiveTab('photos');
        }}
        onClose={() => {
          setCameraOpen(false);
          setActiveTab('photos');
        }}
      />

      {jobReasonPrompt ? (
        <OverBudgetReasonSheet
          task={{ title }}
          hoursOver={jobReasonPrompt.hoursOver}
          onSubmit={async ({ reason, note }) => {
            await submitJobOverBudgetReason({
              projectId: jobId,
              userId: user?.id,
              reason,
              note,
              hoursOver: jobReasonPrompt.hoursOver,
            });
            await markJobOverBudgetReasonAnswered(user?.id, jobId);
            setJobReasonPrompt(null);
          }}
          onSkip={async () => {
            await markJobOverBudgetReasonAnswered(user?.id, jobId);
            setJobReasonPrompt(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

async function selectProjectMediaAsset({ source, mediaKind }) {
  const useCamera = source === 'camera' && Platform.OS !== 'web';

  if (useCamera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== 'granted') {
      throw new Error(
        permission.canAskAgain === false
          ? 'Camera access is blocked. Enable it for ServiceFlow in device Settings.'
          : 'Camera access is required to capture project photos and videos.',
      );
    }
  } else if (Platform.OS === 'ios') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      throw new Error(
        permission.canAskAgain === false
          ? 'Photo library access is blocked. Enable it for ServiceFlow in device Settings.'
          : 'Photo library access is required to attach existing project media.',
      );
    }
  }

  const mediaTypes = mediaKind === 'image'
    ? ['images']
    : mediaKind === 'video'
      ? ['videos']
      : ['images', 'videos'];
  const options = {
    mediaTypes,
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 0.85,
    videoMaxDuration: 60,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    selectionLimit: 1,
  };
  const result = useCamera
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled) return null;
  return result.assets?.[0] || null;
}

function ProjectMediaPanel({
  media,
  pendingItems = [],
  uploadCounts,
  loading,
  error,
  onRetry,
  onRetryUpload,
  onRetryAllUploads,
  onDiscardUpload,
  onDelete,
  canDelete,
}) {
  const [selectedMediaId, setSelectedMediaId] = useState(null);
  const orderedMedia = useMemo(
    () => [...(media || [])].sort(
      (left, right) => getMediaCapturedAt(right) - getMediaCapturedAt(left),
    ),
    [media],
  );
  const selectedMediaIndex = useMemo(() => {
    if (selectedMediaId === null) return null;
    const index = orderedMedia.findIndex((item) => item.id === selectedMediaId);
    return index >= 0 ? index : null;
  }, [orderedMedia, selectedMediaId]);
  const pendingMedia = useMemo(
    () => pendingItems.map((item) => ({
      id: item.localId,
      local_id: item.localId,
      local_uri: item.asset?.uri,
      media_type: item.kind === 'video' ? 'video' : 'image',
      captured_at: item.capturedAt,
      created_at: item.capturedAt,
      upload_status: item.status,
      upload_error: item.error,
      is_pending_upload: true,
    })),
    [pendingItems],
  );
  const { sections } = useMemo(
    () => buildProjectMediaSections([...pendingMedia, ...(media || [])]),
    [media, pendingMedia],
  );

  useEffect(() => {
    if (selectedMediaId !== null && selectedMediaIndex === null) setSelectedMediaId(null);
  }, [selectedMediaId, selectedMediaIndex]);

  return (
    <View style={styles.photosSection}>
      {uploadCounts?.total ? (
        <View style={[
          styles.mediaUploadStatus,
          uploadCounts.failed > 0 && styles.mediaUploadStatusFailed,
        ]}>
          {uploadCounts.failed > 0 ? (
            <Ionicons name="alert-circle" size={18} color="#a6402d" />
          ) : (
            <ActivityIndicator size="small" color={BRAND} />
          )}
          <View style={styles.mediaUploadStatusCopy}>
            <Text style={styles.mediaUploadStatusText}>
              {uploadCounts.failed > 0
                ? `${uploadCounts.failed} upload${uploadCounts.failed === 1 ? '' : 's'} need attention`
                : `Uploading ${uploadCounts.total} item${uploadCounts.total === 1 ? '' : 's'}`}
            </Text>
            <Text style={styles.mediaUploadStatusHint}>
              Uploads continue after you close the camera.
            </Text>
          </View>
          {uploadCounts.failed > 0 ? (
            <TouchableOpacity activeOpacity={0.8} onPress={onRetryAllUploads}>
              <Text style={styles.retryText}>Retry all</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <View style={styles.mediaInlineError}>
          <Ionicons name="alert-circle-outline" size={20} color="#a6402d" />
          <Text style={styles.mediaInlineErrorText}>{error}</Text>
          <TouchableOpacity activeOpacity={0.8} onPress={onRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading && !media.length ? (
        <View style={styles.photosLoading}>
          <ActivityIndicator color={BRAND} />
          <Text style={styles.photosLoadingText}>Loading project media</Text>
        </View>
      ) : null}

      {!loading && !media.length && !pendingItems.length ? (
        <View style={styles.photosNotice}>
          <View style={styles.emptyArt}>
            <View style={styles.artCircle} />
            <CameraGlyph color={BRAND} />
          </View>
          <Text style={styles.emptyTitle}>No photos or videos yet</Text>
          <Text style={styles.emptyHint}>
            Capture the site before, during, and after the work to build the project record.
          </Text>
        </View>
      ) : null}

      {media.length || pendingItems.length ? (
        <>
          <View style={styles.photosHeader}>
            <View>
              <Text style={styles.photosEyebrow}>PROJECT RECORD</Text>
              <Text style={styles.photosTitle}>Photos & Videos</Text>
            </View>
            <View style={styles.photosCountPill}>
              <Text style={styles.photosCount}>{media.length + pendingItems.length}</Text>
            </View>
          </View>
          {sections.map((section) => (
            <View key={section.key} style={styles.mediaDaySection}>
              <View style={styles.mediaDayHeader}>
                <Text style={styles.mediaDayTitle}>{section.title}</Text>
                <Text style={styles.mediaDayCount}>{section.items.length}</Text>
              </View>
              <View style={styles.photoGrid}>
                {section.items.map(({ item }) => {
                  const pending = item.is_pending_upload === true;
                  const remoteIndex = pending
                    ? -1
                    : orderedMedia.findIndex((mediaItem) => mediaItem.id === item.id);
                  return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.photoCard, pending && styles.photoCardPending]}
                    activeOpacity={0.9}
                    accessibilityRole="button"
                    accessibilityLabel={pending
                      ? `${item.media_type === 'video' ? 'Video' : 'Photo'} ${item.upload_status}`
                      : `Open ${item.media_type === 'video' ? 'video' : 'photo'}`}
                    onPress={() => {
                      if (pending) {
                        if (item.upload_status === 'failed') onRetryUpload?.(item.local_id);
                        return;
                      }
                      if (remoteIndex >= 0) setSelectedMediaId(item.id);
                    }}
                    onLongPress={() => {
                      if (!pending) return;
                      Alert.alert(
                        'Remove pending upload?',
                        'This removes the local capture from the upload queue.',
                        [
                          { text: 'Keep', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => onDiscardUpload?.(item.local_id) },
                        ],
                      );
                    }}
                  >
                    {item.media_type === 'video' ? (
                      pending ? (
                        <View style={[styles.photoImage, styles.videoGridTile]}>
                          <View style={styles.videoPlayCircle}>
                            <Ionicons name="play" size={24} color="#fff" />
                          </View>
                        </View>
                      ) : (
                        <VideoThumbnail media={item} style={styles.photoImage} />
                      )
                    ) : (
                      pending ? (
                        <Image
                            source={{ uri: item.local_uri }}
                            style={styles.photoImage}
                            resizeMode="cover"
                            resizeMethod="resize"
                          />
                      ) : (
                        <PrivateMediaImage media={item} style={styles.photoImage} resizeMode="cover" thumbnail />
                      )
                    )}
                    {pending ? (
                      <View style={[
                        styles.pendingMediaOverlay,
                        item.upload_status === 'failed' && styles.pendingMediaOverlayFailed,
                      ]}>
                        {item.upload_status === 'failed' ? (
                          <Ionicons name="refresh" size={20} color="#fff" />
                        ) : (
                          <ActivityIndicator size="small" color="#fff" />
                        )}
                        <Text style={styles.pendingMediaText}>
                          {item.upload_status === 'failed' ? 'Tap to retry' : 'Uploading'}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.mediaCardMeta}>
                      <Ionicons
                        name={item.media_type === 'video' ? 'videocam-outline' : 'camera-outline'}
                        size={13}
                        color={MUTED}
                      />
                      <Text style={styles.mediaCardMetaText} numberOfLines={1}>
                        {pending
                          ? item.upload_status === 'failed' ? 'Upload failed' : 'Just captured'
                          : formatMediaTime(item.captured_at || item.created_at)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
          <MediaLightbox
            media={orderedMedia}
            selectedIndex={selectedMediaIndex}
            onClose={() => setSelectedMediaId(null)}
            onDelete={onDelete}
            canDelete={canDelete}
          />
        </>
      ) : null}
    </View>
  );
}

function usePrivateMediaUri(media) {
  const [webUri, setWebUri] = useState(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !media?.url) return undefined;

    const controller = new AbortController();
    let objectUrl = null;
    fetch(media.url, { headers: media.headers, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Media request failed (${response.status})`);
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setWebUri(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setWebUri(null);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media?.headers?.Authorization, media?.id, media?.url]);

  return Platform.OS === 'web' ? webUri : media?.url;
}

function VideoThumbnail({ media, style }) {
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => {
    if (!media?.thumbnailUrl) return null;
    return Platform.OS === 'web'
      ? { uri: media.thumbnailUrl }
      : { uri: media.thumbnailUrl, headers: media.headers };
  }, [media?.headers, media?.thumbnailUrl]);

  return (
    <View style={[style, styles.videoGridTile]}>
      {source && !failed ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          // Older videos, or ones the transformer cannot read, keep the tile.
          onError={() => setFailed(true)}
        />
      ) : null}
      <View style={styles.videoPlayCircle}>
        <Ionicons name="play" size={24} color="#fff" />
      </View>
    </View>
  );
}

function PrivateMediaImage({ media, style, resizeMode = 'contain', thumbnail = false }) {
  const uri = usePrivateMediaUri(media);
  if (!uri) {
    return (
      <View style={[style, styles.privateMediaLoading]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  const source = Platform.OS === 'web'
    ? { uri }
    : { uri, headers: media?.headers };
  return (
    <Image
      source={source}
      style={style}
      resizeMode={resizeMode}
      // Android decodes at full resolution by default. Job photos are up to
      // 3000px wide, so a grid of them stalls scrolling and quietly fails to
      // render once memory runs short; "resize" decodes to the display size.
      resizeMethod={thumbnail ? 'resize' : 'auto'}
    />
  );
}

function PrivateMediaVideo({ media, style }) {
  const uri = usePrivateMediaUri(media);
  const source = useMemo(() => {
    if (!uri) return null;
    return Platform.OS === 'web' ? uri : { uri, headers: media?.headers };
  }, [media?.headers, uri]);
  const player = useVideoPlayer(source, (nextPlayer) => {
    nextPlayer.loop = false;
  });

  if (!uri) {
    return (
      <View style={[style, styles.privateMediaLoading]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <VideoView
      style={style}
      player={player}
      nativeControls
      contentFit="contain"
      playsInline
      allowsFullscreen
    />
  );
}

const MAX_VIEWER_ZOOM = 4;

// Pinch-to-zoom without react-native-gesture-handler, which this project does
// not carry. Two fingers scale around the pinch midpoint; one finger pans once
// zoomed in. Releasing below 1x springs back and hands paging control back to
// the pager.
function ZoomableMedia({ children, onZoomChange, pageWidth, pageHeight }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Gesture bookkeeping is a ref, not state: it updates every frame and must
  // not re-render the page while a pinch is in flight.
  const g = useRef({
    scale: 1,
    lastScale: 1,
    startDistance: 0,
    tx: 0,
    ty: 0,
    lastTx: 0,
    lastTy: 0,
  }).current;

  const reportZoom = useCallback(
    (zoomed) => {
      onZoomChange?.(zoomed);
    },
    [onZoomChange],
  );

  // Keep the image from being dragged off screen: at scale s the image
  // overflows by (s-1)/2 of each edge.
  const clampPan = useCallback(
    (value, extent, currentScale) => {
      const limit = Math.max(0, (extent * (currentScale - 1)) / 2);
      return Math.min(limit, Math.max(-limit, value));
    },
    [],
  );

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (event) =>
        event.nativeEvent.touches.length === 2 || g.scale > 1,
      onMoveShouldSetPanResponder: (event) =>
        event.nativeEvent.touches.length === 2 || g.scale > 1,
      // Claim two-finger gestures before the pager or the dismiss handler can.
      onMoveShouldSetPanResponderCapture: (event) =>
        event.nativeEvent.touches.length === 2,
      onPanResponderGrant: () => {
        g.startDistance = 0;
        g.lastScale = g.scale;
        g.lastTx = g.tx;
        g.lastTy = g.ty;
      },
      onPanResponderMove: (event, gesture) => {
        const touches = event.nativeEvent.touches;

        if (touches.length === 2) {
          const [a, b] = touches;
          const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (!g.startDistance) {
            g.startDistance = distance;
            return;
          }
          const next = Math.min(
            MAX_VIEWER_ZOOM,
            Math.max(1, g.lastScale * (distance / g.startDistance)),
          );
          g.scale = next;
          scale.setValue(next);

          // Re-clamp the pan as the image shrinks, or it can end up offset
          // with empty space showing.
          g.tx = clampPan(g.lastTx, pageWidth, next);
          g.ty = clampPan(g.lastTy, pageHeight, next);
          translateX.setValue(g.tx);
          translateY.setValue(g.ty);
          return;
        }

        if (g.scale > 1) {
          g.tx = clampPan(g.lastTx + gesture.dx, pageWidth, g.scale);
          g.ty = clampPan(g.lastTy + gesture.dy, pageHeight, g.scale);
          translateX.setValue(g.tx);
          translateY.setValue(g.ty);
        }
      },
      onPanResponderRelease: () => {
        g.startDistance = 0;
        if (g.scale <= 1.01) {
          g.scale = 1;
          g.tx = 0;
          g.ty = 0;
          g.lastScale = 1;
          g.lastTx = 0;
          g.lastTy = 0;
          Animated.parallel([
            Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 0 }),
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }),
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }),
          ]).start();
          reportZoom(false);
          return;
        }
        g.lastScale = g.scale;
        g.lastTx = g.tx;
        g.lastTy = g.ty;
        reportZoom(true);
      },
      onPanResponderTerminationRequest: () => g.scale <= 1,
    }),
  ).current;

  return (
    <Animated.View
      style={{ transform: [{ scale }, { translateX }, { translateY }] }}
      {...responder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

function MediaLightbox({ media, selectedIndex, onClose, onDelete, canDelete }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(selectedIndex ?? 0);
  const [deleting, setDeleting] = useState(false);
  const visible = selectedIndex !== null;
  const viewerTopInset = Math.max(insets.top, 16) + 10;
  const viewerPageHeight = Math.max(0, height - viewerTopInset - insets.bottom - 84);
  const closeViewer = onClose;

  useEffect(() => {
    if (visible) setCurrentIndex(selectedIndex ?? 0);
  }, [selectedIndex, visible]);

  // Swipe down to dismiss, like the stock photo viewer. The pages scroll
  // horizontally, so only a clearly vertical drag is claimed.
  const dismissY = useRef(new Animated.Value(0)).current;
  const closeViewerRef = useRef(closeViewer);
  closeViewerRef.current = closeViewer;

  // While a photo is zoomed in, dragging pans the photo rather than paging to
  // the next one or dismissing the viewer.
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);
  const handleZoomChange = useCallback((isZoomed) => {
    zoomedRef.current = isZoomed;
    setZoomed(isZoomed);
  }, []);

  useEffect(() => {
    if (visible) dismissY.setValue(0);
  }, [dismissY, visible]);

  const dismissResponder = useRef(
    PanResponder.create({
      // Capture phase: the pages scroll horizontally, and the scroll view claims
      // the touch first otherwise, so a downward drag never reached us.
      onMoveShouldSetPanResponderCapture: (event, gesture) =>
        // Never claim a pinch, and never fight a pan on a zoomed-in photo.
        event.nativeEvent.touches.length === 1 &&
        !zoomedRef.current &&
        gesture.dy > 10 &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
      onPanResponderMove: (_event, gesture) => {
        dismissY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > 140 || gesture.vy > 0.8) {
          Animated.timing(dismissY, {
            toValue: 900,
            duration: 180,
            useNativeDriver: true,
          }).start(() => closeViewerRef.current?.());
        } else {
          Animated.spring(dismissY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dismissY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    }),
  ).current;

  if (!visible) return null;
  const currentMedia = media[currentIndex] || null;
  const canDeleteCurrent = Boolean(currentMedia && canDelete?.(currentMedia));

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeViewer}
    >
      <Animated.View
        style={[
          styles.viewerBackdrop,
          {
            // The media follows the finger, shrinking and fading as it goes,
            // the way the iOS photo viewer does.
            opacity: dismissY.interpolate({
              inputRange: [0, 320],
              outputRange: [1, 0.25],
              extrapolate: "clamp",
            }),
            transform: [
              { translateY: dismissY },
              {
                scale: dismissY.interpolate({
                  inputRange: [0, 320],
                  outputRange: [1, 0.88],
                  extrapolate: "clamp",
                }),
              },
            ],
          },
        ]}
        {...dismissResponder.panHandlers}
      >
        <StatusBar style="light" backgroundColor="#050607" />
        <View
          style={[
            styles.viewer,
            {
              paddingTop: viewerTopInset,
              paddingBottom: insets.bottom,
            },
          ]}
          accessibilityViewIsModal
          onAccessibilityEscape={closeViewer}
        >
          <View style={styles.viewerTopBar}>
            <TouchableOpacity
              style={styles.viewerCloseButton}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Close media viewer"
              hitSlop={8}
              onPress={closeViewer}
            >
              <Ionicons name="close" size={24} color="#ffffff" />
              <Text style={styles.viewerCloseText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.viewerCounter}>
              {currentMedia?.media_type === 'video' ? 'Video' : 'Photo'} {currentIndex + 1} / {media.length}
            </Text>
            {canDeleteCurrent ? (
              <TouchableOpacity
                style={styles.viewerDeleteButton}
                activeOpacity={0.8}
                disabled={deleting}
                accessibilityRole="button"
                accessibilityLabel="Delete media"
                onPress={async () => {
                  setDeleting(true);
                  const deleted = await onDelete?.(currentMedia);
                  setDeleting(false);
                  if (deleted) closeViewer();
                }}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="trash-outline" size={21} color="#fff" />
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.viewerTopSpacer} />
            )}
          </View>

          <FlatList
            key={`${selectedIndex}-${width}`}
            style={styles.viewerPages}
            data={media}
            horizontal
            pagingEnabled
            initialScrollIndex={Math.max(0, selectedIndex ?? 0)}
            getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
            keyExtractor={(item) => item.id}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!zoomed}
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
              setCurrentIndex(Math.max(0, Math.min(media.length - 1, nextIndex)));
            }}
            renderItem={({ item, index }) => (
              <View
                style={[styles.viewerSlide, { width, height: viewerPageHeight }]}
              >
                {item.media_type === 'video' ? (
                  index === currentIndex ? (
                    <PrivateMediaVideo media={item} style={styles.viewerImage} />
                  ) : (
                    <View style={[styles.viewerImage, styles.videoViewerPlaceholder]}>
                      <Ionicons name="videocam" size={42} color="#fff" />
                    </View>
                  )
                ) : (
                  <ZoomableMedia
                    onZoomChange={index === currentIndex ? handleZoomChange : undefined}
                    pageWidth={width}
                    pageHeight={viewerPageHeight}
                  >
                    <PrivateMediaImage media={item} style={styles.viewerImage} />
                  </ZoomableMedia>
                )}
              </View>
            )}
          />
          <View style={styles.viewerCaptionBar}>
            <Ionicons
              name={currentMedia?.media_type === 'video' ? 'videocam-outline' : 'camera-outline'}
              size={15}
              color="rgba(255,255,255,0.7)"
            />
            <Text style={styles.viewerCaptionText}>
              {formatMediaDayHeading(currentMedia?.captured_at || currentMedia?.created_at)} · {formatMediaTime(currentMedia?.captured_at || currentMedia?.created_at)}
            </Text>
          </View>
        </View>
      </Animated.View>
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
  mediaUploadStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: '#eaf4f6',
  },
  mediaUploadStatusFailed: {
    backgroundColor: '#fbecea',
  },
  mediaUploadStatusCopy: {
    flex: 1,
    minWidth: 0,
  },
  mediaUploadStatusText: {
    color: BRAND,
    fontSize: 12,
    fontWeight: '800',
  },
  mediaUploadStatusHint: {
    marginTop: 2,
    color: MUTED,
    fontSize: 10.5,
    fontWeight: '600',
  },
  mediaInlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fbecea',
  },
  mediaInlineErrorText: {
    flex: 1,
    color: '#873523',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  photosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  photosEyebrow: {
    color: BRAND,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  photosTitle: {
    marginTop: 2,
    color: INK,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  photosCountPill: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf4f5',
  },
  photosCount: {
    color: BRAND,
    fontSize: 13,
    fontWeight: '900',
  },
  mediaDaySection: {
    marginBottom: 24,
  },
  mediaDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#dfe5e8',
  },
  mediaDayTitle: {
    flex: 1,
    color: NAVY,
    fontSize: 15,
    fontWeight: '900',
  },
  mediaDayCount: {
    marginLeft: 12,
    color: MUTED,
    fontSize: 12,
    fontWeight: '700',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  photoCard: {
    width: '31.5%',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 11,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  photoCardPending: {
    borderColor: '#b9d9df',
  },
  photoImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: SOFT,
  },
  privateMediaLoading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoGridTile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NAVY,
  },
  videoPlayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  mediaCardMeta: {
    minHeight: 29,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    backgroundColor: '#fff',
  },
  mediaCardMetaText: {
    flex: 1,
    color: MUTED,
    fontSize: 8.5,
    fontWeight: '700',
  },
  pendingMediaOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(19,45,51,0.5)',
  },
  pendingMediaOverlayFailed: {
    backgroundColor: 'rgba(137,49,36,0.72)',
  },
  pendingMediaText: {
    color: '#fff',
    fontSize: 8.5,
    fontWeight: '900',
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
  viewerDeleteButton: {
    width: 68,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  videoViewerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101820',
  },
  viewerCaptionBar: {
    height: 30,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#050607',
  },
  viewerCaptionText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '700',
  },

  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  photosPanelSlot: { marginTop: 16, marginBottom: 4 },
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
    fontWeight: '650',
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

  cameraFab: {
    position: 'absolute',
    right: 16,
    bottom: 22,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND,
    ...Platform.select({
      web: { boxShadow: '0 6px 14px rgba(0,0,0,0.2)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      },
    }),
  },
  cameraFabDisabled: {
    opacity: 0.65,
  },
});
