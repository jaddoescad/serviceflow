"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCompanyProfile, type CompanyProfile } from "@/lib/actions/settings";
import { Button, Field, Input, Select } from "@/components/ui";
import { Detail, SaveStatus, SettingsSection, TRADES } from "./settings-section";

// Fixed names: Intl's long names differ between Node and browsers, which
// breaks hydration.
const TIME_ZONE_NAMES: Record<string, string> = {
  "America/St_Johns": "Newfoundland Time",
  "America/Halifax": "Atlantic Time",
  "America/Toronto": "Eastern Time",
  "America/New_York": "Eastern Time",
  "America/Winnipeg": "Central Time",
  "America/Chicago": "Central Time",
  "America/Regina": "Saskatchewan Time",
  "America/Edmonton": "Mountain Time",
  "America/Denver": "Mountain Time",
  "America/Vancouver": "Pacific Time",
  "America/Los_Angeles": "Pacific Time",
};

function timeZoneLabel(timezone: string) {
  const name = TIME_ZONE_NAMES[timezone];
  return name ? `${name} (${timezone})` : timezone;
}

export function CompanyProfileForm({
  company,
  canEdit,
}: {
  company: CompanyProfile;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(company);
  const [name, setName] = useState(company.name);
  const [trade, setTrade] = useState(company.trade ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [address, setAddress] = useState(company.address ?? "");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const changed =
    name.trim() !== saved.name ||
    (trade || null) !== saved.trade ||
    phone.trim() !== (saved.phone ?? "") ||
    address.trim() !== (saved.address ?? "");
  const disabled = !canEdit || pending;

  function edit(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      setError("");
      setMessage("");
    };
  }

  function save() {
    startTransition(async () => {
      const result = await saveCompanyProfile({ name, trade: trade || null, phone, address });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(result.settings.company);
      setMessage("Company details saved.");
      router.refresh();
    });
  }

  return (
    <SettingsSection
      id="company"
      title="Company"
      description="Your business details. They identify your company to your team."
      footer={
        canEdit ? (
          <>
            <SaveStatus error={error} message={message} hint="Shown to your team across ServiceFlow." />
            <Button className="ml-auto" onClick={save} disabled={pending || !changed || !name.trim()}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <span>Only owners and admins can change company details.</span>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name">
          <Input value={name} maxLength={120} disabled={disabled} onChange={(e) => edit(setName)(e.target.value)} />
        </Field>
        <Field label="Trade">
          <Select value={trade} disabled={disabled} onChange={(e) => edit(setTrade)(e.target.value)} className="w-full">
            <option value="">Not set</option>
            {TRADES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phone">
          <Input
            type="tel"
            value={phone}
            maxLength={40}
            placeholder="613-555-0100"
            disabled={disabled}
            onChange={(e) => edit(setPhone)(e.target.value)}
          />
        </Field>
        <Field label="Business address">
          <Input
            value={address}
            maxLength={300}
            placeholder="Street, city, province"
            disabled={disabled}
            onChange={(e) => edit(setAddress)(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-5 border-t border-[var(--color-border)] pt-5">
        <Detail label="Time zone">
          {timeZoneLabel(saved.timezone)}
          <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
            Clock-ins, timesheets and reminders use this time zone.
          </span>
        </Detail>
      </div>
    </SettingsSection>
  );
}
