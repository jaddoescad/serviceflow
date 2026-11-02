"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getInbox } from "@/lib/actions/inbox";
import { fmtHandle, fmtListTime } from "@/lib/inbox-format";
import type { InboxConversation } from "@/lib/inbox-types";
import { LinkPending } from "./link-pending";
import { ChatIcon, PhoneIcon } from "./pipeline-ui";
import { ShowMore } from "./show-more";
import { Spinner, cn } from "./ui";

/** Cards drawn at first, and each time the column's end scrolls near. */
const PAGE = 30;

function QuoCard({ conversation }: { conversation: InboxConversation }) {
  const href = `/inbox?c=${conversation.id}`;
  const number = fmtHandle(conversation.handle);
  const unread = conversation.isUnread;
  return (
    <article className="relative shrink-0 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-[border-color,box-shadow] hover:border-[var(--color-border-strong)] hover:shadow-[0_2px_6px_rgb(16_24_40/0.07)]">
      <div className="flex items-baseline gap-2">
        {/* The link covers the card, so the whole card opens the thread. */}
        <Link
          href={href}
          className={cn(
            "min-w-0 flex-1 truncate text-[13.5px] leading-5 text-[var(--color-heading)] outline-none before:absolute before:inset-0 before:rounded-[inherit] focus-visible:before:shadow-[var(--focus-ring)]",
            unread ? "font-semibold" : "font-medium",
          )}
        >
          {conversation.name ?? number}
        </Link>
        <LinkPending className="h-3 w-3 self-center text-[var(--color-faint)]" />
        <time
          dateTime={conversation.at}
          className={cn("shrink-0 text-[11px] tabular-nums", unread ? "font-medium text-[var(--color-heading)]" : "text-[var(--color-faint)]")}
        >
          {fmtListTime(conversation.at)}
        </time>
      </div>
      {conversation.name ? <p className="truncate text-[11px] leading-[14px] text-[var(--color-faint)]">{number}</p> : null}
      <p className="mt-2 flex items-start gap-1.5 text-xs leading-[18px] text-[var(--color-muted)]">
        {conversation.channel === "call" ? (
          <PhoneIcon className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-faint)]" />
        ) : (
          <ChatIcon className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-faint)]" />
        )}
        <span className={cn("line-clamp-2 min-w-0 flex-1 break-words", unread && "text-[var(--color-text)]")}>
          {conversation.direction === "outbound" && conversation.channel !== "call" ? "You: " : ""}
          {conversation.preview}
        </span>
        {unread ? (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand)]">
            <span className="sr-only">Unread</span>
          </span>
        ) : null}
      </p>
    </article>
  );
}

/** The pipeline board's first column: the company's Quo texts and calls, one
 * card per number, unread first. Loads after the board and stays current. */
export function QuoColumn({ search }: { search: string }) {
  const [conversations, setConversations] = useState<InboxConversation[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      const inbox = await getInbox("all");
      setConversations(inbox.conversations);
      setUnreadCount(inbox.unreadCount);
      setError("");
    } catch {
      setError("Could not load Quo messages.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const query = search.trim().toLocaleLowerCase("en-CA");
  const digits = query.replace(/\D/g, "");
  const visible = useMemo(
    () =>
      (conversations ?? []).filter(
        (conversation) =>
          !query ||
          [conversation.name, conversation.preview].some((value) => value?.toLocaleLowerCase("en-CA").includes(query)) ||
          (digits.length >= 3 && conversation.handle?.replace(/\D/g, "").includes(digits)),
      ),
    [conversations, query, digits],
  );

  return (
    <section aria-label="Quo" className="flex h-full w-[264px] shrink-0 flex-col">
      <header className="flex h-8 items-center gap-2 px-1.5">
        <ChatIcon className="h-3.5 w-3.5 text-[var(--color-muted)]" />
        <h2 className="text-[13px] font-semibold text-[var(--color-heading)]">Quo</h2>
        {unreadCount ? (
          <span className="text-xs font-medium tabular-nums text-[var(--color-brand)]">{unreadCount} unread</span>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[var(--radius)] bg-[var(--color-surface-2)] p-2 pb-4">
        {!conversations ? (
          error ? (
            <p className="py-8 text-center text-[13px] text-[var(--tag-red-text)]">{error}</p>
          ) : (
            <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-[var(--color-muted)]">
              <Spinner />
              Loading…
            </p>
          )
        ) : visible.length ? (
          <>
            {visible.slice(0, shown).map((conversation) => (
              <QuoCard key={conversation.id} conversation={conversation} />
            ))}
            {visible.length > shown ? (
              <ShowMore count={visible.length - shown} onMore={() => setShown((current) => current + PAGE)} />
            ) : null}
          </>
        ) : (
          <p className="py-8 text-center text-[13px] text-[var(--color-faint)]">
            {query ? "No matches" : "Texts and calls from Quo show up here."}
          </p>
        )}
      </div>
    </section>
  );
}
