"use client";

import { useState, useTransition } from "react";
import { cn } from "@/components/ui";
import { saveMessagePreferences } from "@/lib/actions/message-preferences";
import type { MessagePreferences, PreferenceChoice } from "@/lib/inbox-types";
import type { MessageChannel } from "@/lib/messaging-types";

const OPTIONS: { value: PreferenceChoice; label: string }[] = [
  { value: "none", label: "Send me everything" },
  { value: "drips", label: "Stop follow-up messages" },
  { value: "reminders", label: "Stop appointment reminders" },
  { value: "all", label: "Stop everything" },
];

const CHANNEL_LABELS: Record<MessageChannel, string> = { email: "Email", sms: "Text messages" };

export function PreferencesForm({ messageId, preferences }: { messageId: string; preferences: MessagePreferences }) {
  // The channel the link came from goes first.
  const channels = (["email", "sms"] as const)
    .filter((channel) => preferences[channel] !== null)
    .sort((a, b) => Number(b === preferences.channel) - Number(a === preferences.channel));
  const [choices, setChoices] = useState<Partial<Record<MessageChannel, PreferenceChoice>>>(() =>
    Object.fromEntries(channels.map((channel) => [channel, preferences[channel] ?? "none"])),
  );
  const [result, setResult] = useState<{ saved?: boolean; error?: string }>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-5 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        setResult({});
        startTransition(async () => {
          const outcome = await saveMessagePreferences(messageId, choices);
          setResult(outcome.error ? { error: outcome.error } : { saved: true });
        });
      }}
    >
      <div className="space-y-5">
        {channels.map((channel) => (
          <fieldset key={channel}>
            <legend className="mb-2 text-sm font-semibold text-[var(--color-heading)]">{CHANNEL_LABELS[channel]}</legend>
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              {OPTIONS.map((option) => {
                const checked = choices[channel] === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 border-b border-[var(--color-border)] px-4 text-sm last:border-b-0",
                      checked ? "bg-[#f8fafc] font-medium text-[var(--color-heading)]" : "text-[var(--color-text)] hover:bg-[var(--color-row-hover)]",
                    )}
                  >
                    <input
                      type="radio"
                      name={channel}
                      value={option.value}
                      checked={checked}
                      onChange={() => {
                        setResult({});
                        setChoices((current) => ({ ...current, [channel]: option.value }));
                      }}
                      className="h-4 w-4 accent-[#16a34a]"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between gap-3">
        <span
          role={result.error ? "alert" : result.saved ? "status" : undefined}
          className={cn("text-[13px]", result.error ? "text-[var(--color-bad)]" : "text-[var(--color-good)]")}
        >
          {result.error ?? (result.saved ? "Saved." : "")}
        </span>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[#16a34a] px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-[#15803d] focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}
