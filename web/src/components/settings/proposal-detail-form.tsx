"use client";

import { useState, useTransition } from "react";
import { saveProposalDetail } from "@/lib/actions/settings";
import type { ProposalPage } from "@/lib/proposal-types";
import { Button, Input, Textarea } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const DETAILS = {
  terms: {
    title: "Proposal terms and conditions",
    description: "Shown at the end of every proposal that has no terms of its own.",
    maxLength: 20000,
  },
  license: {
    title: "Licence or registration number",
    description: "Shown under your company name on proposals, change orders and invoices.",
    maxLength: 80,
  },
  taxRatePercent: {
    title: "Sales tax",
    description: "The tax percent added to new proposals, change orders and invoices. Ones already made keep their rate.",
    maxLength: 6,
  },
};

/**
 * One company-wide detail that customer documents print (the default terms,
 * the licence number). The proposal page shows it locked; it is changed here.
 */
export function ProposalDetailForm({
  field,
  page,
  canManage,
}: {
  field: keyof typeof DETAILS;
  page: ProposalPage;
  canManage: boolean;
}) {
  const detail = DETAILS[field];
  const [value, setValue] = useState(String(page[field]));
  const [saved, setSaved] = useState(String(page[field]));
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const Control = field === "terms" ? Textarea : Input;

  function save() {
    startTransition(async () => {
      const result =
        field === "taxRatePercent"
          ? await saveProposalDetail(field, value.trim() ? Number(value) : NaN)
          : await saveProposalDetail(field, value);
      if (!result.ok) {
        setStatus({ error: result.error ?? "Could not save." });
        return;
      }
      setSaved(value);
      setStatus({ message: "Saved." });
    });
  }

  return (
    <SettingsSection
      id={`proposal-${field}`}
      title={detail.title}
      description={detail.description}
      footer={
        canManage ? (
          <>
            <SaveStatus error={status.error} message={status.message} />
            <Button className="ml-auto" disabled={pending || value === saved} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <span>Only managers can change this.</span>
        )
      }
    >
      <Control
        aria-label={detail.title}
        {...(field === "terms"
          ? { rows: 10 }
          : field === "taxRatePercent"
            ? { className: "max-w-24", inputMode: "decimal" as const }
            : { className: "max-w-sm" })}
        value={value}
        maxLength={detail.maxLength}
        disabled={!canManage || pending}
        onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          setValue(event.target.value);
          setStatus({});
        }}
      />
    </SettingsSection>
  );
}
