"use client";

import { createContext, useContext, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useLinkStatus } from "next/link";
import { ListPageSkeleton } from "./page-skeleton";
import { RoutePageLoader } from "./route-loading";

// Where a clicked link is going while its page loads, so the click shows at
// once: the sidebar selects the destination and the page area shows a loader.
const PendingHref = createContext<string | null>(null);
const SetPendingHref = createContext<Dispatch<SetStateAction<string | null>>>(() => {});

export function NavigationPendingProvider({ children }: { children: React.ReactNode }) {
  const [href, setHref] = useState<string | null>(null);
  return (
    <SetPendingHref.Provider value={setHref}>
      <PendingHref.Provider value={href}>{children}</PendingHref.Provider>
    </SetPendingHref.Provider>
  );
}

export function usePendingHref() {
  return useContext(PendingHref);
}

/** Put inside a Link whose page should show as loading from the click on. */
export function ReportPending({ href }: { href: string }) {
  const { pending } = useLinkStatus();
  const setHref = useContext(SetPendingHref);
  useEffect(() => {
    if (!pending) return;
    setHref(href);
    return () => setHref((current) => (current === href ? null : current));
  }, [pending, href, setHref]);
  return null;
}

/** Covers the page being left with the loading shape of the one coming. */
export function PendingPage() {
  const href = usePendingHref();
  if (!href) return null;
  return (
    <div className="app-content absolute inset-0 z-30 bg-[var(--color-surface)]">
      <div className="sticky top-0">
        {href.startsWith("/deals/") ? (
          <RoutePageLoader label="Loading deal" />
        ) : href.startsWith("/pipeline/") ? (
          <RoutePageLoader label="Loading pipeline" />
        ) : (
          <ListPageSkeleton />
        )}
      </div>
    </div>
  );
}
