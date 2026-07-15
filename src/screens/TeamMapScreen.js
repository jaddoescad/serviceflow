import { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { freshnessForTimestamp, freshnessForTrackingStatus, splitRouteSegments } from "../lib/locationTrackingPolicy";
import { useTeamLocations } from "../lib/useTeamLocations";
import { palette as COLORS } from "../theme";

const OTTAWA_REGION = {
  latitude: 45.4215,
  longitude: -75.6972,
  latitudeDelta: 0.18,
  longitudeDelta: 0.18,
};

export default function TeamMapScreen({ projects = [], enabled = true }) {
  const mapRef = useRef(null);
  const team = useTeamLocations(enabled);
  const routeSegments = useMemo(() => splitRouteSegments(team.routePoints), [team.routePoints]);
  const statusesWithCoordinates = team.statuses.filter(hasCoordinates);
  const selectedCoordinate = coordinateFor(team.selectedStatus);
  const projectMarkers = useMemo(
    () => routeProjectMarkers(team.routePoints, projects),
    [team.routePoints, projects],
  );
  const displayedCoordinates = team.selectedStatus
    ? team.routePoints.map(coordinateFor).filter(Boolean)
    : statusesWithCoordinates.map(coordinateFor).filter(Boolean);

  useEffect(() => {
    if (!displayedCoordinates.length || !mapRef.current) return;
    if (displayedCoordinates.length === 1) {
      mapRef.current.animateToRegion(
        { ...displayedCoordinates[0], latitudeDelta: 0.025, longitudeDelta: 0.025 },
        300,
      );
      return;
    }
    mapRef.current.fitToCoordinates(displayedCoordinates, {
      animated: true,
      edgePadding: { top: 100, right: 55, bottom: 300, left: 55 },
    });
  }, [team.selectedUserId, coordinateKey(displayedCoordinates)]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={OTTAWA_REGION}
        rotateEnabled={false}
        pitchEnabled={false}
        showsCompass={false}
      >
        {!team.selectedStatus
          ? statusesWithCoordinates.map((status) => (
              <Marker
                key={status.user_id}
                coordinate={coordinateFor(status)}
                pinColor={freshnessColor(status)}
                title={status.user_name || status.user_email || "Painter"}
                description={`${modeLabel(status.tracking_mode)} · ${ageLabel(status.last_location_at)}`}
                onPress={() => team.selectUser(status.user_id)}
              />
            ))
          : null}

        {routeSegments.map((segment, index) =>
          segment.length > 1 ? (
            <Polyline
              key={`route-${index}`}
              coordinates={segment.map(coordinateFor)}
              strokeColor={COLORS.teal}
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
            />
          ) : null,
        )}

        {team.selectedStatus && selectedCoordinate ? (
          <>
            <Circle
              center={selectedCoordinate}
              radius={Math.max(20, Number(team.selectedStatus.accuracy_meters) || 20)}
              strokeColor="rgba(47,141,127,0.50)"
              fillColor="rgba(47,141,127,0.14)"
            />
            <Marker
              coordinate={selectedCoordinate}
              pinColor={freshnessColor(team.selectedStatus)}
              title={`${team.selectedStatus.user_name || "Painter"} · last recorded`}
              description={ageLabel(team.selectedStatus.last_location_at)}
            />
          </>
        ) : null}

        {team.selectedStatus
          ? projectMarkers.map((marker) => (
              <Marker
                key={`project-${marker.id}`}
                coordinate={marker.coordinate}
                pinColor={COLORS.brown}
                title={marker.name}
                description="Job site"
              />
            ))
          : null}

        {team.selectedStatus
          ? routeSegments.slice(1).map((segment, index) => {
              const point = coordinateFor(segment[0]);
              return point ? (
                <Marker
                  key={`gap-${index}`}
                  coordinate={point}
                  pinColor="#c47b23"
                  title="Tracking resumed"
                  description="The route has a gap before this point."
                />
              ) : null;
            })
          : null}
      </MapView>

      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          {team.selectedStatus ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to team map"
              onPress={team.clearSelection}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={22} color={COLORS.ink} />
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.kicker}>Team locations</Text>
            <Text style={styles.title} numberOfLines={1}>
              {team.selectedStatus?.user_name || "Today’s field map"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh team locations"
            onPress={team.refresh}
            style={styles.refreshButton}
          >
            <Ionicons name="refresh" size={20} color={COLORS.teal} />
          </Pressable>
        </View>
        {team.selectedStatus ? (
          <View style={styles.detailMetaRow}>
            <StatusDot status={team.selectedStatus} />
            <Text style={styles.detailMeta}>
              {modeLabel(team.selectedStatus.tracking_mode)} · {ageLabel(team.selectedStatus.last_location_at)}
            </Text>
            <Text style={styles.detailMeta}>{team.routePoints.length} route points</Text>
          </View>
        ) : (
          <Text style={styles.subtitle}>Tap a painter to see today’s route and tracking gaps.</Text>
        )}
      </View>

      <View style={styles.bottomPanel}>
        {team.error ? (
          <View style={styles.errorRow}>
            <Ionicons name="warning-outline" size={17} color="#a45623" />
            <Text style={styles.errorText} numberOfLines={2}>{team.error}</Text>
          </View>
        ) : null}

        {team.loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={COLORS.teal} />
            <Text style={styles.loadingText}>Loading team locations…</Text>
          </View>
        ) : team.selectedStatus ? (
          <RouteSummary
            status={team.selectedStatus}
            points={team.routePoints}
            routeLoading={team.routeLoading}
            gapCount={Math.max(0, routeSegments.length - 1)}
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardList}>
            {team.statuses.length ? (
              team.statuses.map((status) => (
                <EmployeeCard key={status.user_id} status={status} onPress={() => team.selectUser(status.user_id)} />
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Ionicons name="location-outline" size={25} color={COLORS.muted} />
                <Text style={styles.emptyTitle}>No tracking records yet</Text>
                <Text style={styles.emptyText}>Records appear after painters clock in with this version.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function EmployeeCard({ status, onPress }) {
  const freshness = freshnessForTrackingStatus(status);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.employeeCard, pressed && styles.cardPressed]}>
      <View style={styles.cardTopRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(status.user_name)}</Text></View>
        <StatusDot status={status} />
      </View>
      <Text style={styles.employeeName} numberOfLines={1}>{status.user_name || status.user_email || "Painter"}</Text>
      <Text style={styles.projectName} numberOfLines={1}>{status.project_name || "No active job"}</Text>
      <Text style={[styles.freshnessText, freshness.level === "stale" && styles.staleText]} numberOfLines={1}>
        {ageLabel(status.last_location_at)}
      </Text>
      <Text style={styles.modeText}>{modeLabel(status.tracking_mode)}</Text>
    </Pressable>
  );
}

function RouteSummary({ status, points, routeLoading, gapCount }) {
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <View style={styles.routeSummary}>
      {routeLoading ? <ActivityIndicator color={COLORS.teal} /> : null}
      <SummaryCell label="First point" value={first ? timeLabel(first.captured_at) : "None today"} />
      <SummaryCell label="Last point" value={last ? timeLabel(last.captured_at) : "None today"} />
      <SummaryCell label="Route gaps" value={String(gapCount)} warning={gapCount > 0} />
      <SummaryCell label="Job" value={status.project_name || "Not assigned"} />
    </View>
  );
}

function SummaryCell({ label, value, warning = false }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, warning && styles.staleText]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function StatusDot({ status }) {
  return <View style={[styles.statusDot, { backgroundColor: freshnessColor(status) }]} />;
}

function hasCoordinates(value) {
  return coordinateFor(value) !== null;
}

function coordinateFor(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function coordinateKey(points) {
  return (points || []).map((point) => `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`).join("|");
}

function freshnessColor(status) {
  const level = freshnessForTrackingStatus(status).level;
  if (level === "fresh") return "#2f8d7f";
  if (level === "stationary") return "#3e7590";
  if (level === "clocked_out") return "#8b9692";
  if (level === "aging") return "#c47b23";
  return "#b4473d";
}

function ageLabel(timestamp) {
  const freshness = freshnessForTimestamp(timestamp);
  if (freshness.ageMs == null) return "No location received";
  const minutes = Math.floor(freshness.ageMs / 60000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ${minutes % 60}m ago`;
}

function modeLabel(mode) {
  const labels = {
    painting: "Painting mode",
    stationary: "Stationary",
    travel: "Travelling",
    clocked_out: "Clocked out",
    unavailable: "Tracking unavailable",
  };
  return labels[mode] || "Tracking status unknown";
}

function timeLabel(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Unknown";
}

function initials(name) {
  return String(name || "P")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "P";
}

function routeProjectMarkers(points, projects) {
  const ids = new Set((points || []).map((point) => String(point.companycam_project_id || "")).filter(Boolean));
  return (projects || [])
    .filter((project) => ids.has(String(project.companycam_id || project.id || "")) && hasCoordinates(project))
    .map((project) => ({
      id: String(project.companycam_id || project.id),
      name: project.name || "Job site",
      coordinate: coordinateFor(project),
    }));
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: {
    position: "absolute", top: 12, left: 12, right: 12, backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, padding: 14,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerText: { flex: 1, minWidth: 0 },
  kicker: { color: COLORS.teal, fontSize: 10.5, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { color: COLORS.ink, fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: COLORS.muted, fontSize: 12.5, fontWeight: "600", marginTop: 5 },
  backButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  refreshButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#edf6f3", alignItems: "center", justifyContent: "center" },
  detailMetaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 7 },
  detailMeta: { color: COLORS.muted, fontSize: 11.5, fontWeight: "700" },
  bottomPanel: {
    position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 218, backgroundColor: "rgba(255,255,255,0.97)",
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: COLORS.border,
    paddingTop: 14, paddingBottom: 18,
  },
  cardList: { paddingHorizontal: 14, gap: 10, alignItems: "stretch" },
  employeeCard: { width: 168, minHeight: 174, borderRadius: 18, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  cardPressed: { opacity: 0.72 },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.green, alignItems: "center", justifyContent: "center" },
  avatarText: { color: COLORS.white, fontSize: 12, fontWeight: "900" },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  employeeName: { color: COLORS.ink, fontSize: 14.5, fontWeight: "900" },
  projectName: { color: COLORS.muted, fontSize: 12, fontWeight: "700", marginTop: 3 },
  freshnessText: { color: COLORS.teal, fontSize: 11.5, fontWeight: "800", marginTop: 13 },
  staleText: { color: "#b4473d" },
  modeText: { color: COLORS.ink, fontSize: 11, fontWeight: "700", marginTop: 4 },
  emptyCard: { width: 290, height: 165, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  emptyTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "900", marginTop: 8 },
  emptyText: { color: COLORS.muted, fontSize: 12, textAlign: "center", marginTop: 3 },
  routeSummary: { flex: 1, flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 10, alignContent: "flex-start" },
  summaryCell: { width: "47%", backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  summaryLabel: { color: COLORS.muted, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  summaryValue: { color: COLORS.ink, fontSize: 13, fontWeight: "900", marginTop: 4 },
  loadingState: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: COLORS.muted, fontSize: 12.5, fontWeight: "700" },
  errorRow: { marginHorizontal: 14, marginBottom: 10, flexDirection: "row", gap: 7, alignItems: "center", backgroundColor: "#fff5e9", borderRadius: 12, padding: 10 },
  errorText: { flex: 1, color: "#87491e", fontSize: 11.5, fontWeight: "700" },
});
