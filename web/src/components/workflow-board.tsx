"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  approveBooking,
  approveText,
  getWorkflowCard,
  moveWorkflowCard,
  suggestNext,
} from "@/lib/actions/workflows";
import { fmtDateTime, fmtRelativeTime } from "@/lib/format";
import {
  WORKFLOW_KINDS,
  WORKFLOW_STAGES,
  type WorkflowCardDetail,
  type WorkflowCardSummary,
  type WorkflowLeadFields,
  type WorkflowSuggestion,
} from "@/lib/workflow-types";
import { Dot } from "./pipeline-ui";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { Button, Field, Input, Select, Spinner, TAG_DOT, Tag, Textarea, cn } from "./ui";

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
  // The step being approved, editable.
  const [mode, setMode] = useState<"text" | "book">("text");
  const [message, setMessage] = useState("");
  const [timeId, setTimeId] = useState("");
  const [lead, setLead] = useState<WorkflowLeadFields>(emptyLead);

  function take(next: WorkflowSuggestion | null) {
    setSuggestion(next);
    setMode(next?.action === "book" ? "book" : "text");
    setMessage(next?.message ?? "");
    setTimeId(next?.book?.id ?? next?.options[0]?.id ?? "");
    setLead(next?.lead ?? emptyLead);
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

  function askAgain() {
    setError("");
    setAsking(true);
    suggestNext(summary.id).then((result) => {
      setAsking(false);
      if (!result.ok || !result.suggestion) setError(result.error ?? "The AI couldn't suggest anything.");
      else take(result.suggestion);
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      else onDone();
    });
  }

  const options = suggestion?.options ?? [];
  const chosen = options.find((option) => option.id === timeId) ?? null;
  const needsLead = card ? !card.leadId : false;
  const setField = (field: keyof WorkflowLeadFields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setLead((current) => ({ ...current, [field]: event.target.value }));

  return (
    <ProjectModal
      title={summary.name}
      subtitle={[cameIn(summary), card?.phone, card?.address].filter(Boolean).join(" · ")}
      onClose={onClose}
      wide
    >
      <div className="grid min-h-0 gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="What happened" className="max-h-[60vh] overflow-y-auto border-b border-[var(--color-border)] px-5 py-4 md:border-b-0 md:border-r">
          {!card ? (
            <p className="flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
              <Spinner className="h-3.5 w-3.5" /> Loading…
            </p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {card.notes.map((note, index) => (
                <li key={`note-${index}`} className="text-[13px] leading-5 text-[var(--color-text)]">
                  <span className="block text-[11px] text-[var(--color-faint)]">Their request</span>
                  <span className="whitespace-pre-line">{note}</span>
                </li>
              ))}
              {card.messages.map((item, index) => (
                <li key={index} className="text-[13px] leading-5">
                  <span className="block text-[11px] text-[var(--color-faint)]">
                    {item.direction === "inbound" ? "Them" : "Us"} · {fmtDateTime(item.at)}
                  </span>
                  <span className={cn("whitespace-pre-line", item.direction === "inbound" ? "text-[var(--color-heading)]" : "text-[var(--color-muted)]")}>
                    {item.text || "—"}
                  </span>
                </li>
              ))}
              {!card.notes.length && !card.messages.length ? (
                <li className="text-[13px] text-[var(--color-faint)]">Nothing said yet.</li>
              ) : null}
            </ol>
          )}
        </section>

        <section aria-label="Next step" className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <h3 className="mr-auto text-[13px] font-semibold text-[var(--color-heading)]">Suggested next step</h3>
            <Button type="button" variant="ghost" size="sm" onClick={askAgain} disabled={asking || !card}>
              {asking ? <Spinner className="h-3 w-3" /> : null}
              {suggestion ? "Suggest again" : "Suggest"}
            </Button>
          </div>

          {!suggestion ? (
            <p className="text-[13px] text-[var(--color-muted)]">{asking ? "Thinking…" : "No suggestion yet."}</p>
          ) : suggestion.action === "needs_you" || suggestion.action === "close" ? (
            <div className="rounded-[var(--radius-control)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[13px]">
              <p className="font-medium text-[var(--color-heading)]">
                {suggestion.action === "needs_you" ? "Needs you" : "Close it"}
              </p>
              <p className="mt-0.5 text-[var(--color-text)]">{suggestion.reason}</p>
            </div>
          ) : null}

          {suggestion ? (
            <>
              <div className="flex gap-1">
                {(["text", "book"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    aria-pressed={mode === value}
                    className={cn(
                      "h-7 rounded-[5px] px-2.5 text-[13px] font-medium",
                      mode === value
                        ? "bg-[var(--color-surface-2)] text-[var(--color-heading)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-heading)]",
                    )}
                  >
                    {value === "text" ? "Text" : "Book"}
                  </button>
                ))}
              </div>

              {mode === "text" ? (
                <Field label="Text">
                  <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} maxLength={1000} />
                </Field>
              ) : options.length ? (
                <Field label="Time">
                  <Select value={timeId} onChange={(event) => setTimeId(event.target.value)} className="w-full">
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label} · {option.person}
                        {option.near ? ` · ${option.near}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-[13px] text-[var(--color-muted)]">No times to book: {(suggestion.noTimes ?? "none open").toLowerCase()}</p>
              )}

              {needsLead && (mode === "book" || lead.name || lead.address) ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Name">
                    <Input value={lead.name ?? ""} onChange={setField("name")} />
                  </Field>
                  <Field label="Address">
                    <Input value={lead.address ?? ""} onChange={setField("address")} />
                  </Field>
                </div>
              ) : null}
            </>
          ) : null}

          {error ? (
            <p role="alert" className="text-[13px] text-[var(--color-bad)]">
              {error}
            </p>
          ) : null}
        </section>
      </div>

      <ModalFooter>
        {summary.leadId ? (
          <Link href={`/deals/${summary.leadId}`} className="mr-auto text-[13px] font-medium text-[var(--color-link,var(--color-brand))] hover:underline">
            Open deal
          </Link>
        ) : (
          <span className="mr-auto" />
        )}
        {summary.stage === "closed" ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => moveWorkflowCard(summary.id, "new"))}>
            Reopen
          </Button>
        ) : (
          <Button
            type="button"
            variant={suggestion?.action === "close" ? "primary" : "ghost"}
            disabled={pending}
            onClick={() => run(() => moveWorkflowCard(summary.id, "closed", suggestion?.action === "close" ? suggestion.reason : undefined))}
          >
            Close
          </Button>
        )}
        {summary.stage !== "needs_you" && summary.stage !== "closed" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => moveWorkflowCard(summary.id, "needs_you", suggestion?.action === "needs_you" ? suggestion.reason : undefined))}
          >
            Needs you
          </Button>
        ) : null}
        {suggestion && mode === "book" ? (
          <Button
            type="button"
            disabled={pending || !chosen || (needsLead && (!lead.name?.trim() || !lead.address?.trim()))}
            onClick={() => chosen && run(() => approveBooking(summary.id, chosen, lead))}
          >
            {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
            Approve and book
          </Button>
        ) : suggestion && mode === "text" ? (
          <Button type="button" disabled={pending || !message.trim()} onClick={() => run(() => approveText(summary.id, message, lead))}>
            {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
            Approve and send
          </Button>
        ) : null}
      </ModalFooter>
    </ProjectModal>
  );
}
