import { AutoRefresh } from "@/components/auto-refresh";
import { ConversationList, inboxHref } from "@/components/inbox/conversation-list";
import { SentActivity } from "@/components/inbox/sent-activity";
import { InboxThread } from "@/components/inbox/thread";
import { PageHeader } from "@/components/kpi";
import { PageTabs } from "@/components/page-tabs";
import { SearchIcon } from "@/components/pipeline-ui";
import { FilterPills, TablePanel, TableToolbar } from "@/components/table-ui";
import { Input, Spinner, cn } from "@/components/ui";
import { getConversation, getInbox, getOutboundActivity } from "@/lib/actions/inbox";
import { getMessagingSettings } from "@/lib/actions/messaging";
import { requireStaff } from "@/lib/auth";
import { INBOX_FILTERS, INBOX_MAX, INBOX_PAGE, OUTBOUND_FILTERS, isInboxFilter, isOutboundFilter } from "@/lib/inbox-types";

export const dynamic = "force-dynamic";

const isId = (value: string | undefined): value is string =>
  Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; filter?: string; status?: string; c?: string; q?: string; show?: string }>;
}) {
  const [, query] = await Promise.all([requireStaff(), searchParams]);
  const view = query.view === "sent" ? "sent" : "conversations";
  const tabs = (
    <PageTabs
      label="Inbox views"
      tabs={[
        { href: "/inbox", label: "Conversations", active: view === "conversations" },
        { href: "/inbox?view=sent", label: "Sent", active: view === "sent" },
      ]}
    />
  );

  if (view === "sent") {
    const status = isOutboundFilter(query.status) ? query.status : "all";
    const messages = await getOutboundActivity(status);
    return (
      <div className="page-fill">
        <PageHeader title="Inbox" />
        {tabs}
        <TableToolbar>
          <FilterPills
            label="Delivery status"
            value={status}
            options={OUTBOUND_FILTERS.map((option) => ({
              ...option,
              href: option.value === "all" ? "/inbox?view=sent" : `/inbox?view=sent&status=${option.value}`,
            }))}
          />
        </TableToolbar>
        <TablePanel fill>
          <SentActivity messages={messages} filter={status} />
        </TablePanel>
        <AutoRefresh everyMs={30_000} />
      </div>
    );
  }

  const filter = isInboxFilter(query.filter) ? query.filter : "all";
  const search = query.q?.trim().slice(0, 100) ?? "";
  const selectedId = isId(query.c) ? query.c : null;
  // "Show more" asks for the next page on top of what's showing.
  const limit = Math.min(INBOX_MAX, Math.max(INBOX_PAGE, Math.floor(Number(query.show) || 0)));
  const [inbox, thread, messaging] = await Promise.all([
    getInbox(filter, search, limit),
    selectedId ? getConversation(selectedId) : null,
    // Only managers can see the Quo connection.
    getMessagingSettings().catch(() => null),
  ]);
  const importing = messaging?.quoSync?.status === "running" ? messaging.quoSync : null;
  const moreHref =
    inbox.conversations.length >= limit && limit < INBOX_MAX
      ? inboxHref(filter, { conversation: selectedId, search, show: limit + INBOX_PAGE })
      : null;
  const open = thread?.id ? { ...thread, id: thread.id } : null;

  return (
    <div className="page-fill">
      <PageHeader title="Inbox" />
      {tabs}
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Conversations"
          className={cn(
            "flex w-full flex-col md:w-[340px] md:shrink-0 md:border-r md:border-[var(--color-border)]",
            open && "max-md:hidden",
          )}
        >
          {/* Same height as the thread header, so the two hairlines line up. */}
          <div className="flex h-14 shrink-0 items-center border-b border-[var(--color-border)] px-3">
            <FilterPills
              label="Show"
              value={filter}
              options={INBOX_FILTERS.map((option) => ({ ...option, href: inboxHref(option.value, { search }) }))}
            />
          </div>
          <form action="/inbox" className="relative shrink-0 border-b border-[var(--color-border)] px-3 py-2">
            {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
            <SearchIcon className="pointer-events-none absolute left-5.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-faint)]" />
            <Input
              type="search"
              name="q"
              defaultValue={search}
              aria-label="Search conversations"
              placeholder="Search name, number or message"
              className="pl-8"
            />
          </form>
          {importing ? (
            <p className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
              <Spinner className="h-3 w-3 text-[var(--color-brand)]" />
              Importing from Quo · {importing.conversations.toLocaleString()} conversations so far
            </p>
          ) : null}
          {/* relative: contains the rows' sr-only labels, so a long list can't stretch the page. */}
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <ConversationList
              conversations={inbox.conversations}
              filter={filter}
              search={search}
              selectedId={selectedId}
              show={limit}
              moreHref={moreHref}
            />
          </div>
        </aside>
        <section className={cn("flex min-w-0 flex-1 flex-col", !open && "max-md:hidden")}>
          {open ? (
            <InboxThread key={open.id} thread={open} backHref={inboxHref(filter, { search, show: limit })} />
          ) : (
            <p className="m-auto px-4 text-center text-[13px] text-[var(--color-muted)]">
              {selectedId ? "This conversation is no longer here." : inbox.conversations.length ? "Select a conversation." : ""}
            </p>
          )}
        </section>
      </div>
      <AutoRefresh everyMs={importing ? 5000 : 20_000} />
    </div>
  );
}
