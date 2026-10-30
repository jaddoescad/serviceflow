import Link from "next/link";
import { fmtHandle, fmtListTime } from "@/lib/inbox-format";
import { INBOX_PAGE, type InboxConversation, type InboxFilter } from "@/lib/inbox-types";
import { LinkPending } from "../link-pending";
import { ChatIcon, Initials, MailIcon, PhoneIcon } from "../pipeline-ui";
import { buttonClassName, cn } from "../ui";

export const inboxHref = (
  filter: InboxFilter,
  { conversation, search, show }: { conversation?: string | null; search?: string; show?: number } = {},
) => {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (search?.trim()) params.set("q", search.trim());
  if (show && show > INBOX_PAGE) params.set("show", String(show));
  if (conversation) params.set("c", conversation);
  const query = params.toString();
  return query ? `/inbox?${query}` : "/inbox";
};

const EMPTY: Record<InboxFilter, string> = {
  all: "No conversations yet. Customers' texts and email replies show up here.",
  unread: "You're all caught up.",
  sms: "No text conversations.",
  calls: "No calls.",
  email: "No email conversations.",
};

/** Unread conversations first, in bold with a blue dot; then the rest, newest first. */
export function ConversationList({
  conversations,
  filter,
  search,
  selectedId,
  show,
  moreHref,
}: {
  conversations: InboxConversation[];
  filter: InboxFilter;
  search: string;
  selectedId: string | null;
  /** How many conversations are showing. */
  show: number;
  /** The next page, when this one is full. */
  moreHref: string | null;
}) {
  if (!conversations.length) {
    return (
      <p className="px-4 py-12 text-center text-[13px] text-[var(--color-muted)]">
        {search ? `No conversations match “${search}”.` : EMPTY[filter]}
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-[var(--color-border)]">
        {conversations.map((conversation) => {
          const selected = conversation.id === selectedId;
          const name = conversation.name ?? fmtHandle(conversation.handle);
          return (
            <li key={conversation.id}>
              <Link
                href={inboxHref(filter, { conversation: conversation.id, search, show })}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex gap-2.5 px-3 py-2.5 outline-none transition-colors focus-visible:bg-[var(--color-hover)]",
                  selected ? "bg-[var(--color-selected)]" : "hover:bg-[var(--color-row-hover)]",
                )}
              >
                {conversation.name ? (
                  <Initials name={conversation.name} className="mt-0.5 h-7 w-7 text-[10px]" />
                ) : (
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--tag-gray-bg)] text-[var(--tag-gray-text)]">
                    {conversation.handle?.includes("@") ? <MailIcon className="h-3.5 w-3.5" /> : <PhoneIcon className="h-3.5 w-3.5" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[13px]",
                        conversation.isUnread ? "font-semibold text-[var(--color-heading)]" : "font-medium text-[var(--color-text)]",
                      )}
                    >
                      {name}
                    </span>
                    <LinkPending className="h-3 w-3 self-center text-[var(--color-faint)]" />
                    <time
                      dateTime={conversation.at}
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        conversation.isUnread ? "font-medium text-[var(--color-heading)]" : "text-[var(--color-faint)]",
                      )}
                    >
                      {fmtListTime(conversation.at)}
                    </time>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                    {conversation.channel === "email" ? (
                      <MailIcon className="h-3 w-3 text-[var(--color-faint)]" />
                    ) : conversation.channel === "call" ? (
                      <PhoneIcon className="h-3 w-3 text-[var(--color-faint)]" />
                    ) : (
                      <ChatIcon className="h-3 w-3 text-[var(--color-faint)]" />
                    )}
                    <span className={cn("min-w-0 flex-1 truncate", conversation.isUnread && "text-[var(--color-text)]")}>
                      {conversation.direction === "outbound" && conversation.channel !== "call" ? "You: " : ""}
                      {conversation.preview}
                    </span>
                    {conversation.isUnread ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand)]">
                        <span className="sr-only">Unread</span>
                      </span>
                    ) : null}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {moreHref ? (
        <div className="border-t border-[var(--color-border)] p-2">
          <Link href={moreHref} scroll={false} className={buttonClassName({ variant: "ghost", size: "sm", className: "w-full" })}>
            Show more conversations
          </Link>
        </div>
      ) : null}
    </>
  );
}
