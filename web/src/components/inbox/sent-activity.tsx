import { fmtDateTime } from "@/lib/format";
import { fmtHandle } from "@/lib/inbox-format";
import { MESSAGE_KIND_LABELS, OUTBOUND_STATUS, type OutboundActivity, type OutboundFilter } from "@/lib/inbox-types";
import { ChatIcon, MailIcon } from "../pipeline-ui";
import { DataTable, RowLink, Td, Th, Tr } from "../table-ui";
import { Badge, EmptyState, Tag } from "../ui";

const EMPTY: Record<OutboundFilter, string> = {
  all: "Nothing sent yet. Drips, reminders, documents and replies show here once they go out.",
  queued: "Nothing waiting to send.",
  sent: "Nothing sent yet.",
  failed: "No failed messages.",
  skipped: "No skipped messages.",
};

function when(message: OutboundActivity): string {
  if (message.status === "sent" && message.sentAt) return fmtDateTime(message.sentAt);
  if (message.status === "queued" || message.status === "sending") return `Sends ${fmtDateTime(message.scheduledFor)}`;
  return fmtDateTime(message.scheduledFor);
}

function recipientHref(message: OutboundActivity): string | null {
  if (message.conversationId) return `/inbox?c=${encodeURIComponent(message.conversationId)}`;
  if (message.recordId) return `/deals/${encodeURIComponent(message.recordId)}`;
  return null;
}

/** Every message the queue sent or tried to send, with why it didn't go out. */
export function SentActivity({ messages, filter }: { messages: OutboundActivity[]; filter: OutboundFilter }) {
  if (!messages.length) return <EmptyState>{EMPTY[filter]}</EmptyState>;
  return (
    <DataTable minWidth={880}>
      <thead>
        <tr>
          <Th className="w-[200px]">To</Th>
          <Th>Message</Th>
          <Th className="w-[90px]">Channel</Th>
          <Th className="w-[260px]">Status</Th>
          <Th className="w-[160px]">When</Th>
        </tr>
      </thead>
      <tbody>
        {messages.map((message) => {
          const status = OUTBOUND_STATUS[message.status] ?? { label: message.status, tone: "gray" as const };
          const href = recipientHref(message);
          const name = message.isTest
            ? message.to ?? "Test send"
            : message.customerName ?? (message.channel === "sms" ? fmtHandle(message.to) : message.to) ?? "—";
          return (
            <Tr key={message.id}>
              <Td className="max-w-[200px] truncate">
                {href && !message.isTest ? <RowLink href={href}>{name}</RowLink> : name}
              </Td>
              <Td className="max-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <Tag>{message.isTest ? "Test" : MESSAGE_KIND_LABELS[message.kind]}</Tag>
                  <span className="min-w-0 truncate text-[var(--color-text)]">
                    {message.subject ? <span className="font-medium text-[var(--color-heading)]">{message.subject} </span> : null}
                    <span className="text-[var(--color-muted)]">{message.preview}</span>
                  </span>
                </span>
              </Td>
              <Td muted>
                <span className="flex items-center gap-1.5">
                  {message.channel === "email" ? <MailIcon className="h-3.5 w-3.5" /> : <ChatIcon className="h-3.5 w-3.5" />}
                  {message.channel === "email" ? "Email" : "Text"}
                </span>
              </Td>
              <Td className="max-w-[260px]">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {message.error && message.status !== "sent" ? (
                    <span title={message.error} className="min-w-0 truncate text-xs text-[var(--color-muted)]">
                      {message.error}
                    </span>
                  ) : message.deliveredAt ? (
                    <span className="text-xs text-[var(--color-muted)]">Delivered</span>
                  ) : null}
                </span>
              </Td>
              <Td muted className="whitespace-nowrap tabular-nums">
                {when(message)}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
