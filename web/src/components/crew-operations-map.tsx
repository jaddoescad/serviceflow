"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { Badge, Button, Card, CardHeader, EmptyState, cn } from "@/components/ui";
import { fmtDateTime, fmtDistance, fmtHours, fmtRelativeTime, fmtTime, initials } from "@/lib/format";

const OTTAWA_CENTER: [number, number] = [45.4215, -75.6972];
const REFRESH_MS = 60_000;
const FRESH_HEARTBEAT_MS = 6 * 60_000;
const DELAYED_HEARTBEAT_MS = 20 * 60_000;
const FRESH_GPS_MS = 5 * 60_000;
const AGING_GPS_MS = 15 * 60_000;
const JOB_RADIUS_METERS = 250;
const CREW_COLORS = ["#2563eb", "#8b5cf6", "#ea580c", "#0891b2", "#db2777", "#65a30d"];

type TrackingMode = "clocked_out" | "painting" | "stationary" | "travel" | "unavailable" | "unknown";
type TaskStatus = "running" | "geofence" | "paused" | "stopped" | "error";
type GpsFreshness = "fresh" | "aging" | "stale" | "historical" | "fallback" | "unavailable";
type HeartbeatLevel = "live" | "delayed" | "offline" | "geofence" | "none";

export type CrewTrailPoint = {
  id: string;
  latitude: number;
  longitude: number;
  capturedAt: string;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  isOnSite: boolean | null;
  eventTypes: string[];
  trackingMode: TrackingMode;
};

export type CrewLocation = {
  entryId: string;
  name: string;
  projectId: string | null;
  projectName: string;
  projectAddress: string | null;
  startedAt: string;
  endedAt: string | null;
  shiftStatus: "active" | "complete";
  latitude: number | null;
  longitude: number | null;
  jobLatitude: number | null;
  jobLongitude: number | null;
  locationSource: "tracking" | "clock_in" | "none";
  status: "on_site" | "off_site" | "unknown";
  distanceMeters: number | null;
  lastLocationAt: string | null;
  lastSyncAt: string | null;
  accuracyMeters: number | null;
  trackingMode: TrackingMode | null;
  taskStatus: TaskStatus | null;
  trailPoints: CrewTrailPoint[];
  trailDistanceMeters: number;
};

type JobSite = {
  key: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  shiftCount: number;
};

export function CrewOperationsMap({
  locations,
  snapshotNow,
}: {
  locations: CrewLocation[];
  snapshotNow: number;
}) {
  const router = useRouter();
  const [liveNow, setLiveNow] = useState(snapshotNow);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRefs = useRef<Map<string, LeafletMarker>>(new Map());
  const jobMarkerRefs = useRef<Map<string, LeafletMarker>>(new Map());
  const jobSites = useMemo(() => collectJobSites(locations), [locations]);
  const activeSelection = locations.some((location) => location.entryId === selectedEntryId)
    ? selectedEntryId
    : null;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLiveNow(Date.now());
      router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [router]);

  useEffect(() => {
    let disposed = false;
    let map: LeafletMap | null = null;
    let invalidateTimer: number | null = null;

    async function renderMap() {
      const L = await import("leaflet");
      if (disposed || !mapContainerRef.current) return;

      map = L.map(mapContainerRef.current, {
        center: OTTAWA_CENTER,
        zoom: 11,
        zoomControl: false,
      });
      mapRef.current = map;
      markerRefs.current.clear();
      jobMarkerRefs.current.clear();

      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const bounds: [number, number][] = [];
      for (const site of jobSites.values()) {
        const point: [number, number] = [site.latitude, site.longitude];
        bounds.push(point);
        L.circle(point, {
          className: "crew-map-job-radius",
          fillOpacity: 0.07,
          interactive: false,
          radius: JOB_RADIUS_METERS,
          weight: 1.5,
        }).addTo(map);

        const iconElement = document.createElement("span");
        iconElement.className = "crew-map-job-marker";
        const pin = document.createElement("span");
        pin.className = "crew-map-job-marker-pin";
        pin.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "crew-map-job-marker-label";
        const name = document.createElement("strong");
        name.textContent = site.name;
        const crew = document.createElement("small");
        crew.textContent = `${site.shiftCount} ${site.shiftCount === 1 ? "shift" : "shifts"} today · ${JOB_RADIUS_METERS} m job area`;
        label.append(name, crew);
        iconElement.append(pin, label);

        const popup = popupElement(
          site.name,
          site.address ?? "Job site",
          `${site.shiftCount} ${site.shiftCount === 1 ? "shift" : "shifts"} today · ${JOB_RADIUS_METERS} m on-site area`,
        );
        const marker = L.marker(point, {
          icon: L.divIcon({
            className: "",
            html: iconElement,
            iconAnchor: [14, 20],
            iconSize: [260, 40],
          }),
          title: `${site.name} — ${site.address ?? "job site"}`,
          zIndexOffset: 200,
        })
          .addTo(map)
          .bindPopup(popup);
        jobMarkerRefs.current.set(site.key, marker);
      }

      locations.forEach((location, index) => {
        const color = crewColor(index);
        const isSelected = activeSelection === location.entryId;
        const isDimmed = activeSelection != null && !isSelected;
        const trailCoordinates = location.trailPoints
          .filter((point) => hasCoordinate(point.latitude, point.longitude))
          .map((point) => [point.latitude, point.longitude] as [number, number]);
        bounds.push(...trailCoordinates);

        if (trailCoordinates.length > 1) {
          L.polyline(trailCoordinates, {
            className: "crew-map-trail",
            color,
            dashArray: location.shiftStatus === "complete" ? "7 6" : undefined,
            interactive: false,
            opacity: isDimmed ? 0.12 : isSelected ? 0.95 : location.shiftStatus === "complete" ? 0.48 : 0.65,
            weight: isSelected ? 5 : 3,
          }).addTo(map!);
        }

        if (isSelected) {
          location.trailPoints.forEach((trailPoint, pointIndex) => {
            const point: [number, number] = [trailPoint.latitude, trailPoint.longitude];
            const isFirst = pointIndex === 0;
            const isLast = pointIndex === location.trailPoints.length - 1;
            if (!isLast) {
              L.circleMarker(point, {
                className: "crew-map-trail-point",
                color,
                fillColor: isFirst ? "#ffffff" : color,
                fillOpacity: 1,
                radius: isFirst ? 5 : 3,
                weight: isFirst ? 3 : 1,
              })
                .addTo(map!)
                .bindTooltip(trailPointTooltip(trailPoint, pointIndex), { direction: "top" });
            }
          });

          if (
            hasCoordinate(location.latitude, location.longitude) &&
            location.accuracyMeters != null &&
            location.accuracyMeters > 0
          ) {
            L.circle([location.latitude!, location.longitude!], {
              className: "crew-map-accuracy",
              color,
              fillColor: color,
              fillOpacity: 0.08,
              interactive: false,
              radius: location.accuracyMeters,
              weight: 1,
            }).addTo(map!);
          }
        }

        if (!hasCoordinate(location.latitude, location.longitude)) return;
        const point: [number, number] = [location.latitude!, location.longitude!];
        if (!trailCoordinates.length) bounds.push(point);

        if (hasCoordinate(location.jobLatitude, location.jobLongitude)) {
          const jobPoint: [number, number] = [location.jobLatitude!, location.jobLongitude!];
          if (L.latLng(point).distanceTo(L.latLng(jobPoint)) > 25) {
            L.polyline([point, jobPoint], {
              className: "crew-map-assignment-line",
              dashArray: "4 7",
              interactive: false,
              opacity: isDimmed ? 0.08 : 0.35,
              weight: 1.5,
            }).addTo(map!);
          }
        }

        const iconElement = document.createElement("span");
        iconElement.className = cn(
          "crew-map-person-marker",
          `crew-map-person-marker--freshness-${gpsFreshnessFor(location, liveNow)}`,
          location.shiftStatus === "complete" && "crew-map-person-marker--clocked-out",
          location.locationSource !== "tracking" && "crew-map-person-marker--estimate",
          isDimmed && "crew-map-person-marker--dimmed",
        );
        iconElement.style.setProperty("--crew-color", color);
        iconElement.textContent = initials(location.name);

        const popup = popupElement(
          location.name,
          `${location.projectName} · ${popupLocationDetail(location)}`,
          `${trailSummary(location)} · ${shiftSignalSummary(location, liveNow)}`,
        );
        const marker = L.marker(point, {
          icon: L.divIcon({
            className: "",
            html: iconElement,
            iconAnchor: [18, 18],
            iconSize: [36, 36],
          }),
          title: `${location.name} — ${location.shiftStatus === "complete" ? "final" : "latest"} recorded position`,
          zIndexOffset: isSelected ? 700 : 500,
        })
          .addTo(map!)
          .bindPopup(popup);
        marker.on("click", () => setSelectedEntryId(location.entryId));
        markerRefs.current.set(location.entryId, marker);
      });

      const selectedLocation = locations.find((location) => location.entryId === activeSelection);
      const selectedBounds = selectedLocation
        ? [
            ...selectedLocation.trailPoints.map(
              (point) => [point.latitude, point.longitude] as [number, number],
            ),
            ...(hasCoordinate(selectedLocation.jobLatitude, selectedLocation.jobLongitude)
              ? [[selectedLocation.jobLatitude!, selectedLocation.jobLongitude!] as [number, number]]
              : []),
          ]
        : [];

      if (selectedBounds.length > 1) {
        map.fitBounds(selectedBounds, { padding: [70, 70], maxZoom: 17 });
      } else if (selectedBounds.length === 1) {
        map.setView(selectedBounds[0]!, 16);
      } else if (bounds.length === 1) {
        map.setView(bounds[0]!, 14);
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [44, 44], maxZoom: 14 });
      }

      if (activeSelection) markerRefs.current.get(activeSelection)?.openPopup();
      invalidateTimer = window.setTimeout(() => map?.invalidateSize(), 0);
    }

    void renderMap();
    return () => {
      disposed = true;
      markerRefs.current.clear();
      jobMarkerRefs.current.clear();
      mapRef.current = null;
      if (invalidateTimer != null) window.clearTimeout(invalidateTimer);
      map?.remove();
    };
  }, [activeSelection, jobSites, liveNow, locations]);

  function focusLocation(location: CrewLocation) {
    setSelectedEntryId(location.entryId);
    const marker =
      markerRefs.current.get(location.entryId) ?? jobMarkerRefs.current.get(jobSiteKey(location));
    if (!marker || !mapRef.current) return;
    mapRef.current.setView(marker.getLatLng(), Math.max(mapRef.current.getZoom(), 15));
    marker.openPopup();
  }

  const mappedCount = locations.filter((location) => hasCoordinate(location.latitude, location.longitude)).length;
  const activeCount = locations.filter((location) => location.shiftStatus === "active").length;
  const completedCount = locations.length - activeCount;
  const reportingCount = locations.filter(
    (location) => location.shiftStatus === "active" && heartbeatLevel(location, liveNow) === "live",
  ).length;
  const trailCount = locations.filter((location) => location.trailPoints.length > 1).length;
  const jobSiteCount = jobSites.size;

  return (
    <Card>
      <CardHeader
        title="Crew movement"
        subtitle="Today’s active and completed shifts · recorded GPS trail and app heartbeat are separate signals"
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone={activeCount ? "brand" : "neutral"}>{activeCount} on the clock</Badge>
            <Badge tone="neutral">{completedCount} clocked out today</Badge>
            {activeCount > 0 ? (
              <Badge tone={reportingCount ? "good" : "neutral"}>
                {reportingCount}/{activeCount} reporting
              </Badge>
            ) : null}
            <Badge tone={trailCount ? "brand" : "neutral"}>
              {trailCount} {trailCount === 1 ? "trail" : "trails"}
            </Badge>
          </div>
        }
      />

      <div className="grid min-h-[520px] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="relative min-h-[520px] overflow-hidden xl:border-r xl:border-[var(--color-border)]">
          <div
            ref={mapContainerRef}
            className="absolute inset-0 z-0"
            role="region"
            aria-label="Map of today’s active and completed crew GPS trails and assigned job areas"
          />
          <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-wrap gap-2 pr-3">
            <span className="crew-map-legend"><i className="crew-map-legend-person" />Latest GPS</span>
            <span className="crew-map-legend"><i className="crew-map-legend-trail" />Recorded path</span>
            <span className="crew-map-legend"><i className="crew-map-legend-complete" />Clocked out</span>
            <span className="crew-map-legend"><i className="crew-map-legend-job" />250 m job area</span>
          </div>
          {activeSelection ? (
            <div className="absolute right-3 top-3 z-[500]">
              <Button
                type="button"
                variant="subtle"
                size="sm"
                onClick={() => setSelectedEntryId(null)}
                className="bg-[var(--color-surface)]/95 shadow-sm"
              >
                Show all crew
              </Button>
            </div>
          ) : null}
          {mappedCount === 0 && jobSiteCount === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center p-6">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-5 py-4 text-center text-sm text-[var(--color-muted)] shadow-sm">
                No shift recorded today has usable map coordinates.
              </div>
            </div>
          ) : mappedCount === 0 ? (
            <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-3 py-2 text-xs text-[var(--color-muted)] shadow-sm">
              Job areas are shown, but no crew GPS fix was recorded for these shifts.
            </div>
          ) : null}
        </div>

        <section aria-label="Today’s crew tracking signals" className="min-w-0 bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-border)] px-5 py-3">
            <h4 className="font-display text-sm font-semibold text-[var(--color-heading)]">Today’s shifts</h4>
            <p className="mt-0.5 text-xs leading-5 text-[var(--color-muted)]">
              Active crew stay live; clocked-out crew remain here with their final trail.
            </p>
          </div>
          {locations.length === 0 ? (
            <EmptyState>No shifts have been recorded today.</EmptyState>
          ) : (
            <ul className="max-h-[454px] divide-y divide-[var(--color-border)] overflow-y-auto">
              {locations.map((location, index) => {
                const selected = activeSelection === location.entryId;
                const signal = heartbeatLevel(location, liveNow);
                const color = crewColor(index);
                return (
                  <li key={location.entryId}>
                    <button
                      type="button"
                      onClick={() => focusLocation(location)}
                      aria-expanded={selected}
                      className={cn(
                        "w-full px-5 py-3.5 text-left transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:hover:bg-transparent",
                        selected && "bg-[var(--color-surface-2)]",
                      )}
                    >
                      <span className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow-sm",
                            location.shiftStatus === "complete" && "border-dashed opacity-80",
                          )}
                          style={{ backgroundColor: color }}
                        >
                          {initials(location.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-[var(--color-heading)]">
                              {location.name}
                            </span>
                            <Badge tone={shiftBadgeTone(location, signal)}>
                              {shiftBadgeLabel(location, signal)}
                            </Badge>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-[var(--color-muted)]">
                            {location.projectName}
                          </span>
                          <span className="mt-1 block text-[11px] font-medium tabular-nums text-[var(--color-muted)]">
                            {shiftTimeSummary(location)}
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone={siteStatusTone(location)}>{siteStatusLabel(location)}</Badge>
                            <span className={gpsDetailClass(location, liveNow)}>
                              {gpsSummary(location, liveNow)}
                            </span>
                          </span>
                          <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
                            <TrailGlyph color={color} />
                            {trailSummary(location)}
                          </span>
                        </span>
                      </span>

                      {selected ? (
                        <span className="mt-3 grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
                          <SignalDetail label="Shift" value={shiftDetail(location, liveNow)} tone="neutral" />
                          <SignalDetail
                            label="App signal"
                            value={heartbeatDetail(location, liveNow)}
                            tone={location.shiftStatus === "complete" ? "neutral" : heartbeatTone(signal)}
                          />
                          <SignalDetail
                            label="Latest GPS"
                            value={latestGpsDetail(location)}
                            tone={gpsDetailTone(location, liveNow)}
                          />
                          <SignalDetail label="Recorded movement" value={trailDetail(location)} tone="neutral" />
                          <SignalDetail label="Tracking state" value={trackingStateDetail(location)} tone="neutral" />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

function SignalDetail({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <span className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
      <span className="text-[var(--color-muted)]">{label}</span>
      <span
        className={cn(
          "font-medium leading-4",
          tone === "good"
            ? "text-[var(--color-good)]"
            : tone === "warn"
              ? "text-[var(--color-warn)]"
              : tone === "bad"
                ? "text-[var(--color-bad)]"
                : "text-[var(--color-text)]",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function TrailGlyph({ color }: { color: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 22 8" className="h-2 w-[22px] shrink-0">
      <path d="M1 6.5c4 0 4-5 8-5s4 5 8 5h4" fill="none" stroke={color} strokeWidth="2" />
      <circle cx="1" cy="6.5" r="1" fill={color} />
      <circle cx="21" cy="6.5" r="1" fill={color} />
    </svg>
  );
}

function collectJobSites(locations: CrewLocation[]): Map<string, JobSite> {
  const sites = new Map<string, JobSite>();
  for (const location of locations) {
    if (!hasCoordinate(location.jobLatitude, location.jobLongitude)) continue;
    const key = jobSiteKey(location);
    const existing = sites.get(key);
    if (existing) {
      existing.shiftCount += 1;
      continue;
    }
    sites.set(key, {
      key,
      name: location.projectName,
      address: location.projectAddress,
      latitude: location.jobLatitude!,
      longitude: location.jobLongitude!,
      shiftCount: 1,
    });
  }
  return sites;
}

function jobSiteKey(location: CrewLocation): string {
  return location.projectId ?? `${location.jobLatitude}:${location.jobLongitude}`;
}

function crewColor(index: number): string {
  return CREW_COLORS[index % CREW_COLORS.length]!;
}

function heartbeatLevel(location: CrewLocation, now: number): HeartbeatLevel {
  if (location.shiftStatus === "complete") return "none";
  if (location.taskStatus === "geofence") return "geofence";
  if (location.taskStatus === "error" || location.taskStatus === "stopped") return "offline";
  const timestamp = Date.parse(location.lastSyncAt ?? "");
  if (!Number.isFinite(timestamp)) return "none";
  const age = Math.max(0, now - timestamp);
  if (age <= FRESH_HEARTBEAT_MS && location.taskStatus === "running") return "live";
  if (age <= DELAYED_HEARTBEAT_MS) return "delayed";
  return "offline";
}

function heartbeatLabel(level: HeartbeatLevel): string {
  if (level === "live") return "Live heartbeat";
  if (level === "delayed") return "Heartbeat delayed";
  if (level === "geofence") return "Geofence-only";
  if (level === "offline") return "Not reporting";
  return "No heartbeat";
}

function heartbeatTone(level: HeartbeatLevel): "good" | "warn" | "bad" | "neutral" {
  if (level === "live") return "good";
  if (level === "delayed" || level === "geofence") return "warn";
  if (level === "offline") return "bad";
  return "neutral";
}

function heartbeatSummary(location: CrewLocation, now: number): string {
  if (location.shiftStatus === "complete") {
    return `Clocked out ${fmtRelativeTime(location.endedAt, now)}`;
  }
  if (location.taskStatus === "geofence") {
    return location.lastSyncAt
      ? `Geofence-only app sync ${fmtRelativeTime(location.lastSyncAt, now)}`
      : "Geofence-only; no heartbeat recorded";
  }
  if (!location.lastSyncAt) return "No app heartbeat received";
  return `App heartbeat ${fmtRelativeTime(location.lastSyncAt, now)}`;
}

function heartbeatDetail(location: CrewLocation, now: number): string {
  if (location.shiftStatus === "complete") {
    const lastSync = location.lastSyncAt
      ? ` Last app sync ${fmtDateTime(location.lastSyncAt)}.`
      : " No app heartbeat was recorded.";
    return `Shift ended at ${fmtDateTime(location.endedAt)}; live reporting is no longer expected.${lastSync}`;
  }
  if (location.taskStatus === "geofence") {
    const last = location.lastSyncAt
      ? `${fmtRelativeTime(location.lastSyncAt, now)} (${fmtDateTime(location.lastSyncAt)})`
      : "unknown";
    return `Geofence-only mode; continuous heartbeat is not running. Last sync ${last}.`;
  }
  if (!location.lastSyncAt) return "No app sync has been recorded for this active shift.";
  return `${fmtRelativeTime(location.lastSyncAt, now)} · ${fmtDateTime(location.lastSyncAt)}`;
}

function gpsFreshnessFor(location: CrewLocation, now: number): GpsFreshness {
  if (location.locationSource === "none") return "unavailable";
  if (location.shiftStatus === "complete") return "historical";
  if (location.locationSource !== "tracking") return "fallback";
  const timestamp = Date.parse(location.lastLocationAt ?? "");
  if (!Number.isFinite(timestamp)) return "unavailable";
  const age = Math.max(0, now - timestamp);
  if (age <= FRESH_GPS_MS) return "fresh";
  if (age <= AGING_GPS_MS) return "aging";
  return "stale";
}

function gpsSummary(location: CrewLocation, now: number): string {
  if (location.locationSource === "none") return "No GPS fix for this shift";
  if (location.locationSource === "clock_in") {
    return `Clock-in GPS ${fmtRelativeTime(location.startedAt, now)} · no later fix`;
  }
  const accuracy = location.accuracyMeters != null ? ` · ±${Math.round(location.accuracyMeters)} m` : "";
  return `${location.shiftStatus === "complete" ? "Final GPS" : "GPS"} ${fmtRelativeTime(location.lastLocationAt, now)}${accuracy}`;
}

function gpsDetailTone(location: CrewLocation, now: number): "good" | "warn" | "bad" | "neutral" {
  if (location.shiftStatus === "complete") return "neutral";
  const freshness = gpsFreshnessFor(location, now);
  if (freshness === "fresh") return "good";
  if (freshness === "aging" || freshness === "fallback") return "warn";
  if (freshness === "stale") return "bad";
  return "neutral";
}

function gpsDetailClass(location: CrewLocation, now: number): string {
  const tone = gpsDetailTone(location, now);
  return cn(
    "text-[11px]",
    tone === "good"
      ? "text-[var(--color-good)]"
      : tone === "warn"
        ? "text-[var(--color-warn)]"
        : tone === "bad"
          ? "text-[var(--color-bad)]"
          : "text-[var(--color-muted)]",
  );
}

function latestGpsDetail(location: CrewLocation): string {
  if (location.locationSource === "none") return "No coordinate was recorded for this shift.";
  const capturedAt = location.locationSource === "clock_in" ? location.startedAt : location.lastLocationAt;
  const accuracy = location.accuracyMeters != null ? ` · ±${Math.round(location.accuracyMeters)} m` : "";
  const distance = location.distanceMeters != null ? ` · ${fmtDistance(location.distanceMeters)} from job` : "";
  const coordinates = hasCoordinate(location.latitude, location.longitude)
    ? ` · ${location.latitude!.toFixed(6)}, ${location.longitude!.toFixed(6)}`
    : "";
  return `${fmtDateTime(capturedAt)}${accuracy}${distance}${coordinates}`;
}

function trailSummary(location: CrewLocation): string {
  const count = location.trailPoints.length;
  if (count === 0) return "No recorded GPS fixes";
  if (count === 1) return "1 unique GPS fix · no movement trail yet";
  return `${count} unique GPS fixes · ${fmtDistance(location.trailDistanceMeters)} recorded path`;
}

function trailDetail(location: CrewLocation): string {
  if (location.trailPoints.length < 2) {
    return trailSummary(location);
  }
  const first = location.trailPoints[0]!;
  const last = location.trailPoints.at(-1)!;
  return `${trailSummary(location)} · ${fmtDateTime(first.capturedAt)} to ${fmtDateTime(last.capturedAt)}`;
}

function trackingStateDetail(location: CrewLocation): string {
  if (location.shiftStatus === "complete") return "Clocked out · live tracking ended as expected";
  const mode = trackingModeLabel(location.trackingMode);
  const task = taskStatusLabel(location.taskStatus);
  return `${mode} · ${task}`;
}

function trackingModeLabel(mode: TrackingMode | null): string {
  if (mode === "clocked_out") return "Clocked out";
  if (mode === "painting") return "At job";
  if (mode === "stationary") return "Stationary";
  if (mode === "travel") return "Travelling";
  if (mode === "unavailable") return "Tracking unavailable";
  return "Mode unknown";
}

function taskStatusLabel(status: TaskStatus | null): string {
  if (status === "running") return "background tracking running";
  if (status === "geofence") return "geofence-only tracking";
  if (status === "paused") return "tracking paused";
  if (status === "stopped") return "tracking stopped";
  if (status === "error") return "tracking error";
  return "heartbeat state unknown";
}

function siteStatusLabel(location: CrewLocation): string {
  if (location.locationSource === "none" || location.status === "unknown") return "Site status unknown";
  if (location.locationSource === "clock_in") {
    return location.status === "on_site" ? "On site at clock-in" : "Off site at clock-in";
  }
  if (location.shiftStatus === "complete") {
    return location.status === "on_site" ? "Final fix on site" : "Final fix off site";
  }
  return location.status === "on_site" ? "Last fix on site" : "Last fix off site";
}

function siteStatusTone(location: CrewLocation): "good" | "warn" | "neutral" {
  if (location.locationSource === "none" || location.status === "unknown") return "neutral";
  return location.status === "on_site" ? "good" : "warn";
}

function popupLocationDetail(location: CrewLocation): string {
  if (location.locationSource === "tracking") {
    return `${location.shiftStatus === "complete" ? "Final" : "Latest"} GPS ${fmtDateTime(location.lastLocationAt)}`;
  }
  if (location.locationSource === "clock_in") {
    return `Clock-in GPS ${fmtDateTime(location.startedAt)}; no later fix`;
  }
  return "No employee GPS received";
}

function shiftBadgeLabel(location: CrewLocation, heartbeat: HeartbeatLevel): string {
  if (location.shiftStatus === "complete") return "Clocked out";
  return heartbeatLabel(heartbeat);
}

function shiftBadgeTone(
  location: CrewLocation,
  heartbeat: HeartbeatLevel,
): "good" | "warn" | "bad" | "neutral" {
  if (location.shiftStatus === "complete") return "neutral";
  return heartbeatTone(heartbeat);
}

function shiftTimeSummary(location: CrewLocation): string {
  if (location.shiftStatus === "active") return `Clocked in ${fmtTime(location.startedAt)}`;
  return `${fmtTime(location.startedAt)}–${fmtTime(location.endedAt)} · clocked out`;
}

function shiftDetail(location: CrewLocation, now: number): string {
  const startedAt = Date.parse(location.startedAt);
  const endedAt = location.shiftStatus === "active" ? now : Date.parse(location.endedAt ?? "");
  const hours = Number.isFinite(startedAt) && Number.isFinite(endedAt)
    ? fmtHours(Math.max(0, endedAt - startedAt) / 3_600_000)
    : "duration unknown";
  if (location.shiftStatus === "active") {
    return `Clocked in ${fmtDateTime(location.startedAt)} · ${hours} so far`;
  }
  return `${fmtDateTime(location.startedAt)} to ${fmtDateTime(location.endedAt)} · ${hours} worked`;
}

function shiftSignalSummary(location: CrewLocation, now: number): string {
  if (location.shiftStatus === "complete") {
    return `Clocked out ${fmtRelativeTime(location.endedAt, now)}`;
  }
  return heartbeatSummary(location, now);
}

function trailPointTooltip(point: CrewTrailPoint, pointIndex: number): string {
  const event = point.eventTypes
    .filter((type) => type !== "latest_status")
    .map((type) => type.replaceAll("_", " "))
    .join(" + ");
  const accuracy = point.accuracyMeters != null ? ` · ±${Math.round(point.accuracyMeters)} m` : "";
  return `Fix ${pointIndex + 1} · ${fmtDateTime(point.capturedAt)}${accuracy}${event ? ` · ${event}` : ""}`;
}

function hasCoordinate(latitude: number | null, longitude: number | null): boolean {
  return (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

function popupElement(title: string, detail: string, secondary?: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "crew-map-popup";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const body = document.createElement("span");
  body.textContent = detail;
  element.append(heading, body);
  if (secondary) {
    const supporting = document.createElement("small");
    supporting.textContent = secondary;
    element.append(supporting);
  }
  return element;
}
