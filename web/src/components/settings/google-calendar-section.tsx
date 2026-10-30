"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import {
  disconnectMyCalendar,
  setMyCalendarSync,
  type CalendarConnection,
} from "@/lib/actions/calendar";
import { Button, StatusText, buttonClassName } from "@/components/ui";
import { Switch } from "@/components/pipeline-ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const CONNECT_URL = "/api/google-calendar/connect";

const STATUS: Record<"connected" | "error" | "disconnecting", { tone: "good" | "bad" | "neutral"; text: string }> = {
  connected: { tone: "good", text: "Connected" },
  error: { tone: "bad", text: "Not syncing" },
  disconnecting: { tone: "neutral", text: "Disconnecting…" },
};

export function GoogleCalendarSection({
  connection,
  configured,
  result,
}: {
  connection: CalendarConnection;
  /** GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. */
  configured: boolean;
  /** Outcome passed back by the OAuth callback. */
  result: "connected" | "error" | null;
}) {
  const [status, setStatus] = useState<{ error?: string; message?: string }>(
    result === "connected"
      ? { message: "Google Calendar connected." }
      : result === "error"
        ? { error: "Google Calendar wasn't connected. Try again." }
        : {},
  );
  const [pending, startTransition] = useTransition();
  const saved = connection.connected
    ? { appointments: connection.syncAppointments, jobs: connection.syncJobs }
    : { appointments: false, jobs: false };
  const [sync, setOptimisticSync] = useOptimistic(saved);

  // Drop the one-time ?calendar= flag so a reload doesn't repeat it.
  useEffect(() => {
    if (result) window.history.replaceState(null, "", "/settings#calendar");
  }, [result]);

  function toggle(next: { appointments: boolean; jobs: boolean }) {
    startTransition(async () => {
      setOptimisticSync(next);
      setStatus({});
      const outcome = await setMyCalendarSync(next);
      if (!outcome.ok) setStatus({ error: outcome.error ?? "Could not save." });
    });
  }

  function disconnect() {
    startTransition(async () => {
      setStatus({});
      const outcome = await disconnectMyCalendar();
      if (!outcome.ok) setStatus({ error: outcome.error ?? "Could not disconnect." });
    });
  }

  const connect = (label: string, variant: "primary" | "secondary") =>
    configured ? (
      <a href={CONNECT_URL} className={buttonClassName({ variant })}>
        {label}
      </a>
    ) : (
      <Button variant={variant} disabled>
        {label}
      </Button>
    );

  return (
    <SettingsSection
      id="calendar"
      title="Google Calendar"
      description="Puts your appointments, and the job schedule if you choose, on your own Google Calendar."
      footer={
        <>
          <SaveStatus error={status.error} message={status.message} />
          <div className="ml-auto flex gap-2">
            {!connection.connected ? (
              connect("Connect Google Calendar", "primary")
            ) : connection.status === "disconnecting" ? null : (
              <>
                {connection.status === "error" ? connect("Reconnect", "secondary") : null}
                <Button variant="ghost" disabled={pending} onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            )}
          </div>
        </>
      }
    >
      {!connection.connected ? (
        <p className="text-[13px] text-[var(--color-muted)]">
          {configured ? "Not connected." : "Google Calendar isn't set up yet."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-[var(--color-heading)]">
              {connection.googleEmail ?? "Google account"}
            </span>
            <StatusText tone={STATUS[connection.status].tone}>{STATUS[connection.status].text}</StatusText>
          </div>
          {connection.lastError ? (
            <p className="mt-1 text-[13px] text-[var(--color-bad)]">{connection.lastError}</p>
          ) : null}
          {connection.status !== "disconnecting" ? (
            <ul className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              {(
                [
                  ["appointments", "My appointments"],
                  ["jobs", "Job schedule"],
                ] as const
              ).map(([key, label]) => (
                <li key={key} className="flex h-10 items-center justify-between gap-3 text-[13px] text-[var(--color-text)]">
                  {label}
                  <Switch
                    label={label}
                    checked={sync[key]}
                    disabled={pending}
                    onChange={(checked) => toggle({ ...sync, [key]: checked })}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}
