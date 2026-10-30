"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getUnreadInboxCount } from "@/lib/actions/inbox";

const UnreadInbox = createContext(0);

/** Unread inbox conversations, for the sidebar badge. */
export const useUnreadInbox = () => useContext(UnreadInbox);

const PREFIX = /^\(\d+\+?\) /;

/** Keeps the unread count current between page loads (every 30 seconds while
 * the tab is open, and when it comes back into view) and shows it in front of
 * the page title: "(3) Inbox". */
export function UnreadInboxProvider({ initial, children }: { initial: number; children: ReactNode }) {
  const [count, setCount] = useState(initial);
  useEffect(() => setCount(initial), [initial]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      getUnreadInboxCount().then(setCount, () => undefined);
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    const label = count > 99 ? "99+" : String(count);
    const apply = () => {
      const base = document.title.replace(PREFIX, "");
      const next = count > 0 ? `(${label}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    // Each page sets its own title; put the count back in front of it.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [count]);

  return <UnreadInbox.Provider value={count}>{children}</UnreadInbox.Provider>;
}
