"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  regenerateLeadIntakeToken,
  type LeadIntakeDelivery,
  type LeadIntakeSettings as Settings,
  type LeadIntakeSource,
} from "@/lib/actions/lead-intake";
import { fmtDateTime } from "@/lib/format";
import { Button, Input, Tag, type TagTone } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const SOURCES: { source: LeadIntakeSource; label: string; steps: string[] }[] = [
  {
    source: "zapier",
    label: "Zapier or Make",
    steps: [
      "Add a Webhooks by Zapier “POST” action (in Make, an HTTP “Make a request” module, method POST).",
      "Paste this URL. Send JSON or form data with name, email, phone, address, city, province, postal_code, service and notes.",
      "Optionally send source (for example Website or Yelp) to set the lead source.",
    ],
  },
  {
    source: "facebook",
    label: "Facebook Lead Ads",
    steps: [
      "In Zapier, use the Facebook Lead Ads “New Lead” trigger, then a Webhooks by Zapier “POST” action with this URL.",
      "Leave Data empty to send every field, or map full_name, email and phone_number. Form answers are added as a note.",
      "Leads come in with the source Meta Ads.",
    ],
  },
  {
    source: "google",
    label: "Google Ads lead forms",
    steps: [
      "In Google Ads, open the lead form asset › Export leads from Google Ads › Other data integration options.",
      "Paste this URL as the Webhook URL and the token after token= as the Key, then Send test data.",
      "Test data shows below as Test and adds no lead. Real leads come in with the source Google Ads.",
    ],
  },
];

const SOURCE_LABEL: Record<LeadIntakeSource, string> = { zapier: "Zapier / Make", facebook: "Facebook", google: "Google Ads" };

const STATUS: Record<LeadIntakeDelivery["status"], { tone: TagTone; label: string }> = {
  created: { tone: "green", label: "Added" },
  duplicate: { tone: "gray", label: "Duplicate" },
  test: { tone: "blue", label: "Test" },
  rejected: { tone: "red", label: "Rejected" },
};

function WebhookUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input aria-label="Webhook URL" readOnly value={url} onFocus={(event) => event.target.select()} className="font-mono text-xs" />
      <Button
        type="button"
        variant="secondary"
        className="w-16"
        onClick={() =>
          void navigator.clipboard.writeText(url).then(
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

/** Settings › Lead intake: webhook URLs per source, a token reset, and the last 20 deliveries. */
export function LeadIntakeSettings({ settings }: { settings: Settings }) {
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();

  function regenerate() {
    if (!window.confirm("Make a new URL? The current URLs stop working, so update Zapier, Make and Google Ads.")) return;
    startTransition(async () => {
      setStatus({});
      const result = await regenerateLeadIntakeToken();
      if (!result.ok || !result.endpoint) setStatus({ error: result.error ?? "Could not make a new URL." });
      else {
        setEndpoint(result.endpoint);
        setStatus({ message: "New URLs made." });
      }
    });
  }

  return (
    <SettingsSection
      id="lead-intake"
      title="Lead intake"
      description="Leads from these webhooks land in the first column of the sales pipeline. Anyone with a URL can add leads, so keep it private."
      footer={
        <>
          <SaveStatus error={status.error} message={status.message} />
          <Button variant="secondary" className="ml-auto" disabled={pending} onClick={regenerate}>
            {pending ? "Making…" : "New URL"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {SOURCES.map(({ source, label, steps }) => (
          <div key={source}>
            <div className="mb-1 text-[13px] font-medium text-[var(--color-heading)]">{label}</div>
            <WebhookUrl url={`${endpoint}&source=${source}`} />
            <details className="group mt-1.5 text-xs text-[var(--color-muted)]">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 hover:text-[var(--color-heading)] [&::-webkit-details-marker]:hidden">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-3 w-3 transition-transform group-open:rotate-90"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                How to connect
              </summary>
              <ol className="mt-1.5 list-decimal space-y-1 pl-8 leading-5">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </details>
          </div>
        ))}
      </div>

      <h3 className="mb-1 mt-6 text-[13px] font-semibold text-[var(--color-heading)]">Recent deliveries</h3>
      {settings.deliveries.length ? (
        <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {settings.deliveries.map((delivery) => (
            <li key={delivery.id} className="flex min-h-10 items-center gap-3 py-1.5 text-[13px]">
              <span className="w-28 shrink-0 tabular-nums text-xs text-[var(--color-muted)]">{fmtDateTime(delivery.receivedAt)}</span>
              <span className="min-w-0 flex-1 truncate">
                {delivery.leadId ? (
                  <Link
                    href={`/deals/${encodeURIComponent(delivery.leadId)}`}
                    className="font-medium text-[var(--color-heading)] hover:text-[var(--color-brand-strong)]"
                  >
                    {delivery.summary ?? "Lead"}
                  </Link>
                ) : (
                  <span className="text-[var(--color-text)]">{delivery.summary ?? "—"}</span>
                )}
                <span className="text-[var(--color-faint)]"> · {SOURCE_LABEL[delivery.source]}</span>
                {delivery.error ? <span className="text-[var(--color-muted)]"> · {delivery.error}</span> : null}
              </span>
              <Tag tone={STATUS[delivery.status].tone}>{STATUS[delivery.status].label}</Tag>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--color-muted)]">No leads received yet.</p>
      )}
    </SettingsSection>
  );
}
