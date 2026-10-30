"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePaymentSettings } from "@/lib/actions/billing";
import type { PaymentSettings } from "@/lib/billing-types";
import { Switch } from "@/components/pipeline-ui";
import { Button, Field, Input } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

/** Customers pay invoices and deposits by card through the company's own Stripe account. */
export function PaymentsSettings({ settings }: { settings: PaymentSettings }) {
  const router = useRouter();
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [acceptCards, setAcceptCards] = useState(settings.acceptCards);
  const [fee, setFee] = useState(String(settings.cardFeePercent));
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const disabled = pending || !settings.canEdit;
  const feeNumber = Number(fee);
  const feeValid = fee.trim() !== "" && Number.isFinite(feeNumber) && feeNumber >= 0 && feeNumber <= 10;
  const keysReady =
    (settings.keyConnected || secretKey.trim() !== "") && (settings.webhookConnected || webhookSecret.trim() !== "");
  const changed =
    secretKey.trim() !== "" ||
    webhookSecret.trim() !== "" ||
    acceptCards !== settings.acceptCards ||
    (feeValid && feeNumber !== settings.cardFeePercent);

  function save(disconnect = false) {
    startTransition(async () => {
      setStatus({});
      const result = await savePaymentSettings({
        secretKey: disconnect ? "" : secretKey.trim() || null,
        webhookSecret: disconnect ? "" : webhookSecret.trim() || null,
        acceptCards: disconnect ? false : acceptCards,
        cardFeePercent: feeValid ? feeNumber : settings.cardFeePercent,
      });
      if (!result.ok) {
        setStatus({ error: result.error ?? "Could not save." });
        return;
      }
      setSecretKey("");
      setWebhookSecret("");
      if (disconnect) setAcceptCards(false);
      setStatus({ message: disconnect ? "Stripe disconnected." : "Payments saved." });
      router.refresh();
    });
  }

  const connection = settings.keyConnected
    ? `Connected · ${settings.testMode ? "test key" : "key"} ends ${settings.keyEnding}`
    : "Not connected";

  return (
    <SettingsSection
      id="payments"
      title="Online payments"
      description="Customers pay invoices and deposits by card through your own Stripe account."
      footer={
        <>
          <SaveStatus
            error={status.error}
            message={status.message}
            hint={
              !settings.canEdit
                ? `${connection}. Only owners and admins can change payments.`
                : !settings.serverReady
                  ? `${connection}. The server also needs SUPABASE_SERVICE_ROLE_KEY before customers can pay.`
                  : connection
            }
          />
          <div className="ml-auto flex gap-2">
            {settings.keyConnected && settings.canEdit ? (
              <Button type="button" variant="ghost" disabled={disabled} onClick={() => save(true)}>
                Disconnect Stripe
              </Button>
            ) : null}
            <Button type="button" disabled={disabled || !changed || !feeValid} onClick={() => save()}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stripe secret key">
          <Input
            type="password"
            autoComplete="off"
            disabled={disabled}
            placeholder={settings.keyConnected ? "Leave blank to keep the saved key" : "sk_live_… or rk_live_…"}
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
          />
        </Field>
        <Field label="Webhook signing secret">
          <Input
            type="password"
            autoComplete="off"
            disabled={disabled}
            placeholder={
              settings.webhookConnected ? `Saved · ends ${settings.webhookEnding}. Leave blank to keep it` : "whsec_…"
            }
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Webhook endpoint">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={settings.webhookUrl}
                onFocus={(event) => event.target.select()}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() =>
                  void navigator.clipboard.writeText(settings.webhookUrl).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  )
                }
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </Field>
          <p className="mt-1.5 text-xs text-[var(--color-muted)]">
            In Stripe › Developers › Webhooks, add this endpoint for checkout.session.completed and
            checkout.session.async_payment_succeeded, then paste its signing secret above.
          </p>
        </div>
        <Field label="Card fee passed to the customer">
          <div className="relative">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={10}
              step={0.1}
              disabled={disabled}
              value={fee}
              onChange={(event) => setFee(event.target.value)}
              className="pr-8 tabular-nums"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--color-muted)]">
              %
            </span>
          </div>
        </Field>
        <div className="flex items-end">
          <label className="flex h-8 items-center gap-2.5 text-[13px] text-[var(--color-text)]">
            <Switch
              label="Accept card payments"
              checked={acceptCards}
              disabled={disabled || (!acceptCards && !keysReady)}
              onChange={setAcceptCards}
            />
            Accept card payments
          </label>
        </div>
      </div>
    </SettingsSection>
  );
}
