"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Badge, Button, Card, CardHeader, Field, Select } from "@/components/ui";
import { setFinancialSettlementState } from "@/lib/actions/financial-settlements";
import {
  manualSettlementOptions,
  type ManualSettlementKind,
  type ManualSettlementResolution,
  type SettlementBucket,
} from "@/lib/financial-settlement-status";

export function FinancialSettlementControl({
  transactionId,
  bucket,
  label,
  manualResolution,
}: {
  transactionId: string;
  bucket: SettlementBucket;
  label: string;
  manualResolution: ManualSettlementResolution | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<"needs_review" | ManualSettlementKind>(
    manualResolution?.kind ?? "needs_review",
  );
  const [note, setNote] = useState(manualResolution?.note ?? "");
  const [message, setMessage] = useState<string | null>(null);

  if (bucket === "fully_matched") {
    return (
      <Card className="overflow-hidden">
        <CardHeader
          title="Settlement state"
          subtitle="Fully matched is calculated from the linked accounting evidence and cannot be selected manually."
          right={<Badge tone="good">Fully matched</Badge>}
        />
      </Card>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await setFinancialSettlementState({
        transactionId,
        state,
        note,
      });
      if (!result.ok) {
        setMessage(result.error ?? "The settlement state could not be saved.");
        return;
      }
      setMessage("Saved.");
      router.refresh();
    });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Settlement state"
        subtitle="Keep it in review, or confirm a named exception with an audit note."
        right={
          <Badge tone={bucket === "custom" ? "neutral" : "warn"}>{label}</Badge>
        }
      />
      <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-[220px_1fr_auto] sm:items-end">
        <Field label="State">
          <Select
            value={state}
            onChange={(event) =>
              setState(
                event.target.value as "needs_review" | ManualSettlementKind,
              )
            }
            className="w-full"
          >
            <option value="needs_review">Needs review</option>
            {manualSettlementOptions.map((option) => (
              <option key={option.value} value={option.value}>
                Custom · {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={state === "needs_review" ? "Audit note (not required)" : "Why this is resolved"}>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={state === "needs_review"}
            maxLength={1000}
            placeholder={
              state === "needs_review"
                ? "Choose a custom state to add a resolution note."
                : "Record the evidence or business reason."
            }
            className="min-h-10 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </Field>
        <Button type="submit" size="sm" disabled={isPending} className="h-10">
          {isPending ? "Saving…" : "Save state"}
        </Button>
        {message ? (
          <p
            className={`text-xs sm:col-span-3 ${
              message === "Saved."
                ? "text-[var(--color-good)]"
                : "text-[var(--color-bad)]"
            }`}
          >
            {message}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

