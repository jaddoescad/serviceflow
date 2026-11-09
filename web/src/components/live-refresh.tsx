"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type LiveTable = "leads" | "contacts";

const POLL_MS = 60_000;

/**
 * Re-renders the page when the company's leads or contacts change, whatever
 * made the change (Zapier and other integrations, imports, teammates).
 * Database triggers broadcast on the private topic `org:<company>:<table>`.
 * Hidden tabs catch up when shown again; while disconnected the page polls,
 * and it re-fetches once on reconnect for anything it missed.
 */
export function LiveRefresh({ orgId, tables }: { orgId: string; tables: LiveTable[] }) {
  const router = useRouter();
  const topics = tables.map((table) => `org:${orgId}:${table}`).join(",");

  useEffect(() => {
    const supabase = createClient();
    const live = new Set<string>();
    const missed = new Set<string>();
    let stale = false;
    let cancelled = false;
    let timer: number | undefined;

    // An import fires several messages at once; refresh once after they settle.
    const refresh = () => {
      if (document.visibilityState !== "visible") {
        stale = true;
        return;
      }
      stale = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => router.refresh(), 400);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && stale) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    const channels = topics.split(",").map((topic) =>
      supabase.channel(topic, { config: { private: true } }).on("broadcast", { event: "*" }, refresh),
    );
    // Private channels need the signed-in user's token before joining.
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      for (const channel of channels) {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            live.add(channel.topic);
            if (missed.delete(channel.topic)) refresh();
          } else {
            live.delete(channel.topic);
            missed.add(channel.topic);
          }
        });
      }
    });

    const poll = window.setInterval(() => {
      if (live.size < channels.length) refresh();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [topics, router]);

  return null;
}
