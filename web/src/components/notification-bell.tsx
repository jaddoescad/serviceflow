"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { BELL_PATHS, NotificationRows, opensElsewhere, withRead } from "@/components/notification-feed";
import { cn } from "@/components/ui";
import type { AppNotification } from "@/lib/notification-types";
import {
  NOTIFICATIONS_ARRIVED,
  NOTIFICATIONS_CHANGED,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
} from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";

const PANEL_WIDTH = 380;
const GUTTER = 12;
const POLL_MS = 60_000;

/** 28px bell for the sidebar header: unread count, and a panel with the
 * latest notifications. Updates live over Supabase realtime, polling only
 * while realtime is unavailable. */
export function NotificationBell({ userId }: { userId: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [live, setLive] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const load = useCallback(async () => {
    const [unread, latest] = await Promise.all([
      fetchUnreadCount(),
      openRef.current ? fetchNotifications({ limit: 20 }) : null,
    ]);
    if (unread !== null) setCount(unread);
    if (latest) setItems(latest);
  }, []);

  // Marking many rows read sends one realtime event per row; refresh once.
  const timer = useRef<number | undefined>(undefined);
  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), 250);
  }, [load]);

  useEffect(() => {
    void load();
    const visible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load, refresh]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          refresh();
          if (payload.eventType === "INSERT") window.dispatchEvent(new Event(NOTIFICATIONS_ARRIVED));
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  useEffect(() => {
    if (live) return;
    const id = window.setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [live, refresh]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => setOpen(false), [pathname]);

  // Fixed to the viewport (portalled), right-aligned under the bell and kept
  // on screen, so it can extend past the sidebar.
  useLayoutEffect(() => {
    if (!open) return;
    function measure() {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(PANEL_WIDTH, window.innerWidth - GUTTER * 2);
      const left = Math.min(Math.max(GUTTER, rect.right - width), window.innerWidth - width - GUTTER);
      const top = rect.bottom + 6;
      setPlace({ top, left, width, maxHeight: Math.min(560, window.innerHeight - top - GUTTER) });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function openItem(item: AppNotification, event: MouseEvent) {
    if (!item.readAt) {
      setItems((current) => current && withRead(current, [item.id]));
      setCount((current) => Math.max(0, current - 1));
      void markNotificationsRead([item.id]);
    }
    if (!opensElsewhere(event)) setOpen(false);
  }

  function markAll() {
    setItems((current) => current && withRead(current));
    setCount(0);
    void markNotificationsRead();
  }

  const label = count ? `Notifications, ${count} unread` : "Notifications";

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        title="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]",
          open ? "bg-[var(--color-hover)] text-[var(--color-heading)]" : "text-[var(--color-muted)]",
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          {BELL_PATHS}
        </svg>
        {count ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--color-brand)] px-[3px] text-[9px] font-semibold leading-none tabular-nums text-[var(--color-brand-ink)] ring-2 ring-[var(--sidebar-bg)]"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>
      {open && place
        ? createPortal(
            <div
              ref={panel}
              role="dialog"
              aria-label="Notifications"
              tabIndex={-1}
              style={{ top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight }}
              className="fixed z-50 flex flex-col overflow-hidden rounded-[var(--radius)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)] outline-none"
            >
              <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] pl-3 pr-1.5">
                <h2 className="text-[13px] font-semibold text-[var(--color-heading)]">Notifications</h2>
                {count ? (
                  <button
                    type="button"
                    onClick={markAll}
                    className="h-7 rounded-md px-2 text-xs font-medium text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]"
                  >
                    Mark all read
                  </button>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-1">
                {items === null ? (
                  <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">Loading…</p>
                ) : items.length ? (
                  <NotificationRows items={items} onOpen={openItem} />
                ) : (
                  <p className="px-4 py-10 text-center text-[13px] text-[var(--color-muted)]">No notifications yet.</p>
                )}
              </div>
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="flex h-9 shrink-0 items-center justify-center border-t border-[var(--color-border)] text-xs font-medium text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:bg-[var(--color-hover)]"
              >
                View all
              </Link>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
