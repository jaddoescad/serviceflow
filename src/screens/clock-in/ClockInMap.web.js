import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { distanceMeters, formatDistance } from "../../lib/trackingModel";

const COLORS = {
  green: "#173f37",
  teal: "#2f8d7f",
  navy: "#31495d",
  white: "#ffffff",
  ink: "#11201d",
  muted: "#8b9692",
  border: "#d8e0dd",
  surface: "#eef4f1",
};

export default function ClockInMap({
  project,
  projects = [],
  currentPoint,
  onSelectProject,
  onRequestLocation,
}) {
  const [locating, setLocating] = useState(false);
  const selectedProjectId = getProjectId(project);
  const userCoordinate = toCoordinate(currentPoint);
  const nearbyProjects = useMemo(
    () => buildNearbyProjects(projects, userCoordinate, selectedProjectId),
    [projects, selectedProjectId, userCoordinate?.latitude, userCoordinate?.longitude],
  );

  const requestLocation = async () => {
    if (!onRequestLocation || locating) return;
    setLocating(true);
    try {
      await onRequestLocation();
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={styles.mapFallback}>
      <View style={styles.gridOverlay} />
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelIcon}>
            <Ionicons name="map" size={18} color={COLORS.teal} />
          </View>
          <View style={styles.panelTitleWrap}>
            <Text style={styles.panelTitle}>Web Map Preview</Text>
            <Text style={styles.panelSubtitle} numberOfLines={1}>
              {userCoordinate
                ? `${userCoordinate.latitude.toFixed(5)}, ${userCoordinate.longitude.toFixed(5)}`
                : "Location not available in this browser session"}
            </Text>
          </View>
          {onRequestLocation ? (
            <Pressable
              accessibilityRole="button"
              disabled={locating}
              onPress={requestLocation}
              style={({ pressed }) => [
                styles.locateButton,
                locating && styles.locateButtonDisabled,
                pressed && !locating && styles.locateButtonPressed,
              ]}
            >
              <Ionicons name="locate" size={18} color={COLORS.white} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.projectList}>
          {nearbyProjects.length ? (
            nearbyProjects.map(({ project: candidate, distanceLabel, selected }) => (
              <Pressable
                key={getProjectId(candidate)}
                accessibilityRole="button"
                onPress={() => onSelectProject?.(candidate)}
                style={({ pressed }) => [
                  styles.projectRow,
                  selected && styles.projectRowSelected,
                  pressed && styles.projectRowPressed,
                ]}
              >
                <View style={[styles.markerDot, selected && styles.markerDotSelected]}>
                  <Ionicons name="location" size={14} color={COLORS.white} />
                </View>
                <View style={styles.projectText}>
                  <Text style={[styles.projectName, selected && styles.projectNameSelected]} numberOfLines={1}>
                    {candidate.name || "Project"}
                  </Text>
                  <Text style={[styles.projectMeta, selected && styles.projectMetaSelected]} numberOfLines={1}>
                    {distanceLabel || formatProjectAddress(candidate) || "No coordinates on file"}
                  </Text>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="briefcase-outline" size={24} color={COLORS.muted} />
              <Text style={styles.emptyTitle}>No mapped projects</Text>
              <Text style={styles.emptyText}>Search or sync projects to choose a job.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
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
    const coordinate = toCoordinate(rawProject);
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

function buildNearbyProjects(projects, userCoordinate, selectedProjectId) {
  const seen = new Set();
  const ranked = [];

  for (const candidate of projects || []) {
    if (!candidate || candidate.is_archived || candidate.is_lead) continue;
    const id = getProjectId(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const coordinate = toCoordinate(candidate);
    const distance = userCoordinate && coordinate ? distanceMeters(userCoordinate, coordinate) : null;
    ranked.push({
      project: candidate,
      selected: Boolean(selectedProjectId && id === selectedProjectId),
      distanceMeters: distance,
      distanceLabel: distance == null ? "" : `${formatDistance(distance)} away`,
    });
  }

  return ranked
    .sort((a, b) => {
      if (a.selected) return -1;
      if (b.selected) return 1;
      if (a.distanceMeters == null && b.distanceMeters == null) return 0;
      if (a.distanceMeters == null) return 1;
      if (b.distanceMeters == null) return -1;
      return a.distanceMeters - b.distanceMeters;
    })
    .slice(0, 6);
}

const styles = StyleSheet.create({
  mapFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.surface,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingTop: 96,
    paddingBottom: 104,
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundImage:
      "linear-gradient(0deg, rgba(49,73,93,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(49,73,93,0.08) 1px, transparent 1px)",
    backgroundSize: "42px 42px",
  },
  panel: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 560,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(255,255,255,0.96)",
    padding: 14,
    boxShadow: "0 6px 12px rgba(0,0,0,0.12)",
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  panelIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#e9f3ee",
    alignItems: "center",
    justifyContent: "center",
  },
  panelTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  panelTitle: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  panelSubtitle: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 1,
  },
  locateButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  locateButtonDisabled: {
    opacity: 0.55,
  },
  locateButtonPressed: {
    opacity: 0.85,
  },
  projectList: {
    marginTop: 14,
    gap: 8,
  },
  projectRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6ece9",
    backgroundColor: COLORS.white,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  projectRowSelected: {
    backgroundColor: COLORS.navy,
    borderColor: COLORS.navy,
  },
  projectRowPressed: {
    opacity: 0.86,
  },
  markerDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  markerDotSelected: {
    backgroundColor: COLORS.teal,
  },
  projectText: {
    flex: 1,
    minWidth: 0,
  },
  projectName: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  projectNameSelected: {
    color: COLORS.white,
  },
  projectMeta: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 1,
  },
  projectMetaSelected: {
    color: "rgba(255,255,255,0.76)",
  },
  emptyState: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6ece9",
    backgroundColor: COLORS.white,
    padding: 16,
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 8,
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
    textAlign: "center",
  },
});
