"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getDealDrips, setDealDripsPaused, skipQueuedMessage } from "@/lib/actions/messaging";
import { fmtDateTime } from "@/lib/format";
import type { DealDrips as DealDripsData } from "@/lib/messaging-types";
import { ChatIcon, MailIcon, Switch } from "./pipeline-ui";
import { Button } from "./ui";

/** The deal page's Drips block: what is queued and when, pause/resume, and skipping one message.
 * It loads its own list, and again after each change here or when the deal changes stage. */
export function DealDrips({
  recordId,
  stageId,
  noun,
  paused,
  onPausedChange,
}: {
  recordId: string;
  stageId: string | null;
  noun: string;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<DealDripsData | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getDealDrips(recordId)
      .catch(() => null)
      .then((next) => {
        if (live) setData(next);
      });
    return () => {
      live = false;
    };
  }, [recordId, stageId, reload]);

  function setPaused(next: boolean) {
    onPausedChange(next);
    setError("");
    startTransition(async () => {
      const result = await setDealDripsPaused(recordId, next).catch(() => ({ ok: false, error: undefined }));
      if (!result.ok) {
        onPausedChange(!next);
        setError(result.error ?? "Could not update drips. Try again.");
      }
      setReload((count) => count + 1);
      router.refresh();
    });
  }

  function skip(messageId: string) {
    setError("");
    startTransition(async () => {
      const result = await skipQueuedMessage(messageId).catch(() => ({ ok: false, error: undefined }));
      if (!result.ok) setError(result.error ?? "Could not skip the message. Try again.");
      setReload((count) => count + 1);
      router.refresh();
    });
  }

  return (
    <section className="mt-6" aria-labelledby="deal-drips-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="deal-drips-title" className="text-sm font-semibold text-[var(--color-heading)]">
          Drips
        </h2>
        <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          {paused ? "Paused" : "On"}
          <Switch label={`Drips for this ${noun}`} checked={!paused} disabled={pending} onChange={(on) => setPaused(!on)} />
        </label>
      </div>
      <div className="mt-1.5 text-[13px]">
        {paused ? (
          <p className="text-[var(--color-muted)]">Paused for this {noun}. Turning drips back on re-queues what is still ahead.</p>
        ) : !data ? (
          <p className="text-[var(--color-faint)]">Loading…</p>
        ) : data.upcoming.length ? (
          <ol aria-label="Queued drips" className="-mx-2">
            {data.upcoming.map((message) => (
              <li
                key={message.id}
                className="group flex items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-[var(--color-hover)]"
              >
                <span className="mt-0.5 text-[var(--color-muted)]" title={message.channel === "email" ? "Email" : "Text"}>
                  {message.channel === "email" ? <MailIcon /> : <ChatIcon />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--color-heading)]">{message.subject || message.body}</span>
                  <span className="block text-xs tabular-nums text-[var(--color-muted)]">{fmtDateTime(message.scheduledFor)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => skip(message.id)}
                  className="-my-0.5 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                >
                  Skip
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[var(--color-muted)]">
            {data.stage && !data.stage.dripsEnabled ? `Drips are off in ${data.stage.name}.` : "No drips queued."}
          </p>
        )}
        {error ? (
          <p role="alert" className="mt-1.5 text-xs text-[var(--tag-red-text)]">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
