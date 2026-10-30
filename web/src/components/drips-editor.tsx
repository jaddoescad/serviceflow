"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  addDripTemplate,
  deleteDripStep,
  getDripPreviewRecords,
  previewDripMessage,
  saveDripStep,
  sendDripTest,
  setStageDrips,
} from "@/lib/actions/messaging";
import type { ActionResult } from "@/lib/actions/rpc";
import {
  CHANNEL_LABELS,
  MESSAGE_PLACEHOLDERS,
  PLACEHOLDER_LABELS,
  type DripPreview,
  type DripStage,
  type DripStep,
  type DripTemplate,
  type MessageChannel,
  type PreviewRecord,
} from "@/lib/messaging-types";
import { ChatIcon, MailIcon, Switch, linkStyle } from "./pipeline-ui";
import { Badge, Button, Card, Field, Input, Select, Textarea, cn } from "./ui";

// Pieces shared with the reminder rules editor -----------------------------

/** Largest first, so a delay shows in its biggest whole unit. */
const UNITS = [
  ["days", 1440],
  ["hours", 60],
  ["minutes", 1],
] as const;
type Unit = (typeof UNITS)[number];

function splitDelay(minutes: number): { unit: Unit; count: number } {
  const unit = UNITS.find(([, size]) => minutes % size === 0) ?? UNITS[2];
  return { unit, count: minutes / unit[1] };
}

/** "1 day", "2 hours", "30 minutes". */
export function delayLabel(minutes: number): string {
  const {
    unit: [name],
    count,
  } = splitDelay(minutes);
  return `${count} ${count === 1 ? name.slice(0, -1) : name}`;
}

/** A delay typed as a count of days, hours or minutes. */
export function useDelay(initialMinutes: number) {
  const initial = splitDelay(initialMinutes);
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [count, setCount] = useState(String(initial.count));
  return { unit, setUnit, count, setCount, minutes: Math.max(0, Math.round(Number(count) * unit[1])) };
}

export function DelayField({ label, delay }: { label: string; delay: ReturnType<typeof useDelay> }) {
  return (
    <Field label={label}>
      <span className="flex gap-2">
        <span className="w-20 shrink-0">
          <Input
            required
            inputMode="numeric"
            aria-label="Delay"
            value={delay.count}
            onChange={(event) => delay.setCount(event.target.value.replace(/[^0-9.]/g, ""))}
          />
        </span>
        <Select
          aria-label="Unit"
          value={delay.unit[0]}
          onChange={(event) => delay.setUnit(UNITS.find(([name]) => name === event.target.value) ?? UNITS[0])}
          className="min-w-0 flex-1"
        >
          {UNITS.map(([name]) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </span>
    </Field>
  );
}

/** The channel, subject and body of a message being edited. */
export type MessageDraft = { channel: MessageChannel; subject: string; body: string };

export function ChannelField({ value, onChange }: { value: MessageChannel; onChange: (channel: MessageChannel) => void }) {
  return (
    <Field label="Send by">
      <Select value={value} onChange={(event) => onChange(event.target.value as MessageChannel)} className="w-full">
        {(Object.keys(CHANNEL_LABELS) as MessageChannel[]).map((channel) => (
          <option key={channel} value={channel}>
            {CHANNEL_LABELS[channel]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** "{ } Insert placeholder" and its list; picking one never takes focus from the field. */
function PlaceholderMenu({ placeholders, onInsert }: { placeholders: string[]; onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
        className="-mr-2"
      >
        <span aria-hidden="true" className="font-mono text-[11px]">
          {"{ }"}
        </span>
        Insert placeholder
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-[var(--radius)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-pop)]"
        >
          {placeholders.map((token) => (
            <button
              key={token}
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onInsert(token);
                setOpen(false);
              }}
              className="flex h-8 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--color-hover)]"
            >
              <span className="truncate">{PLACEHOLDER_LABELS[token] ?? token}</span>
              <code className="shrink-0 text-[11px] text-[var(--color-faint)]">{token.slice(2, -2)}</code>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Subject (email only) and message, with a menu that inserts placeholders where the cursor was. */
export function MessageFields({
  message,
  onChange,
  quoConnected,
  placeholders,
}: {
  message: MessageDraft;
  onChange: (next: Partial<MessageDraft>) => void;
  quoConnected: boolean;
  placeholders: string[];
}) {
  const bodyId = useId();
  // The subject or message field last focused; a placeholder goes in at its cursor.
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  function insert(token: string) {
    const field = lastField.current;
    const key = field?.name === "subject" && message.channel === "email" ? "subject" : "body";
    const target = field?.name === key ? field : null;
    const value = message[key];
    const start = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? start;
    onChange({ [key]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <>
      {message.channel === "sms" && !quoConnected ? (
        <p className="text-xs text-[var(--color-warn)]">
          Texts are skipped until you{" "}
          <Link href="/settings#quo" className="underline">
            connect Quo in Settings
          </Link>
          .
        </p>
      ) : null}
      {message.channel === "email" ? (
        <Field label="Subject">
          <Input
            required
            name="subject"
            maxLength={200}
            value={message.subject}
            onFocus={(event) => (lastField.current = event.currentTarget)}
            onChange={(event) => onChange({ subject: event.target.value })}
          />
        </Field>
      ) : null}
      <div>
        <div className="mb-1 flex h-7 items-center justify-between gap-2">
          <label htmlFor={bodyId} className="text-xs font-medium text-[var(--color-muted)]">
            Message
          </label>
          <PlaceholderMenu placeholders={placeholders} onInsert={insert} />
        </div>
        <Textarea
          id={bodyId}
          required
          name="body"
          rows={7}
          maxLength={5000}
          value={message.body}
          onFocus={(event) => (lastField.current = event.currentTarget)}
          onChange={(event) => onChange({ body: event.target.value })}
        />
      </div>
    </>
  );
}

/** Inline form frame: fields, then the error and Cancel / Save. */
export function MessageForm({
  pending,
  error,
  saveLabel,
  onSubmit,
  onCancel,
  children,
}: {
  pending: boolean;
  error: string;
  saveLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="space-y-4 bg-[var(--color-surface-2)] px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : saveLabel}
        </Button>
      </div>
    </form>
  );
}

const ChannelIcon = ({ channel }: { channel: MessageChannel }) =>
  channel === "email" ? <MailIcon className="h-3.5 w-3.5" /> : <ChatIcon className="h-3.5 w-3.5" />;

/** A saved message: when it goes out and how, subject and body, then its controls. */
export function MessageRow({
  message,
  when,
  enabled,
  pending,
  onToggle,
  onEdit,
  onDelete,
}: {
  message: { channel: MessageChannel; subject: string | null; body: string };
  when: ReactNode;
  enabled: boolean;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className={cn("min-w-0 flex-[1_1_16rem]", !enabled && "opacity-50")}>
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-heading)]">{when}</span>
          <span aria-hidden="true" className="text-[var(--color-faint)]">
            ·
          </span>
          <ChannelIcon channel={message.channel} />
          {message.channel === "email" ? "Email" : "Text"}
        </div>
        {message.subject ? (
          <div className="mt-1 truncate text-[13px] font-medium text-[var(--color-heading)]">{message.subject}</div>
        ) : null}
        {/* Line breaks fold into spaces so two lines of preview show two lines of words. */}
        <p className="mt-0.5 line-clamp-2 text-[13px] text-[var(--color-muted)]">{message.body.replace(/\s*\n\s*/g, " ")}</p>
      </div>
      <div className="flex items-center gap-1">
        <label className="mr-1 flex h-7 items-center gap-2 text-xs text-[var(--color-muted)]">
          Active
          <Switch label="Active" checked={enabled} disabled={pending} onChange={onToggle} />
        </label>
        <Button variant="ghost" size="sm" onClick={onEdit} className={stepAction}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onDelete} className={stepAction}>
          Delete
        </Button>
      </div>
    </div>
  );
}

/** Edit and Delete show when the step is hovered (always on touch screens). */
const stepAction = "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100";

// Drips ----------------------------------------------------------------------

/** "Immediately" or "2 days after entering". */
const stepWhen = (minutes: number) => (minutes ? `${delayLabel(minutes)} after entering` : "Immediately");

/** The step rendered for a sample customer or a chosen deal, and a test send to yourself. */
function StepPreview({
  message,
  noun,
  records,
  recordId,
  onRecordChange,
}: {
  message: MessageDraft;
  noun: string;
  records: PreviewRecord[] | null;
  recordId: string;
  onRecordChange: (id: string) => void;
}) {
  const [preview, setPreview] = useState<DripPreview | null>(null);
  const [test, setTest] = useState<{ error?: string; message?: string }>({});
  const [testing, startTest] = useTransition();
  const subject = message.channel === "email" ? message.subject : "";

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      previewDripMessage({ subject, body: message.body, recordId: recordId || null })
        .catch(() => null)
        .then((next) => {
          if (live) setPreview(next);
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [subject, message.body, recordId]);

  const blank = (preview?.empty ?? []).map((key) => PLACEHOLDER_LABELS[`{{${key}}}`] ?? key);

  return (
    <section
      aria-label="Preview"
      className="flex min-w-0 flex-col rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div className="flex h-10 items-center justify-between gap-2 border-b border-[var(--color-border)] px-3">
        <span className="text-xs font-medium text-[var(--color-muted)]">Preview</span>
        <Select
          aria-label="Preview for"
          value={recordId}
          onChange={(event) => onRecordChange(event.target.value)}
          className="h-7 min-w-0 max-w-[65%] text-xs"
        >
          <option value="">Sample customer</option>
          {(records ?? []).map((record) => (
            <option key={record.id} value={record.id}>
              {record.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-h-40 flex-1 px-3 py-3 text-[13px]">
        {message.body.trim() ? (
          <>
            {message.channel === "email" ? (
              <p className="font-medium text-[var(--color-heading)]">
                {preview?.subject || <span className="text-[var(--color-faint)]">No subject</span>}
              </p>
            ) : null}
            <p className={cn("whitespace-pre-line break-words text-[var(--color-text)]", message.channel === "email" && "mt-2")}>
              {preview?.body ?? message.body}
            </p>
            {blank.length ? (
              <p className="mt-3 text-xs text-[var(--tag-yellow-text)]">
                Blank for {recordId ? `this ${noun}` : "the sample"}: {blank.join(", ")}.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[var(--color-faint)]">Write a message to preview it.</p>
        )}
      </div>
      <div className="flex min-h-10 items-center justify-between gap-2 border-t border-[var(--color-border)] px-3 py-1.5">
        <span
          role={test.error ? "alert" : "status"}
          className={cn("min-w-0 text-xs", test.error ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]")}
        >
          {test.error ?? test.message}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={testing || !message.body.trim() || (message.channel === "email" && !message.subject.trim())}
          onClick={() =>
            startTest(async () => {
              setTest({});
              const result = await sendDripTest({ ...message, subject, recordId: recordId || null });
              setTest(result.ok ? { message: `Test queued to ${result.address}` } : { error: result.error ?? "Could not send the test." });
            })
          }
        >
          {testing ? "Sending…" : "Send test"}
        </Button>
      </div>
    </section>
  );
}

function StepForm({
  stageId,
  step,
  quoConnected,
  noun,
  records,
  recordId,
  onRecordChange,
  onDone,
}: {
  stageId: string;
  step: DripStep | null;
  quoConnected: boolean;
  noun: string;
  records: PreviewRecord[] | null;
  recordId: string;
  onRecordChange: (id: string) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const delay = useDelay(step?.delayMinutes ?? 1440);
  const [message, setMessage] = useState<MessageDraft>({
    channel: step?.channel ?? "email",
    subject: step?.subject ?? "",
    body: step?.body ?? "",
  });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <MessageForm
      pending={pending}
      error={error}
      saveLabel="Save step"
      onCancel={onDone}
      onSubmit={() =>
        startTransition(async () => {
          setError("");
          const result = await saveDripStep({
            id: step?.id ?? crypto.randomUUID(),
            stageId,
            delayMinutes: delay.minutes,
            ...message,
            enabled: step?.enabled ?? true,
          });
          if (!result.ok) {
            setError(result.error ?? "Could not save the step.");
            return;
          }
          router.refresh();
          onDone();
        })
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <DelayField label="Send after" delay={delay} />
            <ChannelField value={message.channel} onChange={(channel) => setMessage((current) => ({ ...current, channel }))} />
          </div>
          <MessageFields
            message={message}
            onChange={(next) => setMessage((current) => ({ ...current, ...next }))}
            quoConnected={quoConnected}
            placeholders={MESSAGE_PLACEHOLDERS}
          />
        </div>
        <StepPreview message={message} noun={noun} records={records} recordId={recordId} onRecordChange={onRecordChange} />
      </div>
    </MessageForm>
  );
}

const TEMPLATES: { key: DripTemplate; label: string }[] = [
  { key: "review_request", label: "Review request" },
  { key: "aftercare", label: "Aftercare check-in" },
];

export function DripsEditor({
  pipeline,
  stages,
  quoConnected,
  reviewLinkSet = false,
}: {
  pipeline: "sales" | "jobs";
  stages: DripStage[];
  quoConnected: boolean;
  /** Whether the company has a review link, which the review request template needs. */
  reviewLinkSet?: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(stages[0]?.id ?? "");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [records, setRecords] = useState<PreviewRecord[] | null>(null);
  const [previewRecordId, setPreviewRecordId] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const stage = stages.find((item) => item.id === selectedId) ?? stages[0];
  const noun = pipeline === "sales" ? "deal" : "job";
  const stagesLabel = `${pipeline === "sales" ? "Sales" : "Jobs"} pipeline stages`;

  // Deals to preview against load the first time a step is opened.
  useEffect(() => {
    if (!editing || records) return;
    getDripPreviewRecords(pipeline)
      .catch(() => [])
      .then(setRecords);
  }, [editing, records, pipeline]);

  function select(id: string) {
    setSelectedId(id);
    setEditing(null);
    setError("");
  }

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      setError("");
      const result = await action();
      if (!result.ok) setError(result.error ?? "Could not update drips.");
      router.refresh();
    });
  }

  if (!stage) return null;
  const hasActiveStep = stage.steps.some((step) => step.enabled);
  const showTemplates = pipeline === "jobs" && stage.recordStatus === "completed";
  const form = (step: DripStep | null) => (
    <StepForm
      stageId={stage.id}
      step={step}
      quoConnected={quoConnected}
      noun={noun}
      records={records}
      recordId={previewRecordId}
      onRecordChange={setPreviewRecordId}
      onDone={() => setEditing(null)}
    />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
      <Select
        aria-label={stagesLabel}
        value={stage.id}
        onChange={(event) => select(event.target.value)}
        className="w-full lg:hidden"
      >
        {stages.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · {item.steps.length} {item.steps.length === 1 ? "step" : "steps"}
            {item.dripsEnabled && item.steps.length ? " · on" : ""}
          </option>
        ))}
      </Select>
      <nav aria-label={stagesLabel} className="hidden h-fit space-y-0.5 lg:block">
        {stages.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === stage.id ? "true" : undefined}
            onClick={() => select(item.id)}
            className={cn(
              "flex h-8 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px]",
              item.id === stage.id
                ? "bg-[var(--color-selected)] font-medium text-[var(--color-heading)]"
                : "text-[var(--color-text)] hover:bg-[var(--color-hover)]",
            )}
          >
            <span className="truncate">{item.name}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {item.dripsEnabled && item.steps.length ? <Badge tone="good">On</Badge> : null}
              <span className="text-xs tabular-nums text-[var(--color-faint)]">{item.steps.length}</span>
            </span>
          </button>
        ))}
      </nav>

      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--color-heading)]">{stage.name}</h2>
            <p className="text-xs text-[var(--color-muted)]">
              {stage.dripsEnabled
                ? `${noun === "deal" ? "Deals" : "Jobs"} that enter this stage get these messages.`
                : "Drips are off for this stage."}
            </p>
          </div>
          <label
            className="flex items-center gap-2 text-xs text-[var(--color-muted)]"
            title={!stage.dripsEnabled && !hasActiveStep ? "Add an active step first" : undefined}
          >
            {stage.dripsEnabled ? "On" : "Off"}
            <Switch
              label={`Drips for ${stage.name}`}
              checked={stage.dripsEnabled}
              disabled={pending || (!stage.dripsEnabled && !hasActiveStep)}
              onChange={(enabled) => run(() => setStageDrips(stage.id, enabled))}
            />
          </label>
        </div>
        {error ? (
          <p
            role="alert"
            className="border-b border-[var(--color-border)] bg-[var(--color-bad-soft)] px-4 py-2 text-[13px] text-[var(--color-bad)]"
          >
            {error}
          </p>
        ) : null}

        {stage.steps.length ? (
          <ol aria-label="Steps" className="py-1">
            {stage.steps.map((step, index) => (
              <li key={step.id} className="relative flex">
                {editing === step.id ? (
                  <div className="min-w-0 flex-1">{form(step)}</div>
                ) : (
                  <>
                    <div aria-hidden="true" className="relative flex w-10 shrink-0 justify-center pt-3">
                      <span
                        className={cn(
                          "absolute left-1/2 w-px -translate-x-1/2 bg-[var(--color-border)]",
                          index === 0 ? "top-4" : "top-0",
                          index === stage.steps.length - 1 ? "h-4" : "bottom-0",
                        )}
                      />
                      <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[11px] font-medium tabular-nums text-[var(--color-muted)]">
                        {index + 1}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 [&>div]:pl-1">
                      <MessageRow
                        message={step}
                        when={stepWhen(step.delayMinutes)}
                        enabled={step.enabled}
                        pending={pending}
                        onToggle={(enabled) =>
                          run(() => saveDripStep({ ...step, stageId: stage.id, subject: step.subject ?? "", enabled }))
                        }
                        onEdit={() => setEditing(step.id)}
                        onDelete={() => run(() => deleteDripStep(step.id))}
                      />
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        ) : editing === "new" ? null : (
          <p className="px-4 py-8 text-center text-[13px] text-[var(--color-muted)]">No messages in this stage yet.</p>
        )}

        <div className={cn((stage.steps.length > 0 || editing !== "new") && "border-t border-[var(--color-border)]")}>
          {editing === "new" ? (
            form(null)
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
              <Button variant="ghost" onClick={() => setEditing("new")}>
                + Add step
              </Button>
              {showTemplates ? (
                <div className="flex flex-wrap items-center gap-1.5 pr-2">
                  <span className="mr-1 text-xs text-[var(--color-faint)]">Templates</span>
                  {TEMPLATES.map((template) => (
                    <Button
                      key={template.key}
                      variant="secondary"
                      size="sm"
                      disabled={pending || (template.key === "review_request" && !reviewLinkSet)}
                      title={template.key === "review_request" && !reviewLinkSet ? "Add your review link in Settings first" : undefined}
                      onClick={() => run(() => addDripTemplate(stage.id, template.key))}
                    >
                      + {template.label}
                    </Button>
                  ))}
                  {!reviewLinkSet ? (
                    <Link href="/settings#reviews" className={cn("ml-1 text-xs", linkStyle)}>
                      Add review link
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
