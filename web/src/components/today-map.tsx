"use client";

import { useEffect, useRef } from "react";
import type { TodayProject } from "@/components/today-board";
import "leaflet/dist/leaflet.css";
import "./today-map.css";

const OTTAWA: [number, number] = [45.4215, -75.6972];

/** Today's projects as labelled pins; clicking one scrolls to its card. */
export function TodayMap({ projects }: { projects: TodayProject[] }) {
  const container = useRef<HTMLDivElement>(null);
  const pins = projects.filter((p) => p.location);
  const key = JSON.stringify(pins.map((p) => [p.id, p.location, p.painters.filter((c) => c.todayAt).length]));

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !container.current) return;
      map = L.map(container.current, { center: OTTAWA, zoom: 10, scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      for (const project of pins) {
        const count = project.painters.filter((c) => c.todayAt).length;
        const icon = L.divIcon({
          className: "",
          iconSize: [0, 0],
          html: `<div style="transform:translate(-50%,-100%);width:max-content;display:flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer;
            background:#fff;border-radius:999px;padding:3px 10px 3px 3px;box-shadow:0 1px 4px rgba(0,0,0,.25);font:600 12px system-ui">
            <span style="flex:none;min-width:22px;height:22px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;
              font-size:11px;color:#fff;background:#10b981">${count}</span>
            <span style="color:#0f172a">${escapeHtml(project.name)}</span></div>`,
        });
        L.marker([project.location!.lat, project.location!.lng], { icon, title: project.name })
          .on("click", () => document.getElementById(`project-${project.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }))
          .addTo(map);
      }
      if (pins.length) {
        map.fitBounds(L.latLngBounds(pins.map((p) => [p.location!.lat, p.location!.lng])), { padding: [50, 50], maxZoom: 14 });
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={container} className="mt-4 h-80 overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] lg:h-96" />;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
