"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import {
  approveBooking,
  approveText,
  getWorkflowCard,
  moveWorkflowCard,
  suggestNext,
} from "@/lib/actions/workflows";
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
import { Button, Field, Input, Spinner, TAG_DOT, Tag, Textarea, buttonClassName, cn } from "./ui";

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
    const next = cards.find((card) => card.stage === "new" && !card.suggestion && !tried.current.has(card.id));
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
      {card.stage === "new" ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {thinking ? (
            <span className="flex items-center gap-1.5 text-[var(--color-muted)]">
              <Spinner className="h-3 w-3" /> Thinking…
            </span>
          ) : card.suggestion ? (
            <Tag tone="blue">{card.suggestion.action === "book" ? "Ready to book" : "Suggestion ready"}</Tag>
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
  reopened: (event) => `${event.by ?? "Someone"} reopened it`,
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
    if (!notes?.summary?.length && !notes?.transcript) {
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
        </div>
        {notes.summary?.length ? (
          <ul className="mt-1 list-disc pl-4 text-[var(--color-heading)]">
            {notes.summary.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        ) : null}
        {notes.transcript ? (
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
  time,
  suggestion,
  minutes,
  timezone,
  onUse,
  onBack,
}: {
  time: WorkflowTime;
  suggestion: WorkflowSuggestion;
  minutes: number;
  timezone: string;
  onUse: (time: WorkflowTime) => void;
  onBack: () => void;
}) {
  const date = new Date(time.startsAt).toLocaleDateString("en-CA", { timeZone: timezone });
  const found = (suggestion.days ?? []).find((day) => day.userId === time.personId && day.date === date);
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
  const others = suggestion.options.filter((option) => option.startsAt !== time.startsAt || option.personId !== time.personId);
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
        {day ? (
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
      {others.length ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-muted)]">Use another time, closest first</h4>
          <ul className="flex flex-col gap-1.5">
            {others.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => onUse(option)}
                  className="flex w-full items-center gap-3 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-left outline-none hover:border-[var(--color-border-strong)] focus-visible:shadow-[var(--focus-ring)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-[var(--color-heading)]">
                      {option.label} <span className="font-normal text-[var(--color-muted)]">· {option.person}</span>
                    </span>
                    {option.near ? <span className="block text-xs text-[var(--color-good)]">{option.near}</span> : null}
                  </span>
                  <span className="text-xs font-medium text-[var(--color-muted)]">Use</span>
                </button>
              </li>
            ))}
          </ul>
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

/**
 * A card, opened: the contact's whole activity on the left with the AI's next
 * step where you'd type, and on the right the customer, or the day of a time
 * you clicked (to check the drive around it, or use another).
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
  const [step, setStep] = useState<Step | null>(null);
  // The text keeps its {{t1}} placeholders until it is edited by hand (`plain`).
  const [slots, setSlots] = useState<Record<string, WorkflowTime>>({});
  const [plain, setPlain] = useState<string | null>(null);
  const [bookTime, setBookTime] = useState<WorkflowTime | null>(null);
  const [reply, setReply] = useState("");
  const [lead, setLead] = useState<WorkflowLeadFields>(emptyLead);
  /** The time shown on the right: a slot's id, or "book". */
  const [focus, setFocus] = useState<string | null>(null);

  function take(next: WorkflowSuggestion | null) {
    setSuggestion(next);
    setStep(next?.action ?? null);
    setSlots(Object.fromEntries((next?.times ?? []).map((time) => [time.id, time])));
    setPlain(null);
    setBookTime(next?.book ?? next?.options[0] ?? null);
    setLead(next?.lead ?? emptyLead);
    setFocus(next?.action === "book" ? "book" : null);
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

  function askAgain() {
    setError("");
    setAsking(true);
    suggestNext(summary.id).then((result) => {
      setAsking(false);
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

  const template = suggestion?.message ?? "";
  const text = plain ?? template.replace(SLOT, (whole, id: string) => slots[id]?.label ?? whole);
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

  const quietLinks = (
    <>
      {step !== "text" && suggestion ? <Quiet onClick={() => { setStep("text"); setFocus(null); }}>Write a text</Quiet> : null}
      {step !== "book" && suggestion?.options.length ? (
        <Quiet onClick={() => { setStep("book"); setFocus("book"); }}>Book a time</Quiet>
      ) : null}
      {open ? (
        <Quiet disabled={pending} onClick={() => run(() => moveWorkflowCard(summary.id, "closed", "Not a lead"))}>
          Not a lead
        </Quiet>
      ) : null}
      {open && summary.stage !== "needs_you" ? (
        <Quiet disabled={pending} onClick={() => run(() => moveWorkflowCard(summary.id, "needs_you"))}>
          I&apos;ll handle it
        </Quiet>
      ) : null}
      {summary.stage === "closed" ? (
        <Quiet disabled={pending} onClick={() => run(() => moveWorkflowCard(summary.id, "new"))}>
          Reopen
        </Quiet>
      ) : null}
    </>
  );

  const primary = (label: string, disabled: boolean, action: () => Promise<Result>) => (
    <Button type="button" className="ml-auto h-9 px-4" disabled={pending || disabled} onClick={() => run(action)}>
      {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
      {label}
    </Button>
  );

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
        className="grid h-[min(840px,calc(100dvh-2rem))] w-full max-w-[1080px] grid-cols-1 overflow-y-auto rounded-2xl bg-[var(--color-surface)] shadow-[var(--shadow-pop)] md:grid-cols-[minmax(0,1fr)_400px] md:overflow-hidden"
      >
        <div className="flex min-h-0 flex-col">
          <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[15px] font-semibold text-[var(--color-text)]">
              {(summary.name.match(/[A-Za-z]/)?.[0] ?? "#").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-[var(--color-heading)]">{summary.name}</h2>
                <Tag tone={tag.tone}>{tag.name}</Tag>
              </div>
              <p className="truncate text-[12.5px] text-[var(--color-muted)]">
                {[card?.phone !== summary.name ? card?.phone : null, card?.address, `came in as ${cameIn(summary).toLowerCase()}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {summary.leadId ? (
              <Link href={`/deals/${summary.leadId}`} className={buttonClassName({ variant: "secondary" })}>
                Open deal
              </Link>
            ) : null}
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

          <div
            className={cn(
              "flex flex-col gap-2.5 border-t border-[var(--color-border)] px-5 pb-4 pt-3.5",
              step === "needs_you" || step === "close" ? "bg-[var(--tag-yellow-bg)]" : "bg-[var(--color-brand-soft)]",
            )}
          >
            {step === "text" || step === "book" || !step ? (
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-brand-strong)]">
                <Spark />
                {asking ? "Thinking…" : step === "book" ? "AI suggests booking it" : step ? "AI suggests this reply" : "No suggestion yet"}
                <span className="ml-auto">
                  <Quiet onClick={askAgain} disabled={asking || !card}>
                    {suggestion ? "Suggest again" : "Suggest"}
                  </Quiet>
                </span>
              </div>
            ) : (
              <p className="text-[13px] text-[var(--color-text)]">
                <b className="font-semibold text-[var(--tag-yellow-text)]">
                  {step === "close" ? "AI suggests closing it" : "Needs you"}
                  {suggestion?.reason ? `: ${suggestion.reason}` : ""}.
                </b>{" "}
                {step === "needs_you" ? "Nothing was sent." : ""}
              </p>
            )}

            {step === "text" ? (
              <>
                {plain === null ? (
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
                ) : (
                  <Textarea value={plain} onChange={(event) => setPlain(event.target.value)} rows={4} maxLength={1000} className="text-[14px]" />
                )}
                {needsLead && (lead.name || lead.address) ? leadFields : null}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {plain === null ? (
                    <Quiet onClick={() => { setPlain(text); setFocus(null); }}>Edit text</Quiet>
                  ) : null}
                  {quietLinks}
                  {primary("Send", !text.trim(), () => approveText(summary.id, text, lead))}
                </div>
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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {quietLinks}
                  {primary("Book estimate", !bookTime || leadMissing, () => approveBooking(summary.id, bookTime!, lead))}
                </div>
              </>
            ) : (
              <>
                {open ? (
                  <Textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    rows={2}
                    maxLength={1000}
                    placeholder={`Reply to ${summary.name}…`}
                    className="min-h-0 text-[14px]"
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {quietLinks}
                  {step === "close" && !reply.trim()
                    ? primary("Close card", !open, () => moveWorkflowCard(summary.id, "closed", suggestion?.reason))
                    : open
                      ? primary("Send", !reply.trim(), () => approveText(summary.id, reply, emptyLead))
                      : null}
                </div>
              </>
            )}

            {error ? (
              <p role="alert" className="text-[13px] text-[var(--color-bad)]">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-[18px] md:border-l md:border-t-0">
          {focused && suggestion && card ? (
            <TimePanel
              time={focused}
              suggestion={suggestion}
              minutes={card.settings.minutes}
              timezone={card.timezone}
              onUse={pickTime}
              onBack={() => setFocus(null)}
            />
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-[var(--color-muted)]">Customer</h3>
                <Detail label="Phone">{card?.phone ?? "—"}</Detail>
                {card?.email ? <Detail label="Email">{card.email}</Detail> : null}
                <Detail label="Address">{card?.address ?? lead.address ?? "Not yet"}</Detail>
                {lead.request ? <Detail label="Wants">{lead.request}</Detail> : null}
                <Detail label="Came in">{cameIn(summary)}</Detail>
              </div>
              {step === "text" && plain === null && Object.keys(slots).length ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--color-muted)]">Times in the text</h3>
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
                </div>
              ) : null}
              {suggestion?.noTimes ? (
                <p className="text-[12.5px] text-[var(--color-muted)]">No times to offer: {suggestion.noTimes.toLowerCase()}</p>
              ) : null}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
