import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

const BRAND = '#2b8496';
const NAVY = '#31495d';
const INK = '#1f2933';
const TEXT = '#2f3136';
const MUTED = '#8a8f95';
const SUBTLE = '#b8bcc1';
const BORDER = '#e6e8eb';
const SOFT = '#f6f8f9';
const TILE_BG = '#ffffff';

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
  return (
    <View style={styles.pinGlyph}>
      <View style={[styles.pinDrop, { backgroundColor: color }]} />
      <View style={[styles.pinDot]} />
    </View>
  );
}

function ClockGlyph({ color = '#fff', size = 16 }) {
  const ring = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 1.6,
    borderColor: color,
  };
  return (
    <View style={[ring, styles.glyphCenter]}>
      <View style={[styles.clockHandV, { backgroundColor: color, height: size * 0.34 }]} />
      <View style={[styles.clockHandH, { backgroundColor: color, width: size * 0.26 }]} />
    </View>
  );
}

function CameraGlyph({ color = BRAND }) {
  return (
    <View style={styles.cameraGlyph}>
      <View style={[styles.cameraBody, { borderColor: color }]}>
        <View style={[styles.cameraLens, { borderColor: color }]} />
      </View>
      <View style={[styles.cameraBump, { backgroundColor: color }]} />
    </View>
  );
}

function PlayGlyph() {
  return <View style={styles.playTriangle} />;
}

export default function ProjectDetailScreen({ project, onBack }) {
  const [activeTab, setActiveTab] = useState('clock');
  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [photosError, setPhotosError] = useState('');

  const title = getProjectTitle(project);
  const companyCamProjectId = getCompanyCamProjectId(project);
  const address = getProjectAddress(project);
  const addedDate = formatDate(
    firstValue([project?.created_at, project?.added_at, project?.inserted_at]),
  );
  const yourHours = formatHours(
    firstValue([project?.your_hours, project?.user_hours, project?.my_hours], 0),
  );
  const teamHoursRaw =
    toNumericHours(
      firstValue([project?.team_hours, project?.total_hours, project?.crew_hours], null),
    ) ?? 0;
  const budgetHoursRaw = toNumericHours(
    firstValue(
      [project?.budgeted_hours, project?.estimated_hours, project?.budget_hours],
      null,
    ),
  );
  const teamHours = `${teamHoursRaw.toFixed(1)}h`;
  const budgetedHours =
    budgetHoursRaw === null ? 'Not set' : `${budgetHoursRaw.toFixed(1)}h`;

  let budgetStatus = null;
  if (budgetHoursRaw !== null && teamHoursRaw > budgetHoursRaw) {
    budgetStatus = {
      kind: 'over',
      label: `Over by ${(teamHoursRaw - budgetHoursRaw).toFixed(1)}h`,
      bg: '#fdecea',
      color: '#c0432b',
      dot: '#d7553b',
    };
  } else if (budgetHoursRaw !== null) {
    budgetStatus = {
      kind: 'under',
      label: `${(budgetHoursRaw - teamHoursRaw).toFixed(1)}h remaining`,
      bg: '#e6f2f4',
      color: BRAND,
      dot: BRAND,
    };
  }

  useEffect(() => {
    if (activeTab !== 'photos' || photosLoaded) return;

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
  }, [activeTab, companyCamProjectId, photosLoaded]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <View style={styles.chevron} />
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
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'clock' ? (
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
          <>
            <View style={styles.hoursGrid}>
              <View style={[styles.hourCard, styles.youCard]}>
                <View style={[styles.hourBadge, { backgroundColor: '#eaf4f6' }]}>
                  <Text style={[styles.hourBadgeText, { color: BRAND }]}>You</Text>
                </View>
                <Text style={styles.hourValue}>{yourHours}</Text>
                <Text style={styles.hourLabel}>Your hours</Text>
              </View>

              <View style={[styles.hourCard, styles.comboCard]}>
                <View style={styles.comboStats}>
                  <View style={styles.comboStat}>
                    <Text style={styles.comboKicker}>Team</Text>
                    <Text style={[styles.hourValue, styles.comboValue]}>{teamHours}</Text>
                    <Text style={styles.hourLabel}>Total hours</Text>
                  </View>
                  <View style={styles.comboDivider} />
                  <View style={styles.comboStat}>
                    <Text style={styles.comboKicker}>Budget</Text>
                    <Text style={[styles.hourValue, styles.comboValue]}>{budgetedHours}</Text>
                    <Text style={styles.hourLabel}>Budgeted</Text>
                  </View>
                </View>

                {budgetStatus ? (
                  <View style={[styles.statusPill, { backgroundColor: budgetStatus.bg }]}>
                    <View style={[styles.statusDot, { backgroundColor: budgetStatus.dot }]} />
                    <Text style={[styles.statusText, { color: budgetStatus.color }]}>
                      {budgetStatus.label}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <TouchableOpacity style={styles.clockButton} activeOpacity={0.9}>
              <View style={styles.clockIconCircle}>
                <PlayGlyph />
              </View>
              <Text style={styles.clockButtonText}>Clock In</Text>
            </TouchableOpacity>

            <View style={styles.emptyState}>
              <View style={styles.emptyArt}>
                <View style={styles.artCircle} />
                <ClockGlyph color={BRAND} size={44} />
              </View>
              <Text style={styles.emptyTitle}>No clock-ins yet</Text>
              <Text style={styles.emptyHint}>
                Tap Clock In to start tracking time on this job.
              </Text>
            </View>
          </>
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

      {activeTab === 'clock' ? (
        <TouchableOpacity style={styles.addTimeButton} activeOpacity={0.9}>
          <Text style={styles.addTimeText}>Add Time</Text>
          <View style={styles.addDivider} />
          <Text style={styles.addTimeIcon}>+</Text>
        </TouchableOpacity>
      ) : null}
    </SafeAreaView>
  );
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
  const { width, height } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(selectedIndex ?? 0);
  const visible = selectedIndex !== null;

  useEffect(() => {
    if (!visible) return undefined;

    const nextIndex = selectedIndex ?? 0;
    setCurrentIndex(nextIndex);

    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: nextIndex * width, animated: false });
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedIndex, visible, width]);

  if (!visible) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.viewer}>
        <View style={styles.viewerTopBar}>
          <TouchableOpacity style={styles.viewerCloseButton} activeOpacity={0.8} onPress={onClose}>
            <Text style={styles.viewerCloseText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.viewerCounter}>
            Picture {currentIndex + 1} / {photos.length}
          </Text>
          <View style={styles.viewerTopSpacer} />
        </View>

        <ScrollView
          ref={scrollRef}
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
              style={[styles.viewerSlide, { width, minHeight: Math.max(0, height - 120) }]}
            >
              <Image
                source={{ uri: photo.url || photo.thumbnailUrl }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
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

  hoursGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    alignItems: 'stretch',
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
  statusPill: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
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
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
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
  viewerSlide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  viewerImage: {
    width: '100%',
    height: '100%',
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
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
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
