"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReplyToEmail } from "@/lib/actions/messaging";
import { fmtRelativeTime } from "@/lib/format";
import type { MessagingSettings } from "@/lib/messaging-types";
import { Button, Field, Input } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

/** Where customers' replies to emails go, and whether they reach the Inbox. */
export function EmailSettingsFields({
  settings,
  inboundEmailDomain,
}: {
  settings: MessagingSettings;
  inboundEmailDomain: string | null;
}) {
  const router = useRouter();
  const [replyTo, setReplyTo] = useState(settings.replyToEmail ?? "");
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const changed = replyTo.trim() !== (settings.replyToEmail ?? "");

  function save() {
    startTransition(async () => {
      setStatus({});
      const result = await saveReplyToEmail(replyTo);
      if (!result.ok) {
        setStatus({ error: result.error ?? "Could not save." });
        return;
      }
      setStatus({ message: "Saved." });
      router.refresh();
    });
  }

  return (
    <SettingsSection
      id="email"
      title="Email"
      description={
        inboundEmailDomain
          ? `Customers’ replies to your emails land in the Inbox${
              settings.lastEmailReceivedAt ? ` · last reply ${fmtRelativeTime(settings.lastEmailReceivedAt)}` : ""
            }.`
          : "Customers’ replies to your emails go to the address below."
      }
      footer={
        <>
          <SaveStatus error={status.error} message={status.message} />
          <Button type="button" className="ml-auto" disabled={pending || !changed} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="sm:w-1/2 sm:pr-2">
        <Field label="Customer replies to emails go to">
          <Input
            type="email"
            placeholder="office@yourcompany.com"
            value={replyTo}
            onChange={(event) => setReplyTo(event.target.value)}
          />
        </Field>
      </div>
    </SettingsSection>
  );
}
