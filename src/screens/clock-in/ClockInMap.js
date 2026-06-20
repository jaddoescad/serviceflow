import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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

const PROJECT_MARKER_SIZE = 30;
const PROJECT_MARKER_HIT_SIZE = 44;
const PROJECT_MARKER_STACK_WIDTH = 164;
const PROJECT_MARKER_SCREEN_BUFFER = 28;
const PROJECT_LABEL_MAX_DELTA = 0.18;
const PROJECT_LABEL_HIT_TOP_OFFSET = 54;
const PROJECT_LABEL_HIT_BOTTOM_OFFSET = 16;

export default function ClockInMap({ project, projects, currentPoint, onSelectProject, onRequestLocation }) {
  const mapRef = useRef(null);
  const didSetInitialRegionRef = useRef(false);
  const regionFrameRef = useRef(null);
  const pendingRegionRef = useRef(null);
  const [mapLayout, setMapLayout] = useState(null);
  const [visibleRegion, setVisibleRegion] = useState(null);
  const [resolvedSelectedProject, setResolvedSelectedProject] = useState(null);
  const currentProjectId = getProjectId(project);
  const resolvedProjectId = getProjectId(resolvedSelectedProject);
  const selectedProjectForMap =
    currentProjectId && currentProjectId === resolvedProjectId ? resolvedSelectedProject : project;
  const projectMarkers = useMemo(() => buildProjectMarkers(projects, selectedProjectForMap), [selectedProjectForMap, projects]);
  const selectedMarker = projectMarkers.find((marker) => marker.isSelected);
  const selectedJobCoordinate = selectedMarker?.coordinate || projectCoordinate(selectedProjectForMap);
  const userCoordinate = toCoordinate(currentPoint);
  const region = buildMapRegion(selectedJobCoordinate, userCoordinate);
  const showProjectLabels = shouldShowProjectLabels(visibleRegion);
  const overlayMarkers = useMemo(
    () => buildOverlayMarkers(projectMarkers, visibleRegion, mapLayout),
    [mapLayout, projectMarkers, visibleRegion],
  );

  const updateMapLayout = ({ nativeEvent }) => {
    const { width, height } = nativeEvent.layout || {};
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setMapLayout((currentLayout) => {
      if (currentLayout?.width === width && currentLayout?.height === height) return currentLayout;
      return { width, height };
    });
  };

  const queueVisibleRegion = (nextRegion) => {
    pendingRegionRef.current = nextRegion;
    if (regionFrameRef.current) return;

    regionFrameRef.current = requestAnimationFrame(() => {
      regionFrameRef.current = null;
      setVisibleRegion(pendingRegionRef.current);
    });
  };

  const selectOverlayMarkerFromMapPress = (event) => {
    const marker = findPressedOverlayMarker({
      event: event?.nativeEvent,
      layout: mapLayout,
      markers: overlayMarkers,
      region: visibleRegion,
      showLabels: showProjectLabels,
    });

    if (marker) onSelectProject?.(marker.project);
  };

  const recenterMap = async () => {
    const freshCoordinate = toCoordinate(await onRequestLocation?.());
    const targetCoordinate = freshCoordinate || userCoordinate;
    const targetRegion = targetCoordinate
      ? {
          latitude: targetCoordinate.latitude,
          longitude: targetCoordinate.longitude,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }
      : region;

    setVisibleRegion(targetRegion);
    mapRef.current?.animateToRegion(targetRegion, 350);
  };

  useEffect(() => {
    if (didSetInitialRegionRef.current) return;
    if (!selectedJobCoordinate && !userCoordinate) return;
    didSetInitialRegionRef.current = true;
    setVisibleRegion(region);
    mapRef.current?.animateToRegion(region, 250);
  }, [region, selectedJobCoordinate, userCoordinate]);

  useEffect(() => {
    return () => {
      if (regionFrameRef.current) cancelAnimationFrame(regionFrameRef.current);
    };
  }, []);

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
        loadingEnabled
        onLayout={updateMapLayout}
        onPress={selectOverlayMarkerFromMapPress}
        onRegionChange={queueVisibleRegion}
        onRegionChangeComplete={setVisibleRegion}
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

        {userCoordinate ? (
          <Marker coordinate={userCoordinate} title="Your location">
            <View style={styles.userMarkerOuter}>
              <View style={styles.userMarkerInner} />
            </View>
          </Marker>
        ) : null}
      </MapView>

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {overlayMarkers.map((marker) => (
          <Fragment key={`project-overlay-${marker.id}`}>
            {showProjectLabels || marker.isSelected ? (
              <View
                pointerEvents="none"
                style={[
                  styles.projectMarkerLabel,
                  marker.isSelected && styles.projectMarkerLabelSelected,
                  {
                    left: marker.point.x - PROJECT_MARKER_STACK_WIDTH / 2,
                    top: marker.point.y - 50,
                    zIndex: marker.isSelected ? 21 : 11,
                  },
                ]}
              >
                <Ionicons
                  name="briefcase"
                  size={11}
                  color={marker.isSelected ? COLORS.white : COLORS.teal}
                />
                <Text
                  style={[styles.projectMarkerLabelText, marker.isSelected && styles.projectMarkerLabelTextSelected]}
                  numberOfLines={1}
                >
                  {marker.project?.name || "Project"}
                </Text>
              </View>
            ) : null}
            <View
              style={[
                styles.projectMarkerButton,
                {
                  left: marker.point.x - PROJECT_MARKER_HIT_SIZE / 2,
                  top: marker.point.y - PROJECT_MARKER_HIT_SIZE / 2,
                  zIndex: marker.isSelected ? 20 : 10,
                },
              ]}
            >
              <View style={[styles.projectMarker, marker.isSelected && styles.projectMarkerSelected]}>
                <Ionicons name="location" size={18} color={COLORS.white} />
              </View>
            </View>
          </Fragment>
        ))}
      </View>

      <View style={styles.mapControls} pointerEvents="box-none">
        <Pressable style={styles.mapButton} hitSlop={6} onPress={recenterMap}>
          <Ionicons name="locate" size={21} color={COLORS.teal} />
        </Pressable>
      </View>
    </>
  );
}

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

function buildOverlayMarkers(markers, region, layout) {
  if (!region || !layout) return [];

  return markers
    .map((marker) => ({
      ...marker,
      point: coordinateToScreenPoint(marker.coordinate, region, layout),
    }))
    .filter((marker) => isVisiblePoint(marker.point, layout));
}

function coordinateToScreenPoint(coordinate, region, layout) {
  if (!coordinate || !region || !layout) return null;

  const west = region.longitude - region.longitudeDelta / 2;
  const east = region.longitude + region.longitudeDelta / 2;
  const north = region.latitude + region.latitudeDelta / 2;
  const south = region.latitude - region.latitudeDelta / 2;
  const longitudeSpan = east - west;
  const northMercator = latitudeToMercator(north);
  const southMercator = latitudeToMercator(south);
  const mercatorSpan = northMercator - southMercator;

  if (!Number.isFinite(longitudeSpan) || !Number.isFinite(mercatorSpan) || longitudeSpan <= 0 || mercatorSpan <= 0) {
    return null;
  }

  const x = ((coordinate.longitude - west) / longitudeSpan) * layout.width;
  const y = ((northMercator - latitudeToMercator(coordinate.latitude)) / mercatorSpan) * layout.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

function latitudeToMercator(latitude) {
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = (clampedLatitude * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function isVisiblePoint(point, layout) {
  if (!point) return false;
  return (
    point.x >= -PROJECT_MARKER_SCREEN_BUFFER &&
    point.x <= layout.width + PROJECT_MARKER_SCREEN_BUFFER &&
    point.y >= -PROJECT_MARKER_SCREEN_BUFFER &&
    point.y <= layout.height + PROJECT_MARKER_SCREEN_BUFFER
  );
}

function findPressedOverlayMarker({ event, markers, region, layout, showLabels }) {
  if (!markers?.length) return null;
  const point = toScreenPressPoint(event, region, layout);
  if (!point) return null;

  let closestMarker = null;
  let closestDistance = Infinity;

  for (const marker of markers) {
    if (!isPointInsideMarkerTapArea(point, marker, showLabels)) continue;
    const distance = screenDistance(point, marker.point);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMarker = marker;
    }
  }

  return closestMarker;
}

function toScreenPressPoint(event, region, layout) {
  const position = event?.position;
  if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
    return { x: position.x, y: position.y };
  }

  return coordinateToScreenPoint(toCoordinate(event?.coordinate), region, layout);
}

function isPointInsideMarkerTapArea(point, marker, showLabels) {
  const markerRadius = PROJECT_MARKER_HIT_SIZE / 2;
  const inMarker =
    Math.abs(point.x - marker.point.x) <= markerRadius &&
    Math.abs(point.y - marker.point.y) <= markerRadius;
  if (inMarker) return true;

  if (!showLabels && !marker.isSelected) return false;

  return (
    point.x >= marker.point.x - PROJECT_MARKER_STACK_WIDTH / 2 &&
    point.x <= marker.point.x + PROJECT_MARKER_STACK_WIDTH / 2 &&
    point.y >= marker.point.y - PROJECT_LABEL_HIT_TOP_OFFSET &&
    point.y <= marker.point.y - PROJECT_LABEL_HIT_BOTTOM_OFFSET
  );
}

function screenDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function shouldShowProjectLabels(region) {
  if (!region) return false;
  const zoomDelta = Math.max(region.latitudeDelta || 0, region.longitudeDelta || 0);
  return zoomDelta > 0 && zoomDelta <= PROJECT_LABEL_MAX_DELTA;
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
  projectMarkerButton: {
    position: "absolute",
    width: PROJECT_MARKER_HIT_SIZE,
    height: PROJECT_MARKER_HIT_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  projectMarkerLabel: {
    position: "absolute",
    maxWidth: 156,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "rgba(224,227,225,0.95)",
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  projectMarkerLabelSelected: {
    backgroundColor: COLORS.navy,
    borderColor: "rgba(255,255,255,0.92)",
  },
  projectMarkerLabelText: {
    color: COLORS.ink,
    fontSize: 11.5,
    fontWeight: "900",
  },
  projectMarkerLabelTextSelected: {
    color: COLORS.white,
  },
  projectMarker: {
    width: PROJECT_MARKER_SIZE,
    height: PROJECT_MARKER_SIZE,
    borderRadius: PROJECT_MARKER_SIZE / 2,
    backgroundColor: COLORS.navy,
    borderWidth: 2,
    borderColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  projectMarkerSelected: {
    backgroundColor: COLORS.teal,
    borderWidth: 3,
  },
  userMarkerOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(49,73,93,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  userMarkerInner: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: COLORS.navy,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  mapControls: {
    position: "absolute",
    right: 14,
    bottom: 110,
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
});
