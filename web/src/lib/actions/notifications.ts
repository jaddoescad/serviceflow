"use server";

import { requireMember } from "@/lib/auth";
import type { AppNotification } from "@/lib/notification-types";
import { createClient } from "@/lib/supabase/server";

/** The signed-in person's notifications, newest first (first page of /notifications). */
export async function getNotifications({
  limit = 50,
  unreadOnly = false,
}: { limit?: number; unreadOnly?: boolean } = {}): Promise<AppNotification[]> {
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_notifications", {
    requested_limit: limit,
    requested_unread_only: unreadOnly,
  });
  if (error) throw new Error(`get_my_notifications: ${error.message}`);
  return (data as AppNotification[] | null) ?? [];
}
