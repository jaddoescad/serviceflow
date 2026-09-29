"use client";

import { useEffect, useRef } from "react";
import type { TodayJob } from "@/components/today-board";
import { fmtTime, initials } from "@/lib/format";

const OTTAWA: [number, number] = [45.4215, -75.6972];

/** Where each painter clocked in today, with their job. */
export function TodayMap({ jobs }: { jobs: TodayJob[] }) {
  const container = useRef<HTMLDivElement>(null);
  const pins = jobs.flatMap((job) => job.crew.flatMap((c) => (c.location ? [{ ...c, job: job.name }] : [])));
  const key = JSON.stringify(pins.map((p) => [p.id, p.job, p.onClock, p.location]));

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
      for (const pin of pins) {
        const icon = L.divIcon({
          className: "",
          iconSize: [0, 0],
          html: `<div style="transform:translate(-50%,-100%);display:flex;align-items:center;gap:6px;white-space:nowrap;
            background:#fff;border-radius:999px;padding:3px 10px 3px 3px;box-shadow:0 1px 4px rgba(0,0,0,.25);font:600 12px system-ui">
            <span style="flex:none;width:22px;height:22px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;
              font-size:10px;color:#fff;background:${pin.onClock ? "#2563eb" : "#94a3b8"}">${initials(pin.name)}</span>
            <span style="color:#0f172a">${escapeHtml(pin.name.split(" ")[0]!)}</span></div>`,
        });
        L.marker([pin.location!.lat, pin.location!.lng], { icon })
          .bindPopup(`<strong>${escapeHtml(pin.name)}</strong><br>${escapeHtml(pin.job)}<br>${
            pin.onClock ? `Since ${fmtTime(pin.startedAt)}` : `${fmtTime(pin.startedAt)}–${fmtTime(pin.endedAt)}`}`)
          .addTo(map);
      }
      if (pins.length) {
        map.fitBounds(L.latLngBounds(pins.map((p) => [p.location!.lat, p.location!.lng])), { padding: [60, 60], maxZoom: 14 });
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="mt-4">
      <div ref={container} className="h-[60vh] min-h-80 overflow-hidden rounded-lg border border-slate-200" />
      {pins.length < jobs.flatMap((j) => j.crew).length ? (
        <p className="mt-2 text-xs text-slate-500">Painters who clocked in without a location are not shown.</p>
      ) : null}
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
