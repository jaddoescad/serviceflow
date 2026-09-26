import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import "leaflet/dist/leaflet.css";
import { freshnessForTimestamp, freshnessForTrackingStatus, splitRouteSegments } from "../lib/locationTrackingPolicy";
import { useTeamLocations } from "../lib/useTeamLocations";
import { palette as COLORS } from "../theme";

export default function TeamMapScreen({ projects = [], enabled = true }) {
  const team = useTeamLocations(enabled);
  const routeSegments = useMemo(() => splitRouteSegments(team.routePoints), [team.routePoints]);

  return (
    <View style={styles.container}>
      <LeafletTeamMap
        statuses={team.statuses}
        selectedStatus={team.selectedStatus}
        routeSegments={routeSegments}
        routePoints={team.routePoints}
        projects={projects}
        onSelectUser={team.selectUser}
      />

      <View style={styles.header}>
        <View style={styles.headerRow}>
          {team.selectedStatus ? (
            <Pressable onPress={team.clearSelection} style={styles.iconButton}>
              <Ionicons name="chevron-back" size={20} color={COLORS.ink} />
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.kicker}>Team locations</Text>
            <Text style={styles.title}>{team.selectedStatus?.user_name || "Today’s field map"}</Text>
            <Text style={styles.subtitle}>
              {team.selectedStatus
                ? `${modeLabel(team.selectedStatus.tracking_mode)} · ${ageLabel(team.selectedStatus.last_location_at)}`
                : "Select a painter to view today’s route."}
            </Text>
          </View>
          <Pressable onPress={team.refresh} style={styles.iconButton}>
            <Ionicons name="refresh" size={19} color={COLORS.teal} />
          </Pressable>
        </View>
      </View>

      <View style={styles.bottomPanel}>
        {team.error ? <Text style={styles.errorText}>{team.error}</Text> : null}
        {team.loading ? (
          <View style={styles.loading}><ActivityIndicator color={COLORS.teal} /><Text>Loading locations…</Text></View>
        ) : team.selectedStatus ? (
          <View style={styles.summaryRow}>
            <Summary label="Route points" value={team.routeLoading ? "Loading…" : String(team.routePoints.length)} />
            <Summary label="Tracking gaps" value={String(Math.max(0, routeSegments.length - 1))} />
            <Summary label="Last recorded" value={ageLabel(team.selectedStatus.last_location_at)} />
            <Summary label="Job" value={team.selectedStatus.project_name || "No active job"} />
          </View>
        ) : (
          <ScrollView horizontal contentContainerStyle={styles.cards}>
            {team.statuses.length ? team.statuses.map((status) => (
              <Pressable key={status.user_id} onPress={() => team.selectUser(status.user_id)} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.dot, { backgroundColor: freshnessColor(status) }]} />
                  <Text style={styles.mode}>{modeLabel(status.tracking_mode)}</Text>
                </View>
                <Text style={styles.name}>{status.user_name || status.user_email || "Painter"}</Text>
                <Text style={styles.project}>{status.project_name || "No active job"}</Text>
                <Text style={styles.age}>{ageLabel(status.last_location_at)}</Text>
              </Pressable>
            )) : (
              <View style={styles.empty}><Text style={styles.name}>No tracking records yet</Text><Text style={styles.project}>Records appear after painters clock in with this version.</Text></View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function LeafletTeamMap({ statuses, selectedStatus, routeSegments, routePoints, projects, onSelectUser }) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !elementRef.current || mapRef.current) return;
      const map = L.map(elementRef.current, { zoomControl: false }).setView([45.4215, -75.6972], 11);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !mapRef.current || !layerRef.current) return;
      const layer = layerRef.current;
      layer.clearLayers();
      const bounds = [];

      if (!selectedStatus) {
        statuses.filter(hasCoordinates).forEach((status) => {
          const point = [Number(status.latitude), Number(status.longitude)];
          bounds.push(point);
          L.circleMarker(point, {
            radius: 9, color: "#fff", weight: 3,
            fillColor: freshnessColor(status), fillOpacity: 1,
          })
            .bindTooltip(`${status.user_name || "Painter"}<br>${ageLabel(status.last_location_at)}`)
            .on("click", () => onSelectUser(status.user_id))
            .addTo(layer);
        });
      } else {
        routeSegments.forEach((segment) => {
          const line = segment.map((point) => [Number(point.latitude), Number(point.longitude)]);
          bounds.push(...line);
          if (line.length > 1) L.polyline(line, { color: COLORS.teal, weight: 5, opacity: 0.9 }).addTo(layer);
        });
        const selectedPoint = coordinatePair(selectedStatus);
        if (selectedPoint) {
          bounds.push(selectedPoint);
          L.circleMarker(selectedPoint, {
            radius: 10, color: "#fff", weight: 3,
            fillColor: freshnessColor(selectedStatus), fillOpacity: 1,
          }).bindTooltip("Last recorded location").addTo(layer);
        }
        routeProjectCoordinates(routePoints, projects).forEach((project) => {
          const point = [project.latitude, project.longitude];
          bounds.push(point);
          L.circleMarker(point, { radius: 7, color: COLORS.brown, weight: 3, fillColor: "#fff", fillOpacity: 1 })
            .bindTooltip(`${project.name}<br>Job site`)
            .addTo(layer);
        });
        routeSegments.slice(1).forEach((segment) => {
          const point = coordinatePair(segment[0]);
          if (point) L.circleMarker(point, { radius: 6, color: "#c47b23", fillColor: "#fff", fillOpacity: 1 }).bindTooltip("Tracking resumed after a gap").addTo(layer);
        });
      }

      if (bounds.length === 1) mapRef.current.setView(bounds[0], 15);
      else if (bounds.length > 1) mapRef.current.fitBounds(bounds, { paddingTopLeft: [45, 110], paddingBottomRight: [45, 250] });
    });
    return () => { cancelled = true; };
  }, [statuses, selectedStatus, routeSegments, routePoints, projects, onSelectUser]);

  return <div ref={elementRef} style={{ position: "absolute", inset: 0, background: "#eef4f1" }} />;
}

function Summary({ label, value }) {
  return <View style={styles.summary}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue} numberOfLines={1}>{value}</Text></View>;
}

function coordinatePair(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
}

function hasCoordinates(value) { return coordinatePair(value) !== null; }

function routeProjectCoordinates(points, projects) {
  const ids = new Set((points || []).map((point) => String(point.companycam_project_id || "")).filter(Boolean));
  return (projects || []).filter((project) => ids.has(String(project.companycam_id || project.id || "")) && hasCoordinates(project));
}

function freshnessColor(status) {
  const level = freshnessForTrackingStatus(status).level;
  if (level === "fresh") return "#2f8d7f";
  if (level === "stationary") return "#3e7590";
  if (level === "clocked_out") return "#8b9692";
  return level === "aging" ? "#c47b23" : "#b4473d";
}

function ageLabel(timestamp) {
  const result = freshnessForTimestamp(timestamp);
  if (result.ageMs == null) return "No location received";
  const minutes = Math.floor(result.ageMs / 60000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function modeLabel(mode) {
  return ({ painting: "Painting mode", stationary: "Stationary", travel: "Travelling", clocked_out: "Clocked out", unavailable: "Tracking unavailable" })[mode] || "Unknown";
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.surface },
  header: { position: "absolute", top: 16, left: 16, right: 16, maxWidth: 620, borderRadius: 18, padding: 14, backgroundColor: "rgba(255,255,255,0.96)", borderWidth: 1, borderColor: COLORS.border, boxShadow: "0 6px 20px rgba(0,0,0,.14)" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerText: { flex: 1 },
  kicker: { color: COLORS.teal, fontSize: 10.5, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { color: COLORS.ink, fontSize: 22, fontWeight: "900" },
  subtitle: { color: COLORS.muted, fontSize: 12, fontWeight: "600", marginTop: 3 },
  iconButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center" },
  bottomPanel: { position: "absolute", left: 16, right: 16, bottom: 16, minHeight: 170, maxHeight: 220, borderRadius: 22, padding: 14, backgroundColor: "rgba(255,255,255,0.97)", borderWidth: 1, borderColor: COLORS.border, boxShadow: "0 6px 22px rgba(0,0,0,.16)" },
  cards: { gap: 10 },
  card: { width: 180, borderRadius: 16, padding: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  mode: { color: COLORS.muted, fontSize: 10.5, fontWeight: "800" },
  name: { color: COLORS.ink, fontSize: 14, fontWeight: "900" },
  project: { color: COLORS.muted, fontSize: 11.5, fontWeight: "600", marginTop: 4 },
  age: { color: COLORS.teal, fontSize: 11.5, fontWeight: "800", marginTop: 18 },
  empty: { width: 300, alignItems: "center", justifyContent: "center" },
  summaryRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  summary: { flex: 1, minWidth: 145, borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  summaryLabel: { color: COLORS.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  summaryValue: { color: COLORS.ink, fontSize: 13, fontWeight: "900", marginTop: 4 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  errorText: { color: "#a45623", fontSize: 12, fontWeight: "700", marginBottom: 8 },
});
