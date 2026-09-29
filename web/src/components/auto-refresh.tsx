"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the current server page on an interval while the tab is visible. */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [router, everyMs]);
  return null;
}
