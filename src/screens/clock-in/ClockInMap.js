import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";

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

export default function ClockInMap({ project, projects, currentPoint, onSelectProject, onRequestLocation }) {
  const mapRef = useRef(null);
  const [resolvedSelectedProject, setResolvedSelectedProject] = useState(null);
  const selectedProjectForMap = resolvedSelectedProject || project;
  const projectMarkers = useMemo(() => buildProjectMarkers(projects, selectedProjectForMap), [selectedProjectForMap, projects]);
  const markerCoordinates = useMemo(() => projectMarkers.map((marker) => marker.coordinate), [projectMarkers]);
  const selectedMarker = projectMarkers.find((marker) => marker.isSelected);
  const siteCoordinate = selectedMarker?.coordinate || projectCoordinate(selectedProjectForMap);
  const selectedMarkerCoordinate = selectedMarker?.coordinate || siteCoordinate;
  const selectedMarkerProject = selectedMarker?.project || selectedProjectForMap;
  const connectorCoordinate = selectedMarker?.coordinate || siteCoordinate;
  const userCoordinate = toCoordinate(currentPoint);
  const region = buildMapRegion(siteCoordinate, userCoordinate, markerCoordinates);
  const [visibleRegion, setVisibleRegion] = useState(region);
  const markerKey = projectMarkers.map((marker) => `${marker.id}:${coordinateKey(marker.coordinate)}`).join("|");
  const zoomDelta = Math.max(
    visibleRegion?.latitudeDelta ?? region.latitudeDelta,
    visibleRegion?.longitudeDelta ?? region.longitudeDelta,
  );
  const showProjectLabels = zoomDelta <= 0.18;

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

    mapRef.current?.animateToRegion(targetRegion, 350);
  };

  useEffect(() => {
    if (!projectMarkers.length && !userCoordinate) return;
    setVisibleRegion(region);
    mapRef.current?.animateToRegion(region, 250);
  }, [markerKey, selectedProjectForMap?.companycam_id, userCoordinate?.latitude, userCoordinate?.longitude]);

  useEffect(() => {
    let cancelled = false;
    const selectedId = getProjectId(project);

    async function resolveSelectedProjectCoordinate() {
      if (!project || projectCoordinate(project)) {
        setResolvedSelectedProject(null);
        return;
      }

      const matchingProject = (projects || []).find(
        (candidate) => getProjectId(candidate) === selectedId && projectCoordinate(candidate),
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
  }, [project?.companycam_id, project?.formatted_address, project?.city, project?.state, project?.postal_code, projects]);

  return (
    <>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        mapType="standard"
        showsCompass={false}
        showsScale={false}
        showsBuildings
        loadingEnabled
        onRegionChangeComplete={setVisibleRegion}
      >
        {siteCoordinate ? (
          <Circle
            center={siteCoordinate}
            radius={150}
            strokeWidth={2}
            strokeColor="rgba(47,141,127,0.55)"
            fillColor="rgba(47,141,127,0.18)"
          />
        ) : null}

        {connectorCoordinate && userCoordinate ? (
          <>
            <Polyline
              coordinates={[userCoordinate, connectorCoordinate]}
              strokeColor="rgba(17,32,29,0.16)"
              strokeWidth={10}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={[userCoordinate, connectorCoordinate]}
              strokeColor="rgba(255,255,255,0.92)"
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={[userCoordinate, connectorCoordinate]}
              strokeColor={COLORS.teal}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
            />
          </>
        ) : null}

        {projectMarkers.filter((marker) => !marker.isSelected).map((marker) => {
          const showLabel = showProjectLabels;

          return (
            <Marker
              key={`${marker.id}-${showLabel ? "label" : "pin"}`}
              coordinate={marker.coordinate}
              title={marker.project?.name || "Project"}
              description={formatProjectAddress(marker.project) || undefined}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={1}
              tracksViewChanges
              onPress={() => onSelectProject?.(marker.project)}
            >
              <View style={styles.projectMarkerStack}>
                {showLabel ? (
                  <View style={styles.projectMarkerLabel}>
                    <Text style={styles.projectMarkerLabelText} numberOfLines={1}>
                      {marker.project?.name || "Project"}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.projectMapMarker}>
                  <Ionicons name="location" size={18} color={COLORS.white} />
                </View>
              </View>
            </Marker>
          );
        })}

        {selectedMarkerCoordinate ? (
          <Marker
            key={`selected-${getProjectId(selectedMarkerProject) || coordinateKey(selectedMarkerCoordinate)}`}
            coordinate={selectedMarkerCoordinate}
            title={selectedMarkerProject?.name || "Project"}
            description={formatProjectAddress(selectedMarkerProject) || undefined}
            anchor={{ x: 0.5, y: 1 }}
            displayPriority="required"
            identifier="selected-project-marker"
            zIndex={99}
            tracksViewChanges
            onPress={() => onSelectProject?.(selectedMarkerProject)}
          >
            <View style={styles.projectMarkerStack}>
              <View style={[styles.projectMarkerLabel, styles.projectMarkerLabelSelected]}>
                <Text
                  style={[styles.projectMarkerLabelText, styles.projectMarkerLabelTextSelected]}
                  numberOfLines={1}
                >
                  {selectedMarkerProject?.name || "Project"}
                </Text>
              </View>
              <View style={styles.siteMarker}>
                <Ionicons name="location" size={25} color={COLORS.white} />
              </View>
            </View>
          </Marker>
        ) : null}

        {userCoordinate ? (
          <Marker coordinate={userCoordinate} title="Your location">
            <View style={styles.userMarkerOuter}>
              <View style={styles.userMarkerInner} />
            </View>
          </Marker>
        ) : null}
      </MapView>

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

function distanceMeters(a, b) {
  if (!a || !b) return null;
  const radius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function coordinateKey(coordinate) {
  return `${coordinate.latitude.toFixed(6)},${coordinate.longitude.toFixed(6)}`;
}

function buildProjectMarkers(projects, selectedProject) {
  const selectedProjectId = getProjectId(selectedProject);
  const seen = new Set();
  const markers = [];
  const candidates = selectedProject ? [selectedProject, ...(projects || [])] : projects || [];

  for (const rawProject of candidates) {
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

  return markers;
}

function buildMapRegion(projectPoint, currentPoint, projectPoints = []) {
  const points = [...projectPoints, currentPoint].filter(Boolean);

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
  projectMarkerStack: {
    alignItems: "center",
  },
  projectMarkerLabel: {
    maxWidth: 156,
    marginBottom: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "rgba(224,227,225,0.95)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  projectMarkerLabelSelected: {
    backgroundColor: COLORS.navy,
    borderColor: "rgba(255,255,255,0.9)",
  },
  projectMarkerLabelText: {
    color: COLORS.ink,
    fontSize: 11.5,
    fontWeight: "900",
    letterSpacing: -0.1,
  },
  projectMarkerLabelTextSelected: {
    color: COLORS.white,
  },
  siteMarker: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.teal,
    borderWidth: 3,
    borderColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  projectMapMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
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
