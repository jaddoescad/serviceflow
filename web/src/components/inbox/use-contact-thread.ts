"use client";

import { useCallback, useEffect, useState } from "react";
import { getContactThread, markConversationRead } from "@/lib/actions/inbox";
import type { Thread } from "@/lib/inbox-types";
import { isSending } from "./thread";

/** A customer's thread, loaded in the browser and kept current: every 30
 * seconds, or every few while a message is going out. Reading it here counts
 * as reading it in the inbox. */
export function useContactThread(contactId: string | null) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!contactId) return;
    const result = await getContactThread(contactId).catch(() => ({ error: "Could not load messages.", thread: undefined }));
    if (result.error) setError(result.error);
    else {
      setError("");
      setThread(result.thread ?? null);
    }
  }, [contactId]);

  const sending = thread ? isSending(thread) : false;
  useEffect(() => {
    void reload();
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void reload();
      },
      sending ? 2500 : 30_000,
    );
    return () => window.clearInterval(timer);
  }, [reload, sending]);

  const unreadId = thread?.isUnread ? thread.id : null;
  useEffect(() => {
    if (unreadId) void markConversationRead(unreadId, true);
  }, [unreadId]);

  return { thread, error, reload };
}
