"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/rpc";
import { connectQuo, disconnectQuo, listQuoLines, syncQuo } from "@/lib/actions/quo";
import { fmtRelativeTime } from "@/lib/format";
import { fmtHandle } from "@/lib/inbox-format";
import type { MessagingSettings, QuoLine } from "@/lib/messaging-types";
import { Button, Field, Input, Spinner, StatusText, cn } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const count = (value: number, noun: string) => `${value.toLocaleString("en-CA")} ${noun}${value === 1 ? "" : "s"}`;

/** Connecting Quo: paste an API key, pick the number texts come from, and
 * ServiceFlow adds its webhook in Quo and imports that number's texts. */
export function QuoSection({ settings }: { settings: MessagingSettings }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [lines, setLines] = useState<QuoLine[] | null>(null);
  const [lineId, setLineId] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const sync = settings.quoSync;
  const importing = sync?.status === "running";

  // Follow a running import, and catch up on coming back to the page, since
  // an import can be restarted or finish while it sits open.
  useEffect(() => {
    if (!importing) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [importing, router]);
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [router]);

  function run(action: () => Promise<ActionResult>, done?: () => void) {
    startTransition(async () => {
      setError("");
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Try again.");
        return;
      }
      done?.();
      router.refresh();
    });
  }

  function findLines(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      setError("");
      const result = await listQuoLines(apiKey.trim());
      if (!result.ok || !result.lines?.length) {
        setError(result.error ?? "This Quo account has no numbers.");
        return;
      }
      setLines(result.lines);
      setLineId(result.lines.length === 1 ? result.lines[0].id : "");
    });
  }

  function connect(event: FormEvent) {
    event.preventDefault();
    run(
      () => connectQuo({ apiKey: apiKey.trim(), phoneNumberId: lineId }),
      () => {
        setApiKey("");
        setLines(null);
      },
    );
  }

  const footer = (actions: React.ReactNode) => (
    <>
      <SaveStatus error={error} />
      <div className="ml-auto flex gap-2">{actions}</div>
    </>
  );

  if (settings.quoConnected) {
    const failed = sync?.status === "failed";
    const inInbox = `${count(sync?.texts ?? 0, "text")} and ${count(sync?.calls ?? 0, "call")} in the Inbox`;
    return (
      <SettingsSection
        id="quo"
        title="Quo"
        description="Texts and calls with customers, in the Inbox and on each deal."
        footer={footer(
          <>
            <Button variant="ghost" disabled={pending} onClick={() => run(disconnectQuo)}>
              Disconnect
            </Button>
            <Button variant="secondary" disabled={pending || importing} onClick={() => run(syncQuo)}>
              {failed ? "Try again" : "Sync now"}
            </Button>
          </>,
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[13px] font-medium text-[var(--color-heading)]">
            {settings.quoLineName ?? "Quo"}
            <span className="ml-2 font-normal tabular-nums text-[var(--color-muted)]">{fmtHandle(settings.quoFromNumber)}</span>
          </span>
          {importing ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text)]">
              <Spinner className="h-3 w-3 text-[var(--color-brand)]" />
              Importing texts and calls…
            </span>
          ) : (
            <StatusText tone={failed ? "bad" : "good"}>{failed ? "Import stopped" : "Connected"}</StatusText>
          )}
        </div>
        <p className={cn("mt-1 text-[13px]", failed ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]")}>
          {failed
            ? sync?.error
            : importing
              ? `${count(sync?.conversations ?? 0, "conversation")} so far · ${inInbox}`
              : [
                  inInbox,
                  sync?.finishedAt ? `synced ${fmtRelativeTime(sync.finishedAt)}` : null,
                  settings.lastTextReceivedAt ? `last text in ${fmtRelativeTime(settings.lastTextReceivedAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
        </p>
      </SettingsSection>
    );
  }

  if (lines) {
    return (
      <SettingsSection
        id="quo"
        title="Quo"
        description="Pick the number your texts come from. Its past conversations are imported into the Inbox."
        footer={footer(
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setLines(null)}>
              Back
            </Button>
            <Button type="submit" form="quo-line" disabled={pending || !lineId}>
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </>,
        )}
      >
        <form id="quo-line" onSubmit={connect}>
          <fieldset>
            <legend className="sr-only">Quo number</legend>
            <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
              {lines.map((line) => (
                <li key={line.id}>
                  <label
                    className={cn(
                      "flex h-11 cursor-pointer items-center gap-3 px-3 text-[13px] transition-colors",
                      lineId === line.id ? "bg-[var(--color-selected)]" : "hover:bg-[var(--color-row-hover)]",
                    )}
                  >
                    <input
                      type="radio"
                      name="quo-line"
                      value={line.id}
                      checked={lineId === line.id}
                      onChange={() => setLineId(line.id)}
                      className="accent-[var(--color-primary)]"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)]">
                      {line.name?.trim() || "Quo number"}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--color-muted)]">
                      {line.formattedNumber ?? fmtHandle(line.number)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </form>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      id="quo"
      title="Quo"
      description="Text customers from your Quo number and see your conversations in the Inbox and on each deal."
      footer={footer(
        <Button type="submit" form="quo-key" disabled={pending || !apiKey.trim()}>
          {pending ? "Checking…" : "Continue"}
        </Button>,
      )}
    >
      <form id="quo-key" onSubmit={findLines} className="sm:w-1/2 sm:pr-2">
        <Field label="Quo API key">
          <Input
            type="password"
            autoComplete="off"
            placeholder="Paste your key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Field>
        <p className="mt-1.5 text-xs text-[var(--color-muted)]">In Quo, open Settings › API and generate a key.</p>
      </form>
    </SettingsSection>
  );
}
