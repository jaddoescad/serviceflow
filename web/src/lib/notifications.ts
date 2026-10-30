"use client";

import type { AppNotification } from "@/lib/notification-types";
import { createClient } from "@/lib/supabase/client";

// The bell and the /notifications page read and clear notifications from the
// browser, so the bell can stay live without a server round trip per update.

/** Something was marked read here; the other view refreshes. */
export const NOTIFICATIONS_CHANGED = "serviceflow:notifications-changed";
/** The bell heard a new notification arrive. */
export const NOTIFICATIONS_ARRIVED = "serviceflow:notifications-arrived";

/** Null when the request fails, so callers keep what they show. */
export async function fetchNotifications({
  limit = 20,
  after,
  unreadOnly = false,
}: { limit?: number; after?: AppNotification; unreadOnly?: boolean } = {}): Promise<AppNotification[] | null> {
  const { data, error } = await createClient().rpc("get_my_notifications", {
    requested_limit: limit,
    requested_before: after?.createdAt ?? null,
    requested_before_id: after?.id ?? null,
    requested_unread_only: unreadOnly,
  });
  return error ? null : ((data as AppNotification[] | null) ?? []);
}

export async function fetchUnreadCount(): Promise<number | null> {
  const { data, error } = await createClient().rpc("get_my_unread_notification_count");
  return error ? null : Number(data ?? 0);
}

/** No ids marks everything read. Returns what is still unread. */
export async function markNotificationsRead(ids?: string[]): Promise<number | null> {
  const { data, error } = await createClient().rpc("mark_notifications_read", {
    requested_ids: ids ?? null,
  });
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  return error ? null : Number(data ?? 0);
}
