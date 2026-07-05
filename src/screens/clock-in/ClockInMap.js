import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { distanceMeters } from "../../lib/trackingModel";

const COLORS = {
  green: "#173f37",
  teal: "#2f8d7f",
  navy: "#31495d",
  white: "#ffffff",
  ink: "#11201d",
  muted: "#8b9692",
  border: "#e0e3e1",
};

const OTTAWA_REGION = {
  latitude: 45.4215,
  longitude: -75.6972,
  latitudeDelta: 0.035,
  longitudeDelta: 0.035,
};

// Name-label overlay geometry. Labels are plain views floating above the pins,
// not markers, so they are immune to the marker bugs. pointForCoordinate gives
// the pin's screen point (the teardrop tip); we center the pill this far above.
const PROJECT_LABEL_WIDTH = 168;
const PROJECT_LABEL_OFFSET_Y = 66;

export default function ClockInMap({
  project,
  projects,
  currentPoint,
  onSelectProject,
  onDismissSearch,
  onRequestLocation,
  bottomInset = 0,
}) {
  const mapRef = useRef(null);
  const didSetInitialRegionRef = useRef(false);
  const [resolvedSelectedProject, setResolvedSelectedProject] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const currentProjectId = getProjectId(project);
  const resolvedProjectId = getProjectId(resolvedSelectedProject);
  const selectedProjectForMap =
    currentProjectId && currentProjectId === resolvedProjectId ? resolvedSelectedProject : project;
  const projectMarkers = buildProjectMarkers(projects, selectedProjectForMap);
  const selectedMarker = projectMarkers.find((marker) => marker.isSelected);
  const selectedJobCoordinate = selectedMarker?.coordinate || projectCoordinate(selectedProjectForMap);
  const userCoordinate = toCoordinate(currentPoint);
  const region = buildMapRegion(selectedJobCoordinate, userCoordinate);

  // A stable onPress identity so the memoized pins are never re-committed to the
  // native map just because this callback prop got a new reference.
  const onSelectRef = useRef(onSelectProject);
  onSelectRef.current = onSelectProject;
  const onDismissSearchRef = useRef(onDismissSearch);
  onDismissSearchRef.current = onDismissSearch;
  const handleSelectProject = useCallback((selected) => {
    onDismissSearchRef.current?.();
    onSelectRef.current?.(selected);
  }, []);

  // Name-label overlay state. Labels are recomputed (via the map's native
  // projection) whenever the marker set or the settled region changes, and are
  // hidden mid-gesture so they never lag behind the map.
  const [mapReady, setMapReady] = useState(false);
  const [nativeMapReady, setNativeMapReady] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [regionTick, setRegionTick] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [labelPoints, setLabelPoints] = useState([]);
  const selectedLabelId = selectedMarker?.id || null;
  const markerKey = projectMarkers
    .map((marker) => `${marker.id}:${marker.coordinate.latitude.toFixed(5)},${marker.coordinate.longitude.toFixed(5)}`)
    .join("|");

  const recenterMap = async () => {
    if (locating) return;
    setLocating(true);
    setLocationError("");
    try {
      const freshCoordinate = toCoordinate(await onRequestLocation?.());
      const targetCoordinate = freshCoordinate || userCoordinate;
      if (!targetCoordinate) {
        setLocationError("Location unavailable. Enable location access and try again.");
      }
      const targetRegion = targetCoordinate
        ? {
            latitude: targetCoordinate.latitude,
            longitude: targetCoordinate.longitude,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          }
        : region;

      mapRef.current?.animateToRegion(targetRegion, 350);
    } catch (_error) {
      setLocationError("Could not get your location. Try again.");
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (didSetInitialRegionRef.current) return;
    if (!selectedJobCoordinate && !userCoordinate) return;
    didSetInitialRegionRef.current = true;
    mapRef.current?.animateToRegion(region, 250);
  }, [region, selectedJobCoordinate, userCoordinate]);

  useEffect(() => {
    let cancelled = false;

    async function resolveSelectedProjectCoordinate() {
      if (!project || projectCoordinate(project)) {
        setResolvedSelectedProject(null);
        return;
      }

      const matchingProject = (projects || []).find(
        (candidate) => getProjectId(candidate) === currentProjectId && projectCoordinate(candidate),
      );
      if (matchingProject) {
        setResolvedSelectedProject(matchingProject);
        return;
      }

      const address = formatProjectAddress(project);
      if (!address) {
        setResolvedSelectedProject(null);
        return;
      }

      try {
        const results = await Location.geocodeAsync(address);
        const coordinate = toCoordinate(results?.[0]);
        if (!cancelled && coordinate) {
          setResolvedSelectedProject({ ...project, ...coordinate });
        }
      } catch (_error) {
        if (!cancelled) setResolvedSelectedProject(null);
      }
    }

    resolveSelectedProjectCoordinate();
    return () => {
      cancelled = true;
    };
  }, [currentProjectId, project?.formatted_address, project?.city, project?.state, project?.postal_code, projects]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || typeof map.pointForCoordinate !== "function" || !projectMarkers.length) {
      setLabelPoints([]);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const points = await Promise.all(
          projectMarkers.map(async (marker) => {
            try {
              const point = await map.pointForCoordinate(marker.coordinate);
              if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
              return { id: marker.id, name: marker.project?.name || "Project", x: point.x, y: point.y };
            } catch (_error) {
              return null;
            }
          }),
        );
        if (!cancelled) setLabelPoints(points.filter(Boolean));
      } catch (_error) {
        // Non-fatal: labels just stay as they were.
      }
    })();

    return () => {
      cancelled = true;
    };
    // markerKey covers the marker set; regionTick fires after each settled zoom/pan.
  }, [markerKey, mapReady, regionTick]);

  useEffect(() => {
    // iOS Apple Maps never fires onMapReady and may not emit a region-change on
    // first load, so force one label pass once the map has had a moment to
    // initialize. Harmless on Android, where the effect above already fires.
    const timeout = setTimeout(() => setRegionTick((tick) => tick + 1), 700);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (nativeMapReady) return undefined;
    const timeout = setTimeout(() => setMapUnavailable(true), 4500);
    return () => clearTimeout(timeout);
  }, [nativeMapReady]);

  return (
    <>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        mapType="standard"
        rotateEnabled={false}
        pitchEnabled={false}
        showsCompass={false}
        showsScale={false}
        showsBuildings
        showsUserLocation
        moveOnMarkerPress={false}
        onPress={() => onDismissSearchRef.current?.()}
        onLayout={() => setMapReady(true)}
        onMapReady={() => {
          setNativeMapReady(true);
          setMapUnavailable(false);
        }}
        onRegionChange={() => setShowLabels(false)}
        onRegionChangeComplete={() => {
          setShowLabels(true);
          setRegionTick((tick) => tick + 1);
        }}
      >
        {selectedJobCoordinate ? (
          <Circle
            center={selectedJobCoordinate}
            radius={150}
            strokeWidth={2}
            strokeColor="rgba(47,141,127,0.55)"
            fillColor="rgba(47,141,127,0.18)"
          />
        ) : null}

        {selectedJobCoordinate && userCoordinate ? (
          <>
            <Polyline
              coordinates={[userCoordinate, selectedJobCoordinate]}
              strokeColor="rgba(17,32,29,0.16)"
              strokeWidth={10}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={[userCoordinate, selectedJobCoordinate]}
              strokeColor="rgba(255,255,255,0.92)"
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={[userCoordinate, selectedJobCoordinate]}
              strokeColor={COLORS.teal}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
            />
          </>
        ) : null}

        {/* Native platform pins, each memoized so a pin is only re-committed to
            the native map when its OWN coordinate/color actually changes — never
            because the parent re-rendered (GPS tick, tap, zoom). That
            reconciliation churn is what makes react-native-maps drop markers on
            iOS during map gestures (issue #5911). */}
        {projectMarkers.map((marker) => (
          <ProjectPin key={`project-${marker.id}`} marker={marker} onSelect={handleSelectProject} />
        ))}
      </MapView>

      {/* Always-visible name labels: a non-interactive overlay (not markers), so
          they never hit the marker bugs. Positioned by the map's native
          projection and hidden while a gesture is in flight so they can't lag. */}
      {showLabels && labelPoints.length ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {labelPoints.map((label) => {
            const isSelected = label.id === selectedLabelId;
            return (
              <View
                key={`label-${label.id}`}
                style={[
                  styles.projectLabelWrap,
                  { left: label.x - PROJECT_LABEL_WIDTH / 2, top: label.y - PROJECT_LABEL_OFFSET_Y },
                ]}
              >
                <View style={[styles.projectLabel, isSelected && styles.projectLabelSelected]}>
                  <Text
                    numberOfLines={1}
                    style={[styles.projectLabelText, isSelected && styles.projectLabelTextSelected]}
                  >
                    {label.name}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {mapUnavailable ? (
        <View style={styles.mapUnavailable} pointerEvents="none">
          <Ionicons name="map-outline" size={22} color={COLORS.navy} />
          <View style={styles.mapUnavailableTextWrap}>
            <Text style={styles.mapUnavailableTitle}>Map is taking too long</Text>
            <Text style={styles.mapUnavailableText}>You can still choose a job and use location.</Text>
          </View>
        </View>
      ) : null}

      <View style={[styles.mapControls, { bottom: bottomInset + 110 }]} pointerEvents="box-none">
        {locationError ? (
          <View style={styles.mapNotice} pointerEvents="none">
            <Text style={styles.mapNoticeText}>{locationError}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recenter map on your location"
          disabled={locating}
          style={[styles.mapButton, locating && styles.mapButtonDisabled]}
          hitSlop={6}
          onPress={recenterMap}
        >
          {locating ? (
            <ActivityIndicator size="small" color={COLORS.teal} />
          ) : (
            <Ionicons name="locate" size={21} color={COLORS.teal} />
          )}
        </Pressable>
      </View>
    </>
  );
}

// A native map pin that NEVER changes after it mounts. On react-native-maps
// 1.20.1, updating any prop of a live marker (pinColor, zIndex, or even a new
// coordinate object) makes the native layer drop that marker — on both Google
// and Apple providers. So the pin has a constant color and the memo comparator
// deliberately ignores selection: tapping or re-rendering never re-commits a
// pin, so a pin can never disappear. Which job is selected is shown by the
// radius circle, the route line, and the job card — not by mutating the pin.
const ProjectPin = memo(
  function ProjectPin({ marker, onSelect }) {
    const project = marker.project;
    return (
      <Marker
        coordinate={marker.coordinate}
        pinColor={COLORS.navy}
        title={project?.name || "Project"}
        onPress={() => onSelect?.(project)}
      />
    );
  },
  (prev, next) =>
    prev.onSelect === next.onSelect &&
    prev.marker.id === next.marker.id &&
    prev.marker.coordinate.latitude === next.marker.coordinate.latitude &&
    prev.marker.coordinate.longitude === next.marker.coordinate.longitude,
);

export function toCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.coords?.latitude);
  const longitude = Number(value?.longitude ?? value?.coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export function findNearestProject(projects, currentPoint) {
  const userCoordinate = toCoordinate(currentPoint);
  if (!userCoordinate) return null;

  let nearest = null;
  for (const rawProject of projects || []) {
    if (!rawProject || rawProject.is_archived || rawProject.is_lead) continue;
    const coordinate = projectCoordinate(rawProject);
    if (!coordinate) continue;
    const distance = distanceMeters(userCoordinate, coordinate);
    if (distance == null) continue;
    if (!nearest || distance < nearest.distanceMeters) {
      nearest = { project: rawProject, distanceMeters: distance };
    }
  }

  return nearest;
}

export function formatProjectAddress(project) {
  if (!project) return "";
  return (
    project.formatted_address ||
    [project.city, project.state, project.postal_code].filter(Boolean).join(", ")
  );
}

function getProjectId(project) {
  return String(project?.companycam_id || project?.companycam_project_id || project?.id || "");
}

function projectCoordinate(project) {
  return toCoordinate(project);
}

function coordinateKey(coordinate) {
  return `${coordinate.latitude.toFixed(6)},${coordinate.longitude.toFixed(6)}`;
}

function buildProjectMarkers(projects, selectedProject) {
  const selectedProjectId = getProjectId(selectedProject);
  const seen = new Set();
  const markers = [];

  for (const rawProject of projects || []) {
    const coordinate = projectCoordinate(rawProject);
    if (!coordinate) continue;

    const projectId = getProjectId(rawProject) || coordinateKey(coordinate);
    if (seen.has(projectId)) continue;

    seen.add(projectId);
    markers.push({
      project: rawProject,
      coordinate,
      id: projectId,
      isSelected: Boolean(selectedProjectId && projectId === selectedProjectId),
    });
  }

  const selectedCoordinate = projectCoordinate(selectedProject);
  if (selectedProjectId && selectedCoordinate && !seen.has(selectedProjectId)) {
    markers.push({
      project: selectedProject,
      coordinate: selectedCoordinate,
      id: selectedProjectId,
      isSelected: true,
    });
  }

  return markers;
}

function buildMapRegion(projectPoint, currentPoint, projectPoints = []) {
  const points = [projectPoint, currentPoint, ...projectPoints].filter(Boolean);

  if (points.length > 1) {
    const latitudes = points.map((point) => point.latitude);
    const longitudes = points.map((point) => point.longitude);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);

    return {
      latitude: (minLatitude + maxLatitude) / 2,
      longitude: (minLongitude + maxLongitude) / 2,
      latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.35, 0.035),
      longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.35, 0.035),
    };
  }

  const point = points[0] || projectPoint;
  if (!point) return OTTAWA_REGION;

  return {
    latitude: point.latitude,
    longitude: point.longitude,
    latitudeDelta: 0.012,
    longitudeDelta: 0.012,
  };
}

const styles = StyleSheet.create({
  projectLabelWrap: {
    position: "absolute",
    width: PROJECT_LABEL_WIDTH,
    alignItems: "center",
  },
  projectLabel: {
    maxWidth: PROJECT_LABEL_WIDTH,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "rgba(224,227,225,0.95)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  projectLabelSelected: {
    backgroundColor: COLORS.navy,
    borderColor: "rgba(255,255,255,0.92)",
  },
  projectLabelText: {
    color: COLORS.ink,
    fontSize: 11.5,
    fontWeight: "800",
  },
  projectLabelTextSelected: {
    color: COLORS.white,
  },
  mapControls: {
    position: "absolute",
    right: 14,
    bottom: 110,
    alignItems: "flex-end",
    gap: 8,
  },
  mapUnavailable: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 18,
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(224,227,225,0.95)",
    backgroundColor: "rgba(255,255,255,0.96)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  mapUnavailableTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  mapUnavailableTitle: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  mapUnavailableText: {
    marginTop: 2,
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "700",
  },
  mapButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  mapButtonDisabled: {
    opacity: 0.6,
  },
  mapNotice: {
    maxWidth: 220,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  mapNoticeText: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
});
