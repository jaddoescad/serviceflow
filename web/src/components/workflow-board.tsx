"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import {
  approveBooking,
  approveText,
  chatWorkflowAI,
  getWorkflowDay,
  getWorkflowCard,
  moveWorkflowCard,
  suggestNext,
} from "@/lib/actions/workflows";
import type { DrawnDay } from "@/lib/booking-types";
import { dayKey, fmtDate, fmtDateTime, fmtRelativeTime, fmtTime } from "@/lib/format";
import {
  WORKFLOW_KINDS,
  WORKFLOW_STAGES,
  workflowTimeLabel,
  type WorkflowCardDetail,
  type WorkflowCardSummary,
  type WorkflowEvent,
  type WorkflowLeadFields,
  type WorkflowMessage,
  type WorkflowSuggestion,
  type WorkflowTime,
} from "@/lib/workflow-types";
import { Dot } from "./pipeline-ui";
import { DayDrawing } from "./suggest-times";
import { Button, Field, Input, Spinner, TAG_DOT, Tag, buttonClassName, cn } from "./ui";

const MAX_AUTO = 5;

function cameIn(card: Pick<WorkflowCardSummary, "kind" | "source">) {
  return card.kind === "lead" ? card.source?.trim() || "Lead" : WORKFLOW_KINDS[card.kind];
}

/**
 * The board: a card per thing that could become a booked estimate. Cards in
 * New get the AI's suggestion as soon as the board is open; nothing is sent or
 * booked until someone approves it in the card.
 */
export function WorkflowBoard({ cards, calendarsConnected }: { cards: WorkflowCardSummary[]; calendarsConnected: number }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const tried = useRef(new Set<string>());
  const running = useRef(false);

  // One at a time, so a burst of calls doesn't fan out.
  useEffect(() => {
    if (running.current) return;
    const next = cards.find(
      (card) => (card.stage === "new" || card.stage === "communication") && !card.suggestion && !tried.current.has(card.id),
    );
    if (!next || tried.current.size >= MAX_AUTO) return;
    running.current = true;
    tried.current.add(next.id);
    setThinking(next.id);
    suggestNext(next.id)
      .then((result) => {
        if (!result.ok) setFailed((current) => ({ ...current, [next.id]: result.error ?? "Couldn't suggest" }));
      })
      .finally(() => {
        running.current = false;
        setThinking(null);
        router.refresh();
      });
  }, [cards, router]);

  const open = cards.find((card) => card.id === openId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {calendarsConnected === 0 ? (
        <p className="border-b border-[var(--tag-yellow-border,var(--color-border))] bg-[var(--tag-yellow-bg)] px-[var(--gutter)] py-2 text-[13px] text-[var(--tag-yellow-text)]">
          No salesperson has a connected calendar, so the AI can&apos;t offer times.{" "}
          <Link href="/workflows?tab=settings" className="font-medium underline underline-offset-2">
            Set up salespeople
          </Link>
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-x-auto px-[var(--gutter)] pb-3 pt-3">
        <div className="flex h-full gap-3">
          {WORKFLOW_STAGES.map((stage) => {
            const inStage = cards.filter((card) => card.stage === stage.id);
            return (
              <section key={stage.id} aria-label={stage.name} className="flex h-full w-[264px] shrink-0 flex-col">
                <header className="flex h-8 items-center gap-2 px-1.5">
                  <Dot color={TAG_DOT[stage.tone]} />
                  <h2 className="min-w-0 truncate text-[13px] font-semibold text-[var(--color-heading)]">{stage.name}</h2>
                  <span className="text-xs tabular-nums text-[var(--color-faint)]">{inStage.length}</span>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[var(--radius)] bg-[var(--color-surface-2)] p-2 pb-4">
                  {inStage.map((card) => (
                    <BoardCard
                      key={card.id}
                      card={card}
                      thinking={thinking === card.id}
                      failed={failed[card.id]}
                      onOpen={() => setOpenId(card.id)}
                    />
                  ))}
                  {!inStage.length ? (
                    <p className="py-8 text-center text-[13px] text-[var(--color-faint)]">Nothing here</p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {open ? (
        <CardDialog
          key={open.id}
          summary={open}
          onClose={() => setOpenId(null)}
          onDone={() => {
            setOpenId(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function BoardCard({
  card,
  thinking,
  failed,
  onOpen,
}: {
  card: WorkflowCardSummary;
  thinking: boolean;
  failed?: string;
  onOpen: () => void;
}) {
  const line =
    card.stage === "booked" && card.appointment
      ? `${fmtDateTime(card.appointment.startsAt)}${card.appointment.with ? ` with ${card.appointment.with}` : ""}`
      : (card.stage === "needs_you" || card.stage === "closed") && card.reason
        ? card.reason
        : (card.suggestion?.summary ?? card.latest);
  return (
    <article className="relative shrink-0 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-[border-color,box-shadow] hover:border-[var(--color-border-strong)] hover:shadow-[0_2px_6px_rgb(16_24_40/0.07)]">
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold leading-5 text-[var(--color-heading)] outline-none before:absolute before:inset-0 before:rounded-[inherit] focus-visible:before:shadow-[var(--focus-ring)]"
        >
          {card.name}
        </button>
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-faint)]">{fmtRelativeTime(card.activityAt)}</span>
      </div>
      <p className="truncate text-[11px] leading-[14px] text-[var(--color-faint)]">
        {cameIn(card)}
        {card.address ? ` · ${card.address.split(",")[0]}` : ""}
      </p>
      {line ? <p className="mt-1.5 line-clamp-2 text-xs leading-[17px] text-[var(--color-text)]">{line}</p> : null}
      {card.stage === "new" || card.stage === "communication" ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {thinking ? (
            <span className="flex items-center gap-1.5 text-[var(--color-muted)]">
              <Spinner className="h-3 w-3" /> Thinking…
            </span>
          ) : card.suggestion ? (
            card.suggestion.action === "close" ? (
              <Tag tone="gray">Nothing to book</Tag>
            ) : (
              <Tag tone="blue">{card.suggestion.action === "book" ? "Ready to book" : "Suggestion ready"}</Tag>
            )
          ) : failed ? (
            <span className="truncate text-[var(--tag-red-text)]" title={failed}>
              Couldn&apos;t suggest
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

const emptyLead: WorkflowLeadFields = { name: null, address: null, email: null, request: null };
const SLOT = /\{\{(t\d+)\}\}/g;

type Step = WorkflowSuggestion["action"];
type Result = { ok: boolean; error?: string };

const SPARK = "M12 2l2.2 6.8L21 11l-6.800 2.200L12 20l-2.200-6.800L3 11l6.800-2.200z";

function Spark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={cn("h-3.5 w-3.5 shrink-0", className)}>
      <path d={SPARK} />
    </svg>
  );
}

/** A quiet text button for the alternatives. */
function Quiet({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-[13px] font-medium text-[var(--color-muted)] outline-none hover:text-[var(--color-heading)] focus-visible:underline disabled:opacity-50"
    >
      {children}
    </button>
  );
}

type FeedItem =
  | { at: string; type: "message"; message: WorkflowMessage }
  | { at: string; type: "note"; text: string; from: "them" | "ai" };

const EVENT_TEXT: Record<WorkflowEvent["kind"], (event: WorkflowEvent) => string> = {
  suggested: (event) => `AI suggested: ${event.summary ?? "a next step"}`,
  needs_you: (event) => `AI stopped: ${event.summary ?? "needs you"}`,
  sent: (event) => `${event.by ?? "Someone"} approved and sent a text`,
  booked: (event) => `${event.by ?? "Someone"} booked ${event.summary ?? "an estimate"}`,
  taken: (event) => `${event.by ?? "Someone"} took it over${event.summary ? `: ${event.summary}` : ""}`,
  closed: (event) => `${event.by ?? "Someone"} closed it${event.summary ? `: ${event.summary}` : ""}`,
  reopened: (event) => `${event.by ?? "Someone"} ${event.summary ? `moved it: ${event.summary}` : "reopened it"}`,
};

/**
 * Everything with this contact, oldest first: their request, texts, calls,
 * voicemails and emails, and what the AI suggested and people did on the card.
 */
function Activity({ card }: { card: WorkflowCardDetail }) {
  const end = useRef<HTMLDivElement>(null);
  // Braces: scrollIntoView returns a promise in newer Chrome, and an effect may only return a clean-up.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [card]);

  // Empty until the workflow_activity migration is applied.
  const events = (card.events ?? []).filter(
    (event, index, all) =>
      event.kind !== "sent" && !(index > 0 && all[index - 1].kind === event.kind && all[index - 1].summary === event.summary),
  );
  const items: FeedItem[] = [
    ...card.notes.map((text): FeedItem => ({ at: card.createdAt ?? card.messages[0]?.at ?? new Date().toISOString(), type: "note", text, from: "them" })),
    ...card.messages.map((message): FeedItem => ({ at: message.at, type: "message", message })),
    ...events.map((event): FeedItem => ({ at: event.at, type: "note", text: EVENT_TEXT[event.kind](event), from: "ai" })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (!items.length) return <p className="text-[13px] text-[var(--color-faint)]">Nothing yet.</p>;
  let lastDay = "";
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, index) => {
        const day = dayKey(item.at);
        const newDay = day !== lastDay;
        lastDay = day;
        return (
          <Fragment key={index}>
            {newDay ? (
              <div className="self-center pt-1 text-[11.5px] font-medium text-[var(--color-faint)]">{fmtDate(day)}</div>
            ) : null}
            <FeedRow item={item} />
          </Fragment>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/** Plays a call's recording or voicemail; the link is fetched from Quo when play is pressed. */
function CallAudio({ callId }: { callId: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <p className="my-1 text-xs text-[var(--color-muted)]">No recording.</p>;
  return (
    <audio
      controls
      preload="none"
      src={`/api/calls/${encodeURIComponent(callId)}/audio`}
      onError={() => setMissing(true)}
      className="my-1.5 h-9 w-full min-w-56"
    />
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const pill = "max-w-[90%] self-center rounded-xl bg-[var(--color-surface-2)] px-2.5 py-1 text-center text-xs text-[var(--color-muted)]";
  if (item.type === "note") {
    const ai = item.from === "ai";
    return (
      <div className={cn(pill, ai && "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]")}>
        {ai ? null : <span className="font-medium">Their request · </span>}
        {item.text} <span className="opacity-70">· {fmtTime(item.at)}</span>
      </div>
    );
  }
  const { message } = item;
  const theirs = message.direction === "inbound";
  const voicemail = message.channel === "call" && message.text?.startsWith("Voicemail:");
  if (message.channel === "call" && !voicemail) {
    const notes = message.call;
    // An answered call has a recording to play, even before Quo has written anything about it.
    if (!(notes?.answered && message.callId) && !notes?.summary?.length && !notes?.transcript) {
      return (
        <div className={pill}>
          {message.text || "Call"} · {fmtTime(message.at)}
          {notes?.answered && notes.notes && notes.notes !== "completed" ? " · no transcript from Quo" : ""}
        </div>
      );
    }
    return (
      <div className="w-full max-w-[90%] self-center rounded-xl border border-[var(--color-border)] px-3 py-2 text-[13px] leading-5">
        <div className="text-xs font-semibold text-[var(--color-muted)]">
          {message.text || "Call"} · {fmtTime(message.at)}
          {notes.notes && notes.notes !== "completed" ? <span className="font-normal"> · no transcript from Quo</span> : null}
        </div>
        {message.callId ? <CallAudio callId={message.callId} /> : null}
        {notes.summary?.length ? (
          <ul className="mt-1 list-disc pl-4 text-[var(--color-heading)]">
            {notes.summary.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        ) : null}
        {notes?.transcript ? (
          <details className="mt-1" open={!notes.summary?.length}>
            <summary className="cursor-pointer text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-heading)]">Transcript</summary>
            <p className="mt-1 max-h-60 overflow-y-auto whitespace-pre-line text-[var(--color-text)]">{notes.transcript}</p>
          </details>
        ) : null}
      </div>
    );
  }
  const label = voicemail ? "Voicemail" : message.channel === "email" ? `Email${message.subject ? ` · ${message.subject}` : ""}` : null;
  const body = voicemail ? message.text!.replace(/^Voicemail:\s*/, "") : message.text;
  return (
    <div className={cn("flex max-w-[80%] flex-col", theirs ? "items-start self-start" : "items-end self-end")}>
      <div
        className={cn(
          "whitespace-pre-line break-words px-3 py-2 text-[13.5px] leading-5",
          theirs
            ? "rounded-[16px_16px_16px_4px] bg-[var(--color-surface-2)] text-[var(--color-heading)]"
            : "rounded-[16px_16px_4px_16px] bg-[var(--color-brand)] text-[var(--color-brand-ink)]",
          message.channel === "email" && "line-clamp-[8]",
        )}
      >
        {label ? <span className={cn("mb-0.5 block text-[11.5px] font-semibold", theirs ? "text-[var(--color-muted)]" : "opacity-80")}>{label}</span> : null}
        {voicemail && message.callId ? <CallAudio callId={message.callId} /> : null}
        {body || "—"}
      </div>
      <span className="mt-0.5 px-1 text-[11px] text-[var(--color-faint)]">
        {fmtTime(message.at)}
        {!theirs && message.by ? ` · ${message.by}` : ""}
        {!theirs && message.ai ? " · drafted by AI" : ""}
      </span>
    </div>
  );
}

/** One time's day, drawn like the appointment dialog, and other times to use instead. */
function TimePanel({
  cardId,
  address,
  time,
  suggestion,
  minutes,
  timezone,
  onUse,
  onBack,
}: {
  cardId: string;
  /** The address typed on the card, when the customer has none saved yet. */
  address: string | null;
  time: WorkflowTime;
  suggestion: WorkflowSuggestion;
  minutes: number;
  timezone: string;
  onUse: (time: WorkflowTime) => void;
  onBack: () => void;
}) {
  const date = new Date(time.startsAt).toLocaleDateString("en-CA", { timeZone: timezone });
  // Any day the customer asks for, up to four weeks out, loaded when picked.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const last = new Date(Date.now() + 28 * 86_400_000).toLocaleDateString("en-CA", { timeZone: timezone });
  const [other, setOther] = useState<{ date: string; days: DrawnDay[]; error?: string } | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  function pickDay(day: string) {
    if (!day || day === date) return setOther(null);
    setLoadingDay(true);
    getWorkflowDay(cardId, day, address).then((result) => {
      setLoadingDay(false);
      setOther({ date: day, days: result.days ?? [], error: result.ok ? undefined : (result.error ?? "That day couldn't load.") });
    });
  }
  /** Looking at a day other than the picked time's. */
  const browsing = other !== null && other.date !== date;
  // Choosing a time elsewhere (the list below, the text) ends the browsing.
  useEffect(() => {
    setOther((current) => (current && current.date !== date ? null : current));
  }, [time.startsAt, date]);
  const found = [...(suggestion.days ?? []), ...(other?.days ?? [])].find((day) => day.userId === time.personId && day.date === date);
  // The offered start may sit between the drawn blocks; draw it too.
  const day =
    found && !found.blocks.some((block) => block.start === time.startsAt)
      ? {
          ...found,
          blocks: [
            ...found.blocks,
            { start: time.startsAt, end: new Date(Date.parse(time.startsAt) + minutes * 60_000).toISOString(), before: null, after: null },
          ].sort((a, b) => a.start.localeCompare(b.start)),
        }
      : found;
  const isSelected = (option: WorkflowTime) => option.startsAt === time.startsAt && option.personId === time.personId;
  const [shown, setShown] = useState(5);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline gap-2">
          <h3 className="text-[15px] font-semibold text-[var(--color-heading)]">{time.label}</h3>
          <span className="text-[13px] text-[var(--color-muted)]">with {time.person}</span>
          <span className="ml-auto">
            <Quiet onClick={onBack}>Done</Quiet>
          </span>
        </div>
        <label className="mt-2 flex items-center justify-between gap-3 text-xs font-semibold text-[var(--color-muted)]">
          Day
          <Input
            type="date"
            min={today}
            max={last}
            value={other?.date ?? date}
            onChange={(event) => pickDay(event.target.value)}
            className="w-40"
          />
        </label>
        {loadingDay ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
            <Spinner className="h-3.5 w-3.5" /> Loading that day…
          </p>
        ) : browsing && other.error ? (
          <p className="mt-3 text-[13px] text-[var(--color-bad)]">{other.error}</p>
        ) : browsing && !other.days.length ? (
          <p className="mt-3 text-[13px] text-[var(--color-muted)]">Nobody has an opening on {fmtDate(other.date)}.</p>
        ) : browsing ? (
          // Another day, nothing picked on it yet: one drawing per person with room.
          other.days.map((choice) => (
            <div key={choice.userId} className="mt-2">
              {other.days.length > 1 ? <p className="text-[13px] font-medium text-[var(--color-heading)]">{choice.name}</p> : null}
              <div className="-mx-3">
                <DayDrawing
                  day={choice}
                  timezone={timezone}
                  isPicked={() => false}
                  onPick={(block) =>
                    onUse({
                      ...time,
                      personId: choice.userId,
                      person: choice.name ?? time.person,
                      startsAt: block.start,
                      label: workflowTimeLabel(block.start, timezone),
                      near: null,
                    })
                  }
                />
              </div>
            </div>
          ))
        ) : day ? (
          <div className="-mx-3 mt-2">
            <DayDrawing
              day={day}
              timezone={timezone}
              isPicked={(block) => block.start === time.startsAt}
              onPick={(block) =>
                onUse({ ...time, startsAt: block.start, label: workflowTimeLabel(block.start, timezone), near: null })
              }
            />
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-[var(--color-muted)]">{time.near ?? "Nothing else on their day."}</p>
        )}
      </div>
      {suggestion.options.length ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-muted)]">Open times, closest first</h4>
          <ul className="flex flex-col gap-1.5">
            {suggestion.options.slice(0, shown).map((option) => {
              const selected = isSelected(option);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onUse(option)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[9px] border px-2.5 py-2 text-left outline-none focus-visible:shadow-[var(--focus-ring)]",
                      selected
                        ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-[var(--color-heading)]">
                        {option.label} <span className="font-normal text-[var(--color-muted)]">· {option.person}</span>
                      </span>
                      {option.near ? <span className="block text-xs text-[var(--color-good)]">{option.near}</span> : null}
                    </span>
                    <span className={cn("text-xs font-medium", selected ? "text-[var(--color-brand-strong)]" : "text-[var(--color-muted)]")}>
                      {selected ? "Selected" : "Use"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {suggestion.options.length > shown ? (
            <button
              type="button"
              onClick={() => setShown((count) => count + 5)}
              className="mt-2 w-full rounded-[9px] border border-dashed border-[var(--color-border-strong)] py-1.5 text-[12.5px] font-medium text-[var(--color-muted)] outline-none hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]"
            >
              Show more ({suggestion.options.length - shown})
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 py-1 text-[13px]">
      <span className="w-16 shrink-0 text-[var(--color-muted)]">{label}</span>
      <span className="min-w-0 break-words text-[var(--color-heading)]">{children}</span>
    </div>
  );
}

type ChatLine = { from: "you" | "ai"; text: string };

/** Questions to start from; booking ones only while there is something to book. */
const starters = (booking: boolean) =>
  booking ? ["Summarize this", "What do we still need to book?", "Why this suggestion?"] : ["Summarize this", "Why this suggestion?"];

/**
 * The manager's chat with the AI about one card: questions get answers, and
 * instructions change the suggestion at the bottom of the card. Nothing said
 * here goes to the customer.
 */
function AiChat({
  lines,
  booking,
  asking,
  disabled,
  onSend,
}: {
  lines: ChatLine[];
  /** The suggestion is about booking (a text, a time, waiting on them). */
  booking: boolean;
  asking: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, asking]);
  const send = (text: string) => {
    if (!text.trim() || asking || disabled) return;
    onSend(text.trim());
    setDraft("");
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-24 flex-1 flex-col gap-2.5 overflow-y-auto">
        {lines.length ? null : (
          <p className="mt-auto text-[13px] leading-5 text-[var(--color-muted)]">
            Ask about this, or tell the AI what to do instead. It changes the suggestion; you still approve it.
          </p>
        )}
        {lines.map((line, index) =>
          line.from === "you" ? (
            <div key={index} className="max-w-[85%] self-end whitespace-pre-line rounded-[14px_14px_4px_14px] bg-[var(--color-primary)] px-3 py-2 text-[13.5px] leading-5 text-[var(--color-primary-ink)]">
              {line.text}
            </div>
          ) : (
            <div key={index} className="flex max-w-[92%] gap-2 self-start">
              <Spark className="mt-2.5 text-[var(--color-brand-strong)]" />
              <div className="whitespace-pre-line rounded-[14px_14px_14px_4px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13.5px] leading-5 text-[var(--color-heading)]">
                {line.text}
              </div>
            </div>
          ),
        )}
        {asking ? (
          <p className="flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
            <Spinner className="h-3.5 w-3.5" /> Thinking…
          </p>
        ) : null}
        <div ref={end} />
      </div>
      {lines.length ? null : (
        <div className="flex flex-wrap gap-1.5">
          {starters(booking).map((starter) => (
            <button
              key={starter}
              type="button"
              disabled={asking || disabled}
              onClick={() => send(starter)}
              className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--color-brand-strong)] outline-none hover:border-[var(--color-brand)] focus-visible:shadow-[var(--focus-ring)] disabled:opacity-50"
            >
              {starter}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1.5 pl-3 pr-1.5 focus-within:border-[var(--color-brand)]"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <input
          aria-label="Message the AI"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={1000}
          placeholder="Ask, or tell the AI what to do…"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
        />
        <button
          type="submit"
          aria-label="Send to the AI"
          disabled={!draft.trim() || asking || disabled}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-ink)] outline-none focus-visible:shadow-[var(--focus-ring)] disabled:opacity-40"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M10 16V4M5 9l5-5 5 5" />
          </svg>
        </button>
      </form>
    </div>
  );
}

/**
 * A card, opened, in three columns: the customer on the left, everything that
 * happened with them in the middle with the AI's suggestion to approve
 * underneath, and on the right the day of a time in that suggestion. The chat
 * with the AI, which is how the suggestion gets changed, opens from the Ask AI
 * button in the corner.
 */
function CardDialog({
  summary,
  onClose,
  onDone,
}: {
  summary: WorkflowCardSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [card, setCard] = useState<WorkflowCardDetail | null>(null);
  const [suggestion, setSuggestion] = useState<WorkflowSuggestion | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  // The text is the AI's, with its {{t1}} placeholders; nobody types to the customer, they pick.
  const [slots, setSlots] = useState<Record<string, WorkflowTime>>({});
  const [bookTime, setBookTime] = useState<WorkflowTime | null>(null);
  const [lead, setLead] = useState<WorkflowLeadFields>(emptyLead);
  /** The time shown on the left: a slot's id, or "book". */
  const [focus, setFocus] = useState<string | null>(null);

  function take(next: WorkflowSuggestion | null) {
    setSuggestion(next);
    setSlots(Object.fromEntries((next?.times ?? []).map((time) => [time.id, time])));
    setBookTime(next?.book ?? next?.options[0] ?? null);
    setLead(next?.lead ?? emptyLead);
    // The first offered time's day shows straight away.
    setFocus(next?.action === "book" ? "book" : next?.action === "text" ? (next.times[0]?.id ?? null) : null);
  }

  useEffect(() => {
    let cancelled = false;
    getWorkflowCard(summary.id).then(
      (detail) => {
        if (cancelled) return;
        setCard(detail);
        take(detail.suggestion);
      },
      () => !cancelled && setError("This card couldn't load."),
    );
    return () => {
      cancelled = true;
    };
  }, [summary.id]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose]);

  function say(text: string) {
    const lines: ChatLine[] = [...chat, { from: "you", text }];
    setChat(lines);
    setError("");
    setAsking(true);
    chatWorkflowAI(summary.id, lines).then((result) => {
      setAsking(false);
      if (!result.ok) {
        setChat([...lines, { from: "ai", text: result.error ?? "I couldn't answer that. Try again." }]);
        return;
      }
      setChat([...lines, { from: "ai", text: result.answer || (result.suggestion ? "I updated the suggestion." : "Done.") }]);
      if (result.suggestion) take(result.suggestion);
    });
  }

  // A fresh suggestion from scratch, when this one is off.
  const [retrying, setRetrying] = useState(false);
  function retry() {
    setError("");
    setAsking(true);
    setRetrying(true);
    suggestNext(summary.id).then((result) => {
      setAsking(false);
      setRetrying(false);
      if (!result.ok || !result.suggestion) setError(result.error ?? "The AI couldn't suggest anything.");
      else take(result.suggestion);
    });
  }

  function run(action: () => Promise<Result>) {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      else onDone();
    });
  }

  const step: Step | null = suggestion?.action ?? null;
  const template = suggestion?.message ?? "";
  const text = template.replace(SLOT, (whole, id: string) => slots[id]?.label ?? whole);
  const focused = focus === "book" ? bookTime : focus ? (slots[focus] ?? null) : null;
  const needsLead = card ? !card.leadId : false;
  const leadMissing = needsLead && (!lead.name?.trim() || !lead.address?.trim());
  const setField = (field: keyof WorkflowLeadFields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setLead((current) => ({ ...current, [field]: event.target.value }));
  const pickTime = (time: WorkflowTime) => {
    if (focus === "book") setBookTime(time);
    else if (focus) setSlots((current) => ({ ...current, [focus]: { ...time, id: focus } }));
  };
  const open = summary.stage !== "closed" && summary.stage !== "booked";
  const tag = WORKFLOW_STAGES.find((stage) => stage.id === summary.stage)!;
  const move = (stage: "waiting" | "closed" | "new", reason?: string) => run(() => moveWorkflowCard(summary.id, stage, reason));

  const leadFields = (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Name">
        <Input value={lead.name ?? ""} onChange={setField("name")} />
      </Field>
      <Field label="Address">
        <Input value={lead.address ?? ""} onChange={setField("address")} />
      </Field>
    </div>
  );

  // Every action asks first: a text or a booking can't be taken back.
  const sure = (question: string, action: () => Promise<Result>) => {
    if (window.confirm(question)) run(action);
  };
  const closeCard = (
    <Button
      type="button"
      variant="secondary"
      className="h-9 px-4"
      disabled={pending}
      onClick={() => sure(`Close ${summary.name}'s card without doing anything?`, () => moveWorkflowCard(summary.id, "closed", "Closed without action"))}
    >
      Close card
    </Button>
  );
  /** The suggestion's button, with "Close card" beside it. */
  const primary = (label: string, question: string, disabled: boolean, action: () => Promise<Result>) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {closeCard}
      <Button type="button" className="h-9 px-4" disabled={pending || disabled} onClick={() => sure(question, action)}>
        {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
        {label}
      </Button>
    </div>
  );

  const heading =
    asking && !suggestion
      ? "Thinking…"
      : step === "text"
        ? "AI suggests this text"
        : step === "book"
          ? "AI suggests booking it"
          : step === "wait"
            ? "AI suggests waiting on them"
            : step === "close"
              ? "AI says there's nothing to book"
              : step === "needs_you"
                ? "AI stopped: it needs you"
                : "No suggestion yet";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={summary.name}
        className="relative grid h-[min(840px,calc(100dvh-2rem))] w-full max-w-[1340px] grid-cols-1 overflow-y-auto rounded-2xl bg-[var(--color-surface)] shadow-[var(--shadow-pop)] lg:grid-cols-[270px_minmax(0,1fr)_400px] lg:overflow-hidden"
      >
        <aside className="order-2 flex min-h-0 flex-col overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 lg:order-none lg:border-r lg:border-t-0">
          <div className="flex flex-1 flex-col gap-5">
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-[var(--color-muted)]">Customer</h3>
              <Detail label="Phone">{card?.phone ?? "—"}</Detail>
              {card?.email ? <Detail label="Email">{card.email}</Detail> : null}
              <Detail label="Address">{card?.address ?? lead.address ?? "Not yet"}</Detail>
              {lead.request ? <Detail label="Wants">{lead.request}</Detail> : null}
              <Detail label="Came in">{cameIn(summary)}</Detail>
            </div>
            {card?.appointments.length ? (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-[var(--color-muted)]">Booked</h3>
                {card.appointments.map((appointment) => (
                  <p key={appointment.startsAt} className="text-[13px] text-[var(--color-heading)]">
                    {fmtDateTime(appointment.startsAt)}
                    {appointment.with ? ` with ${appointment.with}` : ""}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="mt-auto flex flex-col gap-1.5">
              {summary.leadId ? (
                <Link href={`/deals/${summary.leadId}`} className={buttonClassName({ variant: "secondary" })}>
                  Open deal
                </Link>
              ) : null}
              {summary.stage === "closed" ? (
                <Button type="button" variant="secondary" disabled={pending} onClick={() => move("new")}>
                  Reopen
                </Button>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="order-1 flex min-h-0 flex-col lg:order-none">
          <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[15px] font-semibold text-[var(--color-text)]">
              {(summary.name.match(/[A-Za-z]/)?.[0] ?? "#").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-[var(--color-heading)]">{summary.name}</h2>
                <Tag tone={tag.tone}>{tag.name}</Tag>
              </div>
              <p className="truncate text-[12.5px] text-[var(--color-muted)]">came in as {cameIn(summary).toLowerCase()}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div className="min-h-40 flex-1 overflow-y-auto px-5 py-4">
            {card ? (
              <Activity card={card} />
            ) : (
              <p className="flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
                <Spinner className="h-3.5 w-3.5" /> Loading…
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2.5 border-t border-[var(--color-border)] bg-[var(--color-brand-soft)] px-5 pb-4 pt-3.5">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-brand-strong)]">
              <Spark />
              {heading}
              {open && card ? (
                <span className="ml-auto">
                  <Quiet onClick={retry} disabled={asking}>
                    {retrying ? "Thinking…" : "Retry"}
                  </Quiet>
                </span>
              ) : null}
            </div>

            {step === "text" ? (
              <>
                <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-[14px] leading-8 text-[var(--color-heading)]">
                  {template.split(SLOT).map((part, index) =>
                    index % 2 ? (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setFocus(focus === part ? null : part)}
                        aria-pressed={focus === part}
                        className={cn(
                          "mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 align-baseline text-[13.5px] font-semibold leading-6 outline-none focus-visible:shadow-[var(--focus-ring)]",
                          focus === part
                            ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-ink)]"
                            : "border-transparent bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)] hover:border-[var(--color-brand)]",
                        )}
                      >
                        {slots[part]?.label ?? "a time"}
                        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-2.5 w-2.5">
                          <path d="M5 8l5 5 5-5" />
                        </svg>
                      </button>
                    ) : (
                      <span key={index} className="whitespace-pre-line">{part}</span>
                    ),
                  )}
                </div>
                {needsLead && (lead.name || lead.address) ? leadFields : null}
                {open ? primary("Send text", `Send this text to ${summary.name}?`, !text.trim(), () => approveText(summary.id, text, lead)) : null}
              </>
            ) : step === "book" ? (
              <>
                {bookTime ? (
                  <button
                    type="button"
                    onClick={() => setFocus("book")}
                    className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-left outline-none focus-visible:shadow-[var(--focus-ring)]"
                  >
                    <span className="block text-[14px] font-semibold text-[var(--color-heading)]">
                      {bookTime.label} <span className="font-normal text-[var(--color-muted)]">with {bookTime.person}</span>
                    </span>
                    <span className="block text-[12.5px] text-[var(--color-muted)]">
                      On-site estimate, {card?.settings.minutes ?? 60} min{card?.address ? ` · ${card.address}` : ""} · they get your usual confirmation
                    </span>
                  </button>
                ) : (
                  <p className="text-[13px] text-[var(--color-muted)]">No open times: {(suggestion?.noTimes ?? "none found").toLowerCase()}</p>
                )}
                {needsLead ? leadFields : null}
                {open ? primary("Book estimate", `Book ${bookTime?.label ?? "this time"} with ${bookTime?.person ?? "them"}? ${summary.name} gets the confirmation.`, !bookTime || leadMissing, () => approveBooking(summary.id, bookTime!, lead)) : null}
              </>
            ) : suggestion ? (
              <>
                <p className="text-[14px] leading-5 text-[var(--color-heading)]">
                  {suggestion.reason || suggestion.summary}
                  {step === "needs_you" ? " Nothing was sent." : ""}
                </p>
                {open ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {step === "close" ? (
                      <Button type="button" className="h-9 px-4" disabled={pending} onClick={() => sure(`Close ${summary.name}'s card?`, () => moveWorkflowCard(summary.id, "closed", suggestion.reason || "Nothing to book"))}>
                        Close card
                      </Button>
                    ) : step === "wait" ? (
                      <>
                        {closeCard}
                        <Button type="button" className="h-9 px-4" disabled={pending || summary.stage === "waiting"} onClick={() => move("waiting", suggestion.reason || "Waiting on them")}>
                          Move to Waiting on them
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" variant="danger" className="h-9 px-4" disabled={pending} onClick={() => sure(`Move ${summary.name} to Not a lead?`, () => moveWorkflowCard(summary.id, "closed", "Not a lead"))}>
                          Move to Not a lead
                        </Button>
                        <Button type="button" className="h-9 px-4" disabled={pending} onClick={() => sure(`Close ${summary.name}'s card?`, () => moveWorkflowCard(summary.id, "closed", "Dealt with"))}>
                          Close card
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <Button type="button" variant="secondary" className="self-start" disabled={asking || !card} onClick={retry}>
                Suggest a next step
              </Button>
            )}

            {error ? (
              <p role="alert" className="text-[13px] text-[var(--color-bad)]">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <aside className="order-3 flex min-h-0 flex-col overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 pb-20 lg:order-none lg:border-l lg:border-t-0">
          {focused && suggestion && card ? (
            <TimePanel
              cardId={summary.id}
              address={lead.address}
              time={focused}
              suggestion={suggestion}
              minutes={card.settings.minutes}
              timezone={card.timezone}
              onUse={pickTime}
              onBack={() => setFocus(null)}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-[var(--color-muted)]">Times</h3>
              {step === "text" && Object.keys(slots).length ? (
                <ul className="flex flex-col gap-1.5">
                  {Object.entries(slots).map(([id, time]) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setFocus(id)}
                        className="w-full rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-left outline-none hover:border-[var(--color-border-strong)] focus-visible:shadow-[var(--focus-ring)]"
                      >
                        <span className="block text-[13px] font-semibold text-[var(--color-heading)]">
                          {time.label} <span className="font-normal text-[var(--color-muted)]">· {time.person}</span>
                        </span>
                        <span className="block text-xs text-[var(--color-good)]">{time.near ?? "See the day"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] leading-5 text-[var(--color-muted)]">
                  {suggestion?.noTimes
                    ? `No times to offer: ${suggestion.noTimes.toLowerCase()}`
                    : "When the AI offers a time, its day shows here: the other visits, the drive, and other times to use."}
                </p>
              )}
            </div>
          )}
        </aside>

        {chatOpen ? (
          <div className="absolute bottom-4 right-4 z-10 flex h-[min(500px,calc(100%-2rem))] w-[min(380px,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-[var(--shadow-pop)]">
            <div className="flex items-center gap-2 bg-[var(--color-brand)] px-3.5 py-2.5 text-[14px] font-semibold text-[var(--color-brand-ink)]">
              <Spark />
              AI assistant
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Minimize the AI assistant"
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md outline-none hover:bg-white/15 focus-visible:bg-white/15"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4">
                  <path d="M5 10h10" />
                </svg>
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-3.5">
              <AiChat lines={chat} booking={step === "text" || step === "book" || step === "wait"} asking={asking} disabled={!card || !open} onSend={say} />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="absolute bottom-4 right-4 z-10 flex h-12 items-center gap-2 rounded-full bg-[var(--color-brand)] pl-3.5 pr-4 text-[14px] font-semibold text-[var(--color-brand-ink)] shadow-[0_8px_24px_rgba(47,107,255,0.4)] outline-none hover:brightness-110 focus-visible:shadow-[var(--focus-ring)]"
          >
            <Spark className="h-[18px] w-[18px]" />
            Ask AI
            {chat.length ? <span className="h-2 w-2 rounded-full bg-white/80" aria-hidden="true" /> : null}
          </button>
        )}
      </section>
    </div>
  );
}
