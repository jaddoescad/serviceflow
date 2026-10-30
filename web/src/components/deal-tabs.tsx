"use client";

import Link from "next/link";
import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { deleteProjectNote, saveProjectNote } from "@/lib/actions/crm";
import { queueCustomerMessage } from "@/lib/actions/messaging";
import { updateDealNote } from "@/lib/actions/pipeline";
import { INVOICE_STATUS } from "@/lib/billing-types";
import type { DealOverview } from "@/lib/crm-types";
import { fmtDate, fmtDateTime, fmtRelativeTime, fmtTime } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import type { Thread } from "@/lib/inbox-types";
import { RECORD_STATUS_OPTIONS, type DealExtras } from "@/lib/pipeline-types";
import { PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_TONES, type ProposalStatus } from "@/lib/proposal-types";
import { Composer, ThreadMessages, ThreadScroller, useEarlierMessages } from "./inbox/thread";
import { useContactThread } from "./inbox/use-contact-thread";
import { DocumentIcon, Initials, fmtDay, linkStyle } from "./pipeline-ui";
import { Badge, Button, Spinner, Tag, Textarea, buttonClassName, cn } from "./ui";

/** The deal page's center panels: communications, notes and the records
 * hanging off the deal. */

export const JOB_STATUS_LABELS: Record<string, string> = Object.fromEntries(RECORD_STATUS_OPTIONS.jobs);

type Status = { label: string; tone: NonNullable<ComponentProps<typeof Badge>["tone"]> };

export const proposalStatus = (status: string): Status => ({
  label: PROPOSAL_STATUS_LABELS[status as ProposalStatus] ?? status,
  tone: PROPOSAL_STATUS_TONES[status as ProposalStatus] ?? "neutral",
});

export const appointmentStatus = (status: string): Status => ({
  label: status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " "),
  tone: status === "scheduled" ? "blue" : status === "completed" ? "green" : "gray",
});

/** Hairline-bordered list of 40px rows, Attio's table feel. */
const list = "divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]";
const row = "flex min-h-10 items-center gap-3 px-3 py-2 text-[13px] hover:bg-[var(--color-row-hover)]";

function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-[13px] text-[var(--color-muted)]">
      <p>{children}</p>
      {action}
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError("");
    startTransition(async () => {
      const result = await action().catch(() => ({ ok: false, error: undefined }));
      if (!result.ok) setError(result.error ?? "Could not save. Try again.");
      else {
        after?.();
        router.refresh();
      }
    });
  }
  return { error, pending, run };
}

/** What the deal page already has, shown until the customer's full thread loads. */
function dealThread(deal: DealOverview): Thread {
  return {
    id: null,
    orgId: "",
    isUnread: false,
    handle: null,
    name: null,
    contact: deal.contact.id
      ? { id: deal.contact.id, name: deal.contact.name, email: deal.contact.email, phone: deal.contact.phone }
      : null,
    record: null,
    optOuts: [],
    quoConnected: true,
    messages: [...deal.messages]
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .map((message) => ({
        id: message.id,
        direction: "outbound" as const,
        channel: message.channel,
        subject: message.subject,
        body: message.body,
        attachments: [],
        at: message.at,
        status: message.status,
        kind: message.isDrip ? ("drip" as const) : ("manual" as const),
        error: message.error,
        deliveredAt: null,
        authorName: null,
        from: null,
        to: null,
        call: null,
      })),
  };
}

/** The customer's whole two-way thread (texts and emails both ways, drips,
 * reminders and documents), the same one the inbox shows. */
export function CommunicationsPanel({ deal }: { deal: DealOverview }) {
  const { thread: loaded, error, reload } = useContactThread(deal.contact.id);
  const thread = loaded ?? dealThread(deal);
  const { messages, earlier } = useEarlierMessages(thread);
  const firstName = deal.contact.name?.trim().split(/\s+/)[0];
  return (
    <div className="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        <ThreadScroller
          scrollKey={thread.messages[thread.messages.length - 1]?.id}
          className="max-h-[560px] px-4 py-5 xl:max-h-none xl:flex-1"
        >
          {deal.contact.id && !loaded && !error ? (
            <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-[var(--color-muted)]">
              <Spinner />
              Loading messages…
            </p>
          ) : messages.length ? (
            <ThreadMessages messages={messages} earlier={earlier} />
          ) : (
            <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">
              No messages{firstName ? ` with ${firstName}` : ""} yet.
            </p>
          )}
        </ThreadScroller>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-[var(--tag-red-text)]">
          {error}
        </p>
      ) : null}
      <div className="mt-3 shrink-0">
        <Composer
          key={loaded ? "thread" : "deal"}
          thread={thread}
          send={(input) => queueCustomerMessage({ recordId: deal.id, ...input })}
          onSent={() => void reload()}
        />
      </div>
    </div>
  );
}

function NoteItem({ note }: { note: DealOverview["notes"][number] }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const { error, pending, run } = useAction();
  const author = note.authorName ?? "Website request";
  return (
    <li className="rounded-[var(--radius)] border border-[var(--color-border)] px-3.5 py-3">
      {editing ? (
        <>
          <Textarea
            aria-label="Edit note"
            rows={4}
            maxLength={10000}
            autoFocus
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                setBody(note.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || !body.trim() || body === note.body}
              onClick={() => run(() => updateDealNote({ id: note.id, body }), () => setEditing(false))}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-[var(--color-text)]">{note.body}</p>
      )}
      <div className="mt-2.5 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
        <Initials name={author} />
        <span className="min-w-0 truncate font-medium text-[var(--color-text)]">{author}</span>
        <time dateTime={note.createdAt} title={fmtDateTime(note.createdAt)} className="text-[var(--color-faint)]">
          {fmtRelativeTime(note.createdAt)}
        </time>
        {!editing ? (
          <span className="ml-auto flex shrink-0 gap-0.5">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-6 px-1.5">
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Delete this note?")) run(() => deleteProjectNote(note.id));
              }}
              className="h-6 px-1.5 hover:bg-[var(--tag-red-bg)] hover:text-[var(--tag-red-text)]"
            >
              Delete
            </Button>
          </span>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-[var(--tag-red-text)]">{error}</p> : null}
    </li>
  );
}

export function NotesPanel({ deal, autoFocus }: { deal: DealOverview; autoFocus: boolean }) {
  const [body, setBody] = useState("");
  const { error, pending, run } = useAction();
  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!body.trim()) return;
          run(() => saveProjectNote({ id: crypto.randomUUID(), projectId: deal.id, body }), () => setBody(""));
        }}
      >
        <Textarea
          aria-label="New note"
          rows={3}
          maxLength={10000}
          autoFocus={autoFocus}
          placeholder="Add your note here"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {error ? <p role="alert" className="mt-2 text-xs text-[var(--tag-red-text)]">{error}</p> : null}
        {body ? (
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setBody("")}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>
              Save
            </Button>
          </div>
        ) : null}
      </form>
      {deal.notes.length ? (
        <ul className="mt-5 space-y-2">
          {deal.notes.map((note) => (
            <NoteItem key={note.id} note={note} />
          ))}
        </ul>
      ) : (
        <Empty>No notes yet.</Empty>
      )}
    </div>
  );
}

export function ProposalsPanel({
  deal,
  extras,
  stageName,
}: {
  deal: DealOverview;
  extras: DealExtras;
  stageName: string | null;
}) {
  const base = `/jobs/${encodeURIComponent(deal.id)}`;
  const job = extras.job;
  if (!job && !deal.proposals.length) {
    return (
      <Empty
        action={
          deal.leadId ? (
            <Link href={`${base}/proposals/new`} className={buttonClassName({ variant: "secondary" })}>
              New proposal
            </Link>
          ) : null
        }
      >
        No proposals or jobs yet.
      </Empty>
    );
  }
  return (
    <ul className={list}>
      {job ? (
        <li className={row}>
          <Tag tone="green">Job</Tag>
          <Link
            href={`/jobs/${encodeURIComponent(job.id)}`}
            className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)] hover:underline"
          >
            {job.name}
          </Link>
          <span className="hidden text-xs text-[var(--color-muted)] sm:inline">
            {(job.id === deal.id && stageName) || JOB_STATUS_LABELS[job.status] || job.status}
          </span>
          <Link href={`/jobs/${encodeURIComponent(job.id)}/work-order`} className={cn("text-xs", linkStyle)}>
            Work order
          </Link>
          <span className="w-24 text-right tabular-nums text-[var(--color-heading)]">{fmtCents(job.valueCents)}</span>
        </li>
      ) : null}
      {deal.proposals.map((proposal) => {
        const status = proposalStatus(proposal.status);
        return (
          <li key={proposal.id}>
            <Link href={`${base}/proposals/${proposal.id}`} className={row}>
              <DocumentIcon className="h-3.5 w-3.5 text-[var(--color-faint)]" />
              <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)]">{proposal.name}</span>
              {proposal.sentAt ? (
                <span className="hidden text-xs text-[var(--color-muted)] sm:inline">Sent {fmtDate(proposal.sentAt)}</span>
              ) : null}
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className="w-24 text-right tabular-nums text-[var(--color-heading)]">{fmtCents(proposal.amountCents)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function InvoicesPanel({ extras }: { extras: DealExtras }) {
  const job = extras.job;
  if (!extras.invoices.length) {
    return (
      <Empty
        action={
          job ? (
            <Link href={`/jobs/${encodeURIComponent(job.id)}/invoices/new`} className={buttonClassName({ variant: "secondary" })}>
              New invoice
            </Link>
          ) : null
        }
      >
        {job ? "No invoices yet." : "Invoices start once a proposal is accepted."}
      </Empty>
    );
  }
  return (
    <ul className={list}>
      {extras.invoices.map((invoice) => {
        const status = INVOICE_STATUS[invoice.status];
        return (
          <li key={invoice.id}>
            <Link href={`/jobs/${encodeURIComponent(invoice.jobId)}/invoices/${invoice.id}`} className={row}>
              <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)]">
                #{invoice.number} {invoice.name}
              </span>
              <span className="hidden text-xs text-[var(--color-muted)] sm:inline">
                {invoice.balanceCents > 0 && invoice.status !== "void" ? `${fmtCents(invoice.balanceCents)} due` : `Issued ${fmtDate(invoice.issuedOn)}`}
              </span>
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className="w-24 text-right tabular-nums text-[var(--color-heading)]">{fmtCents(invoice.amountCents)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppointmentsPanel({ deal }: { deal: DealOverview }) {
  if (!deal.appointments.length) {
    return (
      <Empty
        action={
          <Link href={`/appointments?new=${encodeURIComponent(deal.id)}`} className={buttonClassName({ variant: "secondary" })}>
            New appointment
          </Link>
        }
      >
        No appointments yet.
      </Empty>
    );
  }
  return (
    <ul className={list}>
      {deal.appointments.map((appointment) => {
        const status = appointmentStatus(appointment.status);
        return (
          <li key={appointment.id} className={row}>
            <span className="w-28 shrink-0 tabular-nums">
              <span className="text-[var(--color-heading)]">{fmtDay(appointment.startsAt)}</span>
              <span className="ml-1.5 text-xs text-[var(--color-muted)]">{fmtTime(appointment.startsAt)}</span>
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)]">{appointment.title}</span>
            <span className="hidden min-w-0 truncate text-xs text-[var(--color-muted)] sm:inline">
              {appointment.assigneeName ?? "Unassigned"}
            </span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

/** Opens a file through the signed-URL route; pages open in the editor. */
export const documentHref = (document: DealExtras["documents"][number]) =>
  `/api/jobs/${encodeURIComponent(document.projectId)}/documents/${encodeURIComponent(document.id)}`;

export function AttachmentsPanel({ deal, extras }: { deal: DealOverview; extras: DealExtras }) {
  const base = `/jobs/${encodeURIComponent(deal.id)}`;
  return (
    <div>
      {extras.documents.length ? (
        <ul className={list}>
          {extras.documents.map((document) => (
            <li key={document.id}>
              <a
                href={documentHref(document)}
                target={document.kind === "file" ? "_blank" : undefined}
                rel="noreferrer"
                className={row}
              >
                <DocumentIcon className="h-3.5 w-3.5 text-[var(--color-faint)]" />
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)]">{document.name}</span>
                <span className="shrink-0 text-xs text-[var(--color-muted)]">{fmtDate(document.createdAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No attachments yet.</Empty>
      )}
      <div className="mt-3 flex gap-4 text-[13px]">
        <Link href={`${base}/documents`} className={linkStyle}>
          Project documents
        </Link>
        <Link href={base} className={linkStyle}>
          Project photos
        </Link>
      </div>
    </div>
  );
}
