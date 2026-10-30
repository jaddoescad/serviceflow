"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { getEarlierMessages, markConversationRead, replyToConversation } from "@/lib/actions/inbox";
import { getCallAudio } from "@/lib/actions/quo";
import type { ActionResult } from "@/lib/actions/rpc";
import { documentAssetUrl, removeDocumentAssets, uploadDocumentAsset, webImage } from "@/lib/document-assets";
import { dayKey } from "@/lib/format";
import { fmtBytes, fmtClock, fmtDayLabel, fmtHandle, fmtMessageBody } from "@/lib/inbox-format";
import {
  MESSAGE_KIND_LABELS,
  OUTBOUND_STATUS,
  THREAD_PAGE,
  type OutboundAttachment,
  type Thread,
  type ThreadAttachment,
  type ThreadMessage,
} from "@/lib/inbox-types";
import type { MessageChannel } from "@/lib/messaging-types";
import { AddCustomerDialog } from "./add-customer-dialog";
import { BackIcon, ChatIcon, DocumentIcon, ImageIcon, MailIcon, PhoneIcon, linkStyle } from "../pipeline-ui";
import { Badge, Button, Segmented, Spinner, buttonClassName, cn } from "../ui";

/** A customer's two-way thread: what they sent on the left, everything sent
 * to them on the right, with the reply composer. Shared by the inbox and the
 * deal page's Communications tab. */

const isImage = (attachment: ThreadAttachment) =>
  attachment.contentType?.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(attachment.url ?? "");

function Attachments({ items }: { items: ThreadAttachment[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-col items-start gap-1.5">
      {items.map((attachment, index) =>
        attachment.url && isImage(attachment) ? (
          <a key={index} href={attachment.url} target="_blank" rel="noreferrer" className="block">
            <img
              src={attachment.url}
              alt={attachment.name ?? "Photo"}
              loading="lazy"
              className="max-h-64 max-w-full rounded-[var(--radius)] border border-[var(--color-border)] object-cover"
            />
          </a>
        ) : (
          <a
            key={index}
            href={attachment.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className={cn("flex max-w-full items-center gap-1.5 text-xs", attachment.url ? linkStyle : "text-[var(--color-muted)]")}
          >
            <DocumentIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{attachment.name ?? "Attachment"}</span>
            {attachment.size ? <span className="shrink-0 font-normal text-[var(--color-faint)]">{fmtBytes(attachment.size)}</span> : null}
          </a>
        ),
      )}
    </div>
  );
}

const fmtCallLength = (seconds: number) => (seconds < 60 ? `${seconds} sec` : `${Math.round(seconds / 60)} min`);

/** A Quo call: what happened, any voicemail transcript, and a player for its
 * recording or voicemail, which loads from Quo only when someone plays it. */
function CallItem({ message }: { message: ThreadMessage }) {
  const call = message.call;
  const outbound = message.direction === "outbound";
  const answered = Boolean(call?.answered);
  const voicemail = call?.voicemail;
  const callId = call?.id;
  const audioSrc = callId && (answered || voicemail) ? `/api/calls/${encodeURIComponent(callId)}/audio` : null;
  const [fetchedTranscript, setFetchedTranscript] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  // Fetching a fresh link from Quo takes a moment after play is pressed.
  const [loading, setLoading] = useState(false);
  const needsTranscript = Boolean(callId && voicemail && !voicemail.transcript);
  const title = voicemail
    ? "Voicemail"
    : answered
      ? outbound
        ? "Outgoing call"
        : "Incoming call"
      : outbound
        ? "Call not answered"
        : "Missed call";
  const length = voicemail ? voicemail.duration : answered ? call?.duration : null;
  const transcript = voicemail?.transcript ?? fetchedTranscript;

  // Live voicemails arrive before Quo transcribes them; asking also saves the transcript.
  useEffect(() => {
    if (!callId || !needsTranscript) return;
    let cancelled = false;
    getCallAudio(callId).then((result) => {
      if (!cancelled && result.ok && result.transcript) setFetchedTranscript(result.transcript);
    });
    return () => {
      cancelled = true;
    };
  }, [callId, needsTranscript]);

  // The player can't say why it failed, so ask the audio route itself.
  async function explainFailure() {
    if (!audioSrc) return;
    const response = await fetch(audioSrc, { redirect: "manual" }).catch(() => null);
    if (response?.status === 404) setMissing(true);
    else if (!response || response.type === "opaqueredirect") setError("Couldn't play this recording.");
    else setError((await response.text()) || "Could not reach Quo.");
    setLoading(false);
  }

  return (
    <li className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
      <div className="w-[min(85%,360px)] rounded-2xl border border-[var(--color-border)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-heading)]">
        <p className="flex items-center gap-2">
          <PhoneIcon
            className={cn(
              "h-3.5 w-3.5",
              !answered && !outbound ? "text-[var(--tag-red-text)]" : "text-[var(--color-muted)]",
            )}
          />
          <span className="font-medium">{title}</span>
          {length ? <span className="tabular-nums text-[var(--color-muted)]">{fmtCallLength(length)}</span> : null}
          {loading ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-[var(--color-muted)]">
              <Spinner className="h-3 w-3" />
              Loading…
            </span>
          ) : null}
        </p>
        {transcript ? <p className="mt-1 whitespace-pre-line break-words text-[var(--color-text)]">{transcript}</p> : null}
        {missing ? (
          <p className="mt-1 text-xs text-[var(--color-muted)]">{voicemail ? "Quo has no audio for this voicemail." : "No recording."}</p>
        ) : error ? (
          <p className="mt-1 text-xs text-[var(--tag-red-text)]">{error}</p>
        ) : audioSrc ? (
          <audio
            controls
            preload="none"
            src={audioSrc}
            onPlay={() => setLoading(true)}
            onWaiting={() => setLoading(true)}
            onPlaying={() => setLoading(false)}
            // A failed load also pauses; keep loading until the failure is explained.
            onPause={(event) => {
              if (!event.currentTarget.error) setLoading(false);
            }}
            onError={explainFailure}
            className="mt-2 h-8 w-full"
          />
        ) : null}
      </div>
      <div className="mt-1 px-1 text-xs text-[var(--color-faint)]">{fmtClock(message.at)}</div>
    </li>
  );
}

function MessageItem({ message }: { message: ThreadMessage }) {
  if (message.channel === "call") return <CallItem message={message} />;
  const outbound = message.direction === "outbound";
  const status = outbound && message.kind !== "quo" && message.status !== "sent" ? OUTBOUND_STATUS[message.status] : null;
  const label = !outbound
    ? null
    : message.kind === "manual"
      ? message.authorName
      : message.kind
        ? MESSAGE_KIND_LABELS[message.kind]
        : null;
  const meta = [fmtClock(message.at), label, message.deliveredAt ? "Delivered" : null].filter(Boolean).join(" · ");
  return (
    <li className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[min(85%,560px)] rounded-2xl px-3 py-2 text-[13px] leading-relaxed text-[var(--color-heading)]",
          outbound ? "rounded-br-md bg-[var(--color-brand-soft)]" : "rounded-bl-md bg-[var(--color-surface-2)]",
        )}
      >
        {message.channel === "email" && message.subject ? <p className="mb-1 font-semibold">{message.subject}</p> : null}
        {message.body ? <p className="whitespace-pre-line break-words">{fmtMessageBody(message.body)}</p> : null}
        <Attachments items={message.attachments} />
      </div>
      <div className="mt-1 flex items-center gap-1.5 px-1 text-xs text-[var(--color-faint)]">
        {message.channel === "email" ? <MailIcon className="h-3 w-3" /> : <ChatIcon className="h-3 w-3" />}
        <span className="sr-only">{message.channel === "email" ? "Email" : "Text"}</span>
        <span>{meta}</span>
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      </div>
      {message.error && (message.status === "failed" || message.status === "skipped") ? (
        <p
          className={cn(
            "mt-0.5 max-w-[min(85%,560px)] px-1 text-right text-xs",
            message.status === "failed" ? "text-[var(--tag-red-text)]" : "text-[var(--color-muted)]",
          )}
        >
          {message.error}
        </p>
      ) : null}
    </li>
  );
}

export type EarlierMessages = { more: boolean; loading: boolean; error: string; load: () => void };

/** A thread's messages with the earlier pages someone loaded in front;
 * `earlier` drives the "Load earlier messages" button. */
export function useEarlierMessages(thread: Thread): { messages: ThreadMessage[]; earlier: EarlierMessages } {
  const key = thread.id ?? thread.contact?.id ?? "";
  const [state, setState] = useState<{ key: string; older: ThreadMessage[]; exhausted: boolean }>({
    key,
    older: [],
    exhausted: false,
  });
  const [error, setError] = useState("");
  const [loading, startTransition] = useTransition();
  const older = state.key === key ? state.older : [];
  const shown = new Set(thread.messages.map((message) => message.id));
  const messages = [...older.filter((message) => !shown.has(message.id)), ...thread.messages];
  const more = !(state.key === key && state.exhausted) && (older.length > 0 || thread.messages.length >= THREAD_PAGE);

  function load() {
    const before = messages[0]?.at;
    if (!before) return;
    setError("");
    startTransition(async () => {
      try {
        const page = await getEarlierMessages({ conversationId: thread.id, contactId: thread.contact?.id ?? null, before });
        setState({ key, older: [...page, ...older], exhausted: page.length < THREAD_PAGE });
      } catch {
        setError("Could not load earlier messages.");
      }
    });
  }
  return { messages, earlier: { more, loading, error, load } };
}

/** Messages grouped under day labels, oldest first. */
export function ThreadMessages({ messages, earlier }: { messages: ThreadMessage[]; earlier?: EarlierMessages }) {
  const days: { key: string; items: ThreadMessage[] }[] = [];
  for (const message of messages) {
    const key = dayKey(message.at);
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(message);
    else days.push({ key, items: [message] });
  }
  return (
    <div className="space-y-6">
      {earlier?.more ? (
        <div className="flex flex-col items-center gap-1">
          <Button variant="ghost" size="sm" disabled={earlier.loading} onClick={earlier.load}>
            {earlier.loading ? "Loading…" : "Load earlier messages"}
          </Button>
          {earlier.error ? <p className="text-xs text-[var(--tag-red-text)]">{earlier.error}</p> : null}
        </div>
      ) : null}
      {days.map((day) => (
        <section key={day.key} aria-label={fmtDayLabel(day.items[0].at)}>
          <p className="mb-3 text-center text-xs font-medium text-[var(--color-faint)]">{fmtDayLabel(day.items[0].at)}</p>
          <ol className="space-y-3">
            {day.items.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Scrolls to the newest message when one arrives, and again as photos load
 * unless someone has scrolled up. On phones the inbox thread is part of the
 * page, so `followPage` scrolls the page instead. */
export function ThreadScroller({
  scrollKey,
  followPage = false,
  className,
  children,
}: {
  scrollKey: string | undefined;
  followPage?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    atBottom.current = true;
    if (element.scrollHeight > element.clientHeight + 1) element.scrollTop = element.scrollHeight;
    else if (followPage && window.matchMedia("(max-width: 767px)").matches) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [scrollKey, followPage]);
  return (
    // relative: keeps the messages' absolutely positioned sr-only labels inside
    // the scroller instead of stretching the page.
    <div
      ref={ref}
      onScroll={(event) => {
        const element = event.currentTarget;
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}
      onLoadCapture={() => {
        const element = ref.current;
        if (element && atBottom.current) element.scrollTop = element.scrollHeight;
      }}
      className={cn("relative min-h-0 overflow-y-auto", className)}
    >
      {children}
    </div>
  );
}

export type ComposerInput = { channel: MessageChannel; subject: string; body: string; attachments: OutboundAttachment[] };

const MAX_PHOTOS = 5;

type Photo = { path: string; attachment: OutboundAttachment };

const NO_ADDRESS: Record<MessageChannel, string> = { email: "No email address on file.", sms: "No phone number on file." };

/** Reply by text or email, with up to five photos. Sending queues the message
 * and wakes the delivery run, so it goes out within seconds; its bubble shows
 * how it went. Quo's API can't send picture messages, so a text carries a link
 * to each photo. */
export function Composer({
  thread,
  send,
  onSent,
}: {
  thread: Thread;
  send: (input: ComposerInput) => Promise<ActionResult>;
  onSent?: () => void;
}) {
  const handleIsEmail = Boolean(thread.handle?.includes("@"));
  const to: Record<MessageChannel, string | null> = {
    email: thread.contact ? thread.contact.email : handleIsEmail ? thread.handle : null,
    sms: thread.contact ? thread.contact.phone : thread.handle && !handleIsEmail ? thread.handle : null,
  };
  const latest = [...thread.messages].reverse();
  const lastInbound = latest.find((message) => message.direction === "inbound" && message.channel !== "call");
  const lastSubject = latest.find((message) => message.channel === "email" && message.subject)?.subject;
  const [channel, setChannel] = useState<MessageChannel>(
    lastInbound?.channel === "email" || lastInbound?.channel === "sms"
      ? lastInbound.channel
      : to.sms && thread.quoConnected
        ? "sms"
        : to.email
          ? "email"
          : "sms",
  );
  const [subject, setSubject] = useState(lastSubject ? `Re: ${lastSubject.replace(/^((re|fwd?)\s*:\s*)+/i, "")}` : "");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function addPhotos(files: File[]) {
    const room = MAX_PHOTOS - photos.length;
    if (!files.length || room <= 0) return;
    setError("");
    setUploading(true);
    try {
      for (const file of files.slice(0, room)) {
        const image = await webImage(file);
        if (!image) throw new Error(`${file.name} can't be sent from this browser. Try a JPG or PNG.`);
        const name =
          image === file ? file.name : `${file.name.replace(/\.[^.]*$/, "") || "photo"}.${image.type === "image/png" ? "png" : "jpg"}`;
        const path = await uploadDocumentAsset(thread.orgId, image, name);
        const photo = { path, attachment: { url: documentAssetUrl(path), name, contentType: image.type || null } };
        setPhotos((current) => [...current, photo]);
      }
      if (files.length > room) setError(`Attach up to ${MAX_PHOTOS} photos.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not attach the photo.");
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(photo: Photo) {
    setPhotos((current) => current.filter((item) => item.path !== photo.path));
    void removeDocumentAssets([photo.path]).catch(() => undefined);
  }

  const optedOut = thread.optOuts.some((optOut) => optOut.channel === channel && optOut.category === "all");
  const blocked: ReactNode = !to[channel] ? (
    NO_ADDRESS[channel]
  ) : optedOut ? (
    channel === "email" ? "Opted out of all email." : "Opted out of all texts."
  ) : channel === "sms" && !thread.quoConnected ? (
    <>
      <Link href="/settings#quo" className={linkStyle}>
        Connect Quo
      </Link>{" "}
      to send texts.
    </>
  ) : null;
  const ready =
    !blocked &&
    !pending &&
    !uploading &&
    (body.trim() !== "" || photos.length > 0) &&
    (channel === "sms" || subject.trim() !== "");

  function submit() {
    if (!ready) return;
    setError("");
    startTransition(async () => {
      const outcome = await send({
        channel,
        subject: channel === "email" ? subject : "",
        body,
        attachments: photos.map((photo) => photo.attachment),
      }).catch(() => ({ ok: false, error: undefined }));
      if (!outcome.ok) {
        setError(outcome.error ?? "Could not send. Try again.");
        return;
      }
      setBody("");
      setPhotos([]);
      onSent?.();
    });
  }

  return (
    <form
      className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] focus-within:border-[var(--color-brand)] focus-within:shadow-[var(--focus-ring)]"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-2 py-1.5">
        <Segmented
          label="Send as"
          value={channel}
          options={[
            { value: "sms", label: "Text" },
            { value: "email", label: "Email" },
          ]}
          onChange={(value) => {
            setChannel(value);
            setError("");
          }}
        />
        {to[channel] ? (
          <span className="min-w-0 truncate text-xs text-[var(--color-muted)]">
            To {channel === "sms" ? fmtHandle(to[channel]) : to[channel]}
          </span>
        ) : null}
      </div>
      {channel === "email" ? (
        <input
          aria-label="Subject"
          placeholder="Subject"
          maxLength={200}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="block h-9 w-full border-b border-[var(--color-border)] px-3 text-[13px] font-medium text-[var(--color-heading)] outline-none placeholder:font-normal placeholder:text-[var(--color-faint)]"
        />
      ) : null}
      <textarea
        aria-label="Message"
        rows={3}
        maxLength={5000}
        placeholder={channel === "email" ? "Write an email…" : "Write a text…"}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        className="block w-full resize-y px-3 py-2.5 text-[13px] leading-relaxed text-[var(--color-heading)] outline-none placeholder:text-[var(--color-faint)]"
      />
      {photos.length ? (
        <ul aria-label="Photos" className="flex flex-wrap gap-2 px-3 pb-2">
          {photos.map((photo) => (
            <li key={photo.path} className="relative">
              <img
                src={photo.attachment.url}
                alt={photo.attachment.name ?? "Photo"}
                className="h-14 w-14 rounded-[var(--radius-control)] border border-[var(--color-border)] object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${photo.attachment.name ?? "photo"}`}
                onClick={() => removePhoto(photo)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-heading)] text-xs leading-none text-[var(--color-bg)] outline-none focus-visible:shadow-[var(--focus-ring)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void addPhotos(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Attach photos"
          title="Attach photos"
          disabled={uploading || photos.length >= MAX_PHOTOS || !thread.orgId}
          onClick={() => fileInput.current?.click()}
          className="-ml-2 w-7 px-0"
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
        <span
          role={error ? "alert" : undefined}
          className={cn("min-w-0 flex-1 text-xs", error ? "text-[var(--tag-red-text)]" : "text-[var(--color-muted)]")}
        >
          {error ||
            blocked ||
            (uploading ? "Uploading…" : photos.length && channel === "sms" ? "Texts include a link to each photo." : "")}
        </span>
        <Button type="submit" size="sm" disabled={!ready}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

/** True while a message sent from here hasn't gone out yet. */
export const isSending = (thread: Thread) =>
  thread.messages.some(
    (message) => message.direction === "outbound" && (message.status === "queued" || message.status === "sending"),
  );

/** The inbox's right pane. Opening an unread conversation marks it read,
 * unless someone just marked it unread. */
export function InboxThread({ thread, backHref }: { thread: Thread & { id: string }; backHref: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const { messages, earlier } = useEarlierMessages(thread);
  const keptUnread = useRef(false);
  const markedFor = useRef<string | null>(null);
  const latestInbound = [...thread.messages].reverse().find((message) => message.direction === "inbound")?.id ?? "";

  useEffect(() => {
    if (!thread.isUnread || keptUnread.current || markedFor.current === latestInbound) return;
    markedFor.current = latestInbound;
    void markConversationRead(thread.id, true);
  }, [thread.id, thread.isUnread, latestInbound]);

  // Follow a message out: Queued, Sending, then sent.
  const sending = isSending(thread);
  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [sending, router]);

  const contact = thread.contact;
  const name = contact?.name?.trim() || thread.name || fmtHandle(thread.handle ?? contact?.phone ?? contact?.email);
  const details = contact
    ? [contact.phone ? fmtHandle(contact.phone) : null, contact.email].filter(Boolean).join(" · ")
    : [thread.name ? fmtHandle(thread.handle) : null, "Not a customer yet"].filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 lg:px-6">
        <Link
          href={backHref}
          aria-label="Back to conversations"
          className={buttonClassName({ variant: "ghost", size: "sm", className: "-ml-2 w-7 px-0 md:hidden" })}
        >
          <BackIcon className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-[var(--color-heading)]">{name}</h2>
          {details ? <p className="truncate text-xs text-[var(--color-muted)]">{details}</p> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            const read = thread.isUnread;
            keptUnread.current = !read;
            startTransition(async () => {
              await markConversationRead(thread.id, read);
            });
          }}
        >
          {thread.isUnread ? "Mark read" : "Mark unread"}
        </Button>
        {thread.record ? (
          <Link
            href={`/deals/${encodeURIComponent(thread.record.id)}`}
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            {thread.record.kind === "job" ? "Open job" : "Open deal"}
          </Link>
        ) : !contact ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Add as customer
          </Button>
        ) : null}
      </header>
      <ThreadScroller scrollKey={thread.messages[thread.messages.length - 1]?.id} followPage className="flex-1 px-4 py-5 lg:px-6">
        {messages.length ? (
          <ThreadMessages messages={messages} earlier={earlier} />
        ) : (
          <p className="py-12 text-center text-[13px] text-[var(--color-muted)]">No messages yet.</p>
        )}
      </ThreadScroller>
      <div className="sticky bottom-0 shrink-0 bg-[var(--color-surface)] px-4 pb-4 pt-2 lg:px-6">
        <Composer
          key={thread.id}
          thread={thread}
          send={(input) => replyToConversation({ conversationId: thread.id, ...input })}
        />
      </div>
      {adding ? (
        <AddCustomerDialog
          conversationId={thread.id}
          handle={thread.handle}
          suggestedName={thread.name}
          onClose={() => setAdding(false)}
          onAdded={(conversationId) => {
            setAdding(false);
            router.push(`/inbox?c=${conversationId}`);
          }}
        />
      ) : null}
    </div>
  );
}
