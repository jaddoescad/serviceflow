"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { PageHeader } from "@/components/kpi";
import { FilterPills, TableToolbar } from "@/components/table-ui";
import { Button, EmptyState, cn } from "@/components/ui";
import { dayKey, fmtDateTime } from "@/lib/format";
import type { AppNotification, NotificationKind } from "@/lib/notification-types";
import {
  NOTIFICATIONS_ARRIVED,
  fetchNotifications,
  markNotificationsRead,
} from "@/lib/notifications";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      {children}
    </svg>
  );
}

const EYE = (
  <Glyph>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Glyph>
);
const CHECK = (
  <Glyph>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Glyph>
);
const CROSS = (
  <Glyph>
    <path d="M7 7l10 10M17 7 7 17" />
  </Glyph>
);
const DOLLAR = (
  <Glyph>
    <path d="M12 3v18M16.5 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7" />
  </Glyph>
);
const CALENDAR = (
  <Glyph>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
  </Glyph>
);
const PERSON = (
  <Glyph>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M22 11h-6" />
  </Glyph>
);
const CHAT = (
  <Glyph>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
  </Glyph>
);
export const BELL_PATHS = (
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>
);

// Blue asks for a reply, green is won or paid, red is lost, gray is FYI.
const GRAY = "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-text)]";
const BLUE = "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-text)]";
const GREEN = "bg-[var(--tag-green-bg)] text-[var(--tag-green-text)]";
const RED = "bg-[var(--tag-red-bg)] text-[var(--tag-red-text)]";

const KINDS: Record<NotificationKind, [tint: string, icon: ReactNode]> = {
  proposal_viewed: [GRAY, EYE],
  invoice_viewed: [GRAY, EYE],
  proposal_accepted: [GREEN, CHECK],
  change_order_accepted: [GREEN, CHECK],
  invoice_paid: [GREEN, DOLLAR],
  payment: [GREEN, DOLLAR],
  proposal_declined: [RED, CROSS],
  change_order_declined: [RED, CROSS],
  new_lead: [BLUE, PERSON],
  appointment_request: [BLUE, CALENDAR],
  message_received: [BLUE, CHAT],
};

function KindIcon({ kind }: { kind: string }) {
  const [tint, icon] = KINDS[kind as NotificationKind] ?? [GRAY, <Glyph>{BELL_PATHS}</Glyph>];
  return (
    <span className={cn("mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full", tint)}>{icon}</span>
  );
}

function shortAgo(value: string, now: number): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(value)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric" });
}

/** True for clicks the browser should handle itself (new tab or window). */
export function opensElsewhere(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/** Notifications grouped Today / Earlier. Opening one marks it read.
 * `page` runs the rows edge to edge with hairlines (the /notifications page);
 * the default is the compact bell popover list. */
export function NotificationRows({
  items,
  onOpen,
  variant = "menu",
}: {
  items: AppNotification[];
  onOpen: (item: AppNotification, event: MouseEvent) => void;
  variant?: "menu" | "page";
}) {
  const page = variant === "page";
  const now = Date.now();
  const today = dayKey(new Date(now));
  const groups = [
    { label: "Today", rows: items.filter((item) => dayKey(item.createdAt) === today) },
    { label: "Earlier", rows: items.filter((item) => dayKey(item.createdAt) !== today) },
  ].filter((group) => group.rows.length);

  return (
    <>
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3
            className={
              page
                ? "flex h-9 items-center border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-[var(--gutter)] text-xs font-medium text-[var(--color-muted)]"
                : "px-3 pb-1 pt-3 text-[11px] font-medium text-[var(--color-faint)]"
            }
          >
            {group.label}
          </h3>
          <ul className={page ? "divide-y divide-[var(--color-border)] border-b border-[var(--color-border)]" : undefined}>
            {group.rows.map((item) => {
              const unread = !item.readAt;
              const className = cn(
                "flex w-full gap-2.5 text-left outline-none transition-colors hover:bg-[var(--color-hover)] focus-visible:bg-[var(--color-hover)]",
                page ? "gap-3 px-[var(--gutter)] py-2.5 hover:bg-[var(--color-row-hover)]" : "px-3 py-2",
              );
              const content = (
                <>
                  <KindIcon kind={item.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span
                        className={cn(
                          "line-clamp-2 min-w-0 flex-1 text-[13px] leading-5",
                          unread ? "font-medium text-[var(--color-heading)]" : "text-[var(--color-text)]",
                        )}
                      >
                        {item.title}
                      </span>
                      <time
                        dateTime={item.createdAt}
                        title={fmtDateTime(item.createdAt)}
                        suppressHydrationWarning
                        className="shrink-0 text-xs leading-5 tabular-nums text-[var(--color-faint)]"
                      >
                        {shortAgo(item.createdAt, now)}
                      </time>
                      <span
                        aria-label={unread ? "Unread" : undefined}
                        className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", unread && "bg-[var(--color-brand)]")}
                      />
                    </span>
                    {item.body ? (
                      <span className="mt-px block line-clamp-2 text-xs leading-[18px] text-[var(--color-muted)]">{item.body}</span>
                    ) : null}
                  </span>
                </>
              );
              return (
                <li key={item.id}>
                  {item.link ? (
                    <Link href={item.link} onClick={(event) => onOpen(item, event)} className={className}>
                      {content}
                    </Link>
                  ) : (
                    <button type="button" onClick={(event) => onOpen(item, event)} className={className}>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Marks the given rows read in local state. No ids marks all. */
export function withRead(items: AppNotification[], ids?: string[]): AppNotification[] {
  const readAt = new Date().toISOString();
  return items.map((item) => (!item.readAt && (!ids || ids.includes(item.id)) ? { ...item, readAt } : item));
}

const PAGE_SIZE = 50;

/** The /notifications page body: All / Unread, mark all read, load more. */
export function NotificationsView({ initial, unreadOnly }: { initial: AppNotification[]; unreadOnly: boolean }) {
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length >= PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const unread = items.some((item) => !item.readAt);

  // Newly arrived notifications show up at the top without a reload.
  const reloadTop = useCallback(async () => {
    const top = await fetchNotifications({ limit: PAGE_SIZE, unreadOnly });
    if (!top) return;
    setItems((current) => {
      const ids = new Set(top.map((item) => item.id));
      const oldest = top.at(-1)?.createdAt;
      return [...top, ...current.filter((item) => !ids.has(item.id) && Boolean(oldest) && item.createdAt < oldest!)];
    });
  }, [unreadOnly]);
  useEffect(() => {
    const listener = () => void reloadTop();
    window.addEventListener(NOTIFICATIONS_ARRIVED, listener);
    return () => window.removeEventListener(NOTIFICATIONS_ARRIVED, listener);
  }, [reloadTop]);

  async function loadMore() {
    setLoading(true);
    const next = await fetchNotifications({ limit: PAGE_SIZE, after: items.at(-1), unreadOnly });
    setLoading(false);
    if (!next) return;
    setItems((current) => [...current, ...next.filter((item) => !current.some((row) => row.id === item.id))]);
    setHasMore(next.length >= PAGE_SIZE);
  }

  function open(item: AppNotification) {
    if (item.readAt) return;
    setItems((current) => withRead(current, [item.id]));
    void markNotificationsRead([item.id]);
  }

  function markAll() {
    setItems((current) => withRead(current));
    void markNotificationsRead();
  }

  return (
    <div className="page-fill">
      <PageHeader
        title="Notifications"
        actions={
          unread ? (
            <Button variant="secondary" onClick={markAll}>
              Mark all read
            </Button>
          ) : null
        }
      />
      <TableToolbar>
        <FilterPills
          label="Show"
          value={unreadOnly ? "unread" : "all"}
          options={[
            { value: "all", label: "All", href: "/notifications" },
            { value: "unread", label: "Unread", href: "/notifications?filter=unread" },
          ]}
        />
      </TableToolbar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length ? (
          <NotificationRows items={items} onOpen={open} variant="page" />
        ) : (
          <EmptyState>{unreadOnly ? "You're all caught up." : "No notifications yet."}</EmptyState>
        )}
        {hasMore ? (
          <div className="flex justify-center py-2">
            <Button variant="ghost" size="sm" disabled={loading} onClick={loadMore}>
              {loading ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
