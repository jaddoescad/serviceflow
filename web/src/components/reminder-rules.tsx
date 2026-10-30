"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteReminderRule, saveReminderRule } from "@/lib/actions/reminders";
import type { ActionResult } from "@/lib/actions/rpc";
import { APPOINTMENT_KINDS, appointmentKindLabel, type AppointmentKind } from "@/lib/appointment-types";
import type { ReminderRule, ReminderTarget, ReminderTrigger } from "@/lib/reminder-types";
import {
  ChannelField,
  DelayField,
  MessageFields,
  MessageForm,
  MessageRow,
  delayLabel,
  useDelay,
  type MessageDraft,
} from "./drips-editor";
import { Button, Card, CardHeader, Field, Select, cn } from "./ui";

const GROUPS: { target: ReminderTarget; title: string; empty: string }[] = [
  { target: "appointment", title: "Appointments", empty: "No appointment confirmations or reminders yet." },
  { target: "job", title: "Job schedule", empty: "No job confirmations or reminders yet." },
];

const TRIGGERS: { value: ReminderTrigger; label: string }[] = [
  { value: "confirmation", label: "Confirmation — when scheduled or rescheduled" },
  { value: "reminder", label: "Reminder — before it starts" },
];

// The database allows reminders up to 30 days ahead.
const MAX_OFFSET = 30 * 1440;

/** What a message for `target` can fill in; only confirmations know whether it moved. */
function placeholders(target: ReminderTarget, trigger: ReminderTrigger): string[] {
  const when =
    target === "appointment" ? ["{{appointment_type}}", "{{date}}", "{{time}}"] : ["{{date}}", "{{end_date}}"];
  return [
    "{{first_name}}",
    "{{company}}",
    ...when,
    ...(trigger === "confirmation" ? ["{{scheduled_or_rescheduled}}"] : []),
  ];
}

/** A starting message for a new rule, so the office edits rather than writes from scratch. */
function defaultMessage(target: ReminderTarget, trigger: ReminderTrigger): { subject: string; body: string } {
  if (target === "appointment") {
    return trigger === "confirmation"
      ? {
          subject: "Your {{appointment_type}} is {{scheduled_or_rescheduled}}",
          body: "Hi {{first_name}}, your {{appointment_type}} with {{company}} is {{scheduled_or_rescheduled}} for {{date}} at {{time}}.",
        }
      : {
          subject: "Reminder: your {{appointment_type}} on {{date}}",
          body: "Hi {{first_name}}, a reminder that your {{appointment_type}} with {{company}} is on {{date}} at {{time}}.",
        };
  }
  return trigger === "confirmation"
    ? {
        subject: "Your project is {{scheduled_or_rescheduled}}",
        body: "Hi {{first_name}}, your project with {{company}} is {{scheduled_or_rescheduled}} to start {{date}}.",
      }
    : {
        subject: "Reminder: your project starts {{date}}",
        body: "Hi {{first_name}}, a reminder that {{company}} starts your project on {{date}}.",
      };
}

function describe(rule: ReminderRule): string {
  const when = rule.trigger === "confirmation" ? "When scheduled or rescheduled" : `${delayLabel(rule.offsetMinutes)} before`;
  if (rule.target === "job") return when;
  return `${when} · ${rule.appointmentKind ? appointmentKindLabel(rule.appointmentKind) : "All types"}`;
}

function RuleForm({
  target,
  rule,
  defaultTrigger,
  quoConnected,
  onDone,
}: {
  target: ReminderTarget;
  rule: ReminderRule | null;
  defaultTrigger: ReminderTrigger;
  quoConnected: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [trigger, setTrigger] = useState<ReminderTrigger>(rule?.trigger ?? defaultTrigger);
  const delay = useDelay(rule?.trigger === "reminder" ? rule.offsetMinutes : 1440);
  const [kind, setKind] = useState<AppointmentKind | "">(rule?.appointmentKind ?? "");
  const [message, setMessage] = useState<MessageDraft>({
    channel: rule?.channel ?? "email",
    ...(rule ? { subject: rule.subject ?? "", body: rule.body } : defaultMessage(target, defaultTrigger)),
  });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <MessageForm
      pending={pending}
      error={error}
      saveLabel="Save"
      onCancel={onDone}
      onSubmit={() =>
        startTransition(async () => {
          setError("");
          if (trigger === "reminder" && delay.minutes > MAX_OFFSET) {
            setError("Reminders can go out up to 30 days before.");
            return;
          }
          const result = await saveReminderRule({
            id: rule?.id ?? crypto.randomUUID(),
            target,
            appointmentKind: kind || null,
            trigger,
            offsetMinutes: trigger === "reminder" ? delay.minutes : 0,
            channel: message.channel,
            subject: message.channel === "email" ? message.subject : "",
            body: message.body,
            enabled: rule?.enabled ?? true,
          });
          if (!result.ok) {
            setError(result.error ?? "Could not save the message.");
            return;
          }
          router.refresh();
          onDone();
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send">
          <Select
            value={trigger}
            onChange={(event) => {
              const next = event.target.value as ReminderTrigger;
              // An untouched starting message follows the choice.
              const previous = defaultMessage(target, trigger);
              if (message.subject === previous.subject && message.body === previous.body) {
                setMessage((current) => ({ ...current, ...defaultMessage(target, next) }));
              }
              setTrigger(next);
            }}
            className="w-full"
          >
            {TRIGGERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {trigger === "reminder" ? <DelayField label="Before" delay={delay} /> : null}
        {target === "appointment" ? (
          <Field label="Appointment type">
            <Select value={kind} onChange={(event) => setKind(event.target.value as AppointmentKind | "")} className="w-full">
              <option value="">All types</option>
              {APPOINTMENT_KINDS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <ChannelField value={message.channel} onChange={(channel) => setMessage((current) => ({ ...current, channel }))} />
      </div>
      <MessageFields
        message={message}
        onChange={(next) => setMessage((current) => ({ ...current, ...next }))}
        quoConnected={quoConnected}
        placeholders={placeholders(target, trigger)}
      />
    </MessageForm>
  );
}

/** Confirmations and reminders timed off an appointment's or a job's start, one panel per kind of booking. */
export function ReminderRules({ rules, quoConnected }: { rules: ReminderRule[]; quoConnected: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      setError("");
      const result = await action();
      if (!result.ok) setError(result.error ?? "Could not update reminders.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-[13px] text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
      {GROUPS.map((group) => {
        const list = rules.filter((rule) => rule.target === group.target);
        const adding = editing === `new-${group.target}`;
        const form = (rule: ReminderRule | null) => (
          <RuleForm
            target={group.target}
            rule={rule}
            defaultTrigger={list.some((item) => item.trigger === "confirmation") ? "reminder" : "confirmation"}
            quoConnected={quoConnected}
            onDone={() => setEditing(null)}
          />
        );
        return (
          <Card key={group.target} className="overflow-hidden">
            <CardHeader title={group.title} />
            {list.length ? (
              <ol className="divide-y divide-[var(--color-border)]">
                {list.map((rule) => (
                  <li key={rule.id}>
                    {editing === rule.id ? (
                      form(rule)
                    ) : (
                      <MessageRow
                        message={rule}
                        when={describe(rule)}
                        enabled={rule.enabled}
                        pending={pending}
                        onToggle={(enabled) => run(() => saveReminderRule({ ...rule, subject: rule.subject ?? "", enabled }))}
                        onEdit={() => setEditing(rule.id)}
                        onDelete={() => run(() => deleteReminderRule(rule.id))}
                      />
                    )}
                  </li>
                ))}
              </ol>
            ) : adding ? null : (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--color-muted)]">{group.empty}</p>
            )}
            <div className={cn((list.length > 0 || !adding) && "border-t border-[var(--color-border)]")}>
              {adding ? (
                form(null)
              ) : (
                <div className="px-2 py-1.5">
                  <Button variant="ghost" onClick={() => setEditing(`new-${group.target}`)}>
                    + Add message
                  </Button>
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
