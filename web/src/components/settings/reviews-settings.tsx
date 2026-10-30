"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReviewSettings } from "@/lib/actions/messaging";
import type { ReviewSettings } from "@/lib/messaging-types";
import { linkStyle } from "@/components/pipeline-ui";
import { Button, Field, Input } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const days = (value: string) => (/^\d{1,3}$/.test(value.trim()) ? Number(value) : NaN);

/** The review link and the timing the Review request and Aftercare check-in drip templates use. */
export function ReviewsSettings({ settings }: { settings: ReviewSettings }) {
  const router = useRouter();
  const [link, setLink] = useState(settings.reviewLink ?? "");
  const [reviewDays, setReviewDays] = useState(String(settings.reviewDelayDays));
  const [aftercareDays, setAftercareDays] = useState(String(settings.aftercareDelayDays));
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const valid = [days(reviewDays), days(aftercareDays)].every((value) => value >= 0 && value <= 365);
  const changed =
    link.trim() !== (settings.reviewLink ?? "") ||
    days(reviewDays) !== settings.reviewDelayDays ||
    days(aftercareDays) !== settings.aftercareDelayDays;

  function save() {
    startTransition(async () => {
      setStatus({});
      const result = await saveReviewSettings({
        reviewLink: link.trim() || null,
        reviewDelayDays: days(reviewDays),
        aftercareDelayDays: days(aftercareDays),
      });
      if (!result.ok) {
        setStatus({ error: result.error ?? "Could not save." });
        return;
      }
      setStatus({ message: "Reviews saved." });
      router.refresh();
    });
  }

  return (
    <SettingsSection
      id="reviews"
      title="Reviews & aftercare"
      description={
        <>
          Used by the Review request and Aftercare check-in templates on a completed stage in{" "}
          <Link href="/drips?view=jobs" className={linkStyle}>
            Drips
          </Link>
          .
        </>
      }
      footer={
        <>
          <SaveStatus
            error={status.error ?? (valid ? undefined : "Choose between 0 and 365 days.")}
            message={status.message}
            hint="Timing applies to templates added after you save."
          />
          <Button type="button" className="ml-auto" disabled={pending || !changed || !valid} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Review link">
            <Input
              type="url"
              inputMode="url"
              placeholder="https://g.page/r/your-business/review"
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Ask for a review (days after completion)">
          <Input inputMode="numeric" value={reviewDays} onChange={(event) => setReviewDays(event.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Aftercare check-in (days after completion)">
          <Input
            inputMode="numeric"
            value={aftercareDays}
            onChange={(event) => setAftercareDays(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </div>
    </SettingsSection>
  );
}
