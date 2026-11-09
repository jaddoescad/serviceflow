"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NOTIFICATIONS_ARRIVED } from "@/lib/notifications";

type Arrival = { id: string; kind: string; title: string; body: string | null; link: string | null };

const SHOW_MS = 6_000;

/**
 * "New lead: Jane Dupont · Website" at the bottom of any page when a new-lead
 * notification reaches the signed-in person (the notification bell receives it
 * live and passes the row along).
 */
export function NewLeadToast() {
  const [lead, setLead] = useState<Arrival | null>(null);
  // The bell can be mounted twice (sidebar and mobile header); show each lead once.
  const shown = useRef(new Set<string>());

  useEffect(() => {
    const onArrived = (event: Event) => {
      const row = (event as CustomEvent<Arrival | undefined>).detail;
      if (row?.kind !== "new_lead" || shown.current.has(row.id)) return;
      shown.current.add(row.id);
      setLead(row);
    };
    window.addEventListener(NOTIFICATIONS_ARRIVED, onArrived);
    return () => window.removeEventListener(NOTIFICATIONS_ARRIVED, onArrived);
  }, []);

  useEffect(() => {
    if (!lead) return;
    const timer = window.setTimeout(() => setLead(null), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [lead]);

  if (!lead) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-[var(--radius)] bg-[var(--color-heading)] px-3 py-2 text-[13px] text-[var(--color-bg)] shadow-[var(--shadow-pop)] print:hidden"
    >
      <span className="min-w-0 truncate">
        <span className="font-semibold">{lead.title}</span>
        {lead.body ? ` · ${lead.body}` : null}
      </span>
      {lead.link ? (
        <Link
          href={lead.link}
          onClick={() => setLead(null)}
          className="shrink-0 font-semibold underline underline-offset-2 outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          View
        </Link>
      ) : null}
    </div>
  );
}
