"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Opt-in QA only: append ?__perf=1 on arrival. No data leaves the browser. */
export function NavigationTiming() {
  const pathname = usePathname();
  const enabled = useRef(false);
  const pending = useRef<{ path: string; start: number } | null>(null);
  useEffect(() => {
    enabled.current = new URLSearchParams(location.search).get("__perf") === "1";
    if (!enabled.current) return;
    let observer: MutationObserver | null = null;
    function record(path: string, start: number, kind: string) {
      observer?.disconnect();
      // App Router may commit its loading boundary before page data arrives.
      // Stop the clock only once the destination's content heading is mounted.
      if (!document.querySelector("main h1")) {
        observer = new MutationObserver(() => {
          if (location.pathname === path && document.querySelector("main h1")) {
            observer?.disconnect();
            record(path, start, kind);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return;
      }
      const contentCommitted = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const end = performance.now();
        const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .filter(row => row.startTime >= start && row.startTime <= end);
        const routeRequests = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .filter(row => { const url = new URL(row.name); return url.origin === location.origin && url.pathname === path && url.searchParams.has("_rsc"); });
        const lastRouteRequest = routeRequests.at(-1);
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        console.info("SERVICEFLOW_PERF " + JSON.stringify({
          path, kind, visibleMs: Math.round(end - start), contentCommitMs: Math.round(contentCommitted - start), frameWaitMs: Math.round(end - contentCommitted), visibility: document.visibilityState,
          prefetched: kind === "navigation" && !!lastRouteRequest && lastRouteRequest.responseEnd <= start,
          routeDurationMs: lastRouteRequest ? Math.round(lastRouteRequest.duration) : null,
          dataFetchMs: Number(document.querySelector("main [data-perf-fetch-ms]")?.getAttribute("data-perf-fetch-ms")) || null,
          routeResponseWaitMs: lastRouteRequest ? Math.round(lastRouteRequest.responseStart - lastRouteRequest.requestStart) : null,
          requests: resources.length + (kind === "load" && navigation ? 1 : 0),
          transferredBytes: resources.reduce((sum, row) => sum + row.transferSize, 0) + (kind === "load" ? navigation?.transferSize ?? 0 : 0),
          documentBytes: kind === "load" ? navigation?.transferSize ?? 0 : null,
          routeBytes: lastRouteRequest?.transferSize ?? null,
          contentReady: true,
          responseWaitMs: kind === "load" && navigation ? Math.round(navigation.responseStart - navigation.requestStart) : null,
          resourceResponseWaitMs: resources.filter(row => row.responseStart > 0)
            .map(row => Math.round(row.responseStart - row.requestStart)),
        }));
      }));
    }
    record(location.pathname, 0, "load");
    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === "_blank") return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      pending.current = { path: url.pathname, start: performance.now() };
    }
    function committed() {
      const entry = pending.current;
      if (!entry || entry.path !== location.pathname) return;
      pending.current = null;
      record(entry.path, entry.start, "navigation");
    }
    document.addEventListener("click", click, true);
    window.addEventListener("serviceflow:route-committed", committed);
    return () => {
      observer?.disconnect();
      document.removeEventListener("click", click, true);
      window.removeEventListener("serviceflow:route-committed", committed);
    };
  }, []);
  useEffect(() => { window.dispatchEvent(new Event("serviceflow:route-committed")); }, [pathname]);
  return null;
}
