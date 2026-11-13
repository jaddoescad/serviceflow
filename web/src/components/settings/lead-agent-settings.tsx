"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAgentKey, revokeAgentKey, type LeadAgentSettings as Settings } from "@/lib/actions/lead-agent";
import { fmtRelativeTime } from "@/lib/format";
import { Button, Input, cn } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input aria-label={label} readOnly value={value} onFocus={(event) => event.target.select()} className="font-mono text-xs" />
      <Button
        type="button"
        variant="secondary"
        className="w-16"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/**
 * Settings › Integrations › AI lead agent: an outside agent (Grok Bot, Claude,
 * ChatGPT) connects to the MCP server with a key and texts new leads to book
 * estimates. Keys are shown once; turning one off stops it at once.
 */
export function LeadAgentSettings({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      setError("");
      const result = await createAgentKey("Lead agent");
      if (!result.ok || !result.key) setError(result.error ?? "Could not make a key.");
      else {
        setNewKey(result.key);
        router.refresh();
      }
    });
  }

  function revoke(id: string) {
    if (!window.confirm("Turn off this key? An agent using it stops working right away.")) return;
    startTransition(async () => {
      setError("");
      const result = await revokeAgentKey(id);
      if (!result.ok) setError(result.error ?? "Could not turn off the key.");
      router.refresh();
    });
  }

  return (
    <SettingsSection
      id="lead-agent"
      title="AI lead agent"
      description="An AI agent such as Grok Bot texts new leads from your Quo number and books estimates, only 8 AM–8 PM, never after STOP, and hands anything unclear to you."
      footer={
        <>
          <SaveStatus error={error} />
          <Button variant="secondary" className="ml-auto" disabled={pending} onClick={create}>
            {pending ? "Working…" : "New key"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-[var(--color-muted)]">MCP server URL</span>
          <CopyField label="MCP server URL" value={settings.serverUrl} />
        </div>

        {newKey ? (
          <div className="space-y-1.5 rounded-[var(--radius)] bg-[var(--color-brand-soft)] p-3">
            <span className="block text-xs font-medium text-[var(--color-heading)]">
              Your new key. Copy it now: it isn&apos;t shown again.
            </span>
            <CopyField label="New key" value={newKey} />
          </div>
        ) : null}

        {settings.keys.length ? (
          <ul className="-my-1 divide-y divide-[var(--color-border)]">
            {settings.keys.map((key) => (
              <li key={key.id} className={cn("flex min-h-10 items-center gap-3 py-1.5 text-[13px]", key.revokedAt && "opacity-60")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[var(--color-heading)]">
                    {key.name} <span className="font-mono text-xs font-normal text-[var(--color-muted)]">{key.prefix}…</span>
                  </span>
                  <span className="block truncate text-xs text-[var(--color-muted)]">
                    {key.revokedAt
                      ? `Turned off ${fmtRelativeTime(key.revokedAt)}`
                      : key.lastUsedAt
                        ? `Last used ${fmtRelativeTime(key.lastUsedAt)}`
                        : "Not used yet"}
                    {key.createdBy ? ` · made by ${key.createdBy}` : ""}
                  </span>
                </span>
                {key.revokedAt ? null : (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => revoke(key.id)}>
                    Turn off
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        <details className="text-[13px] text-[var(--color-text)]">
          <summary className="cursor-pointer font-medium text-[var(--color-heading)]">Connect Grok Bot</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--color-muted)]">
            <li>In Grok Bot, open Plugins and add a custom MCP server.</li>
            <li>Paste the MCP server URL above.</li>
            <li>
              Add the header <code className="font-mono text-xs">Authorization: Bearer</code> followed by your key.
            </li>
            <li>Attach the plugin to a Routine that runs when new leads come in.</li>
          </ol>
        </details>
      </div>
    </SettingsSection>
  );
}
