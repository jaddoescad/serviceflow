"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closeChangeOrder,
  closeInvoice,
  deleteInvoicePayment,
  recordInvoicePayment,
  saveChangeOrder,
  saveInvoice,
} from "@/lib/actions/billing";
import {
  CHANGE_ORDER_STATUS,
  INVOICE_KIND_LABELS,
  INVOICE_STATUS,
  PAYMENT_METHOD_LABELS,
  type BillingBody,
  type ChangeOrder,
  type Invoice,
  type InvoiceKind,
  type PaymentMethod,
} from "@/lib/billing-types";
import type { DocumentExtras } from "@/lib/documents";
import { fmtDate } from "@/lib/format";
import { centsFromDollars, fmtCents, type CatalogItem } from "@/lib/line-items";
import {
  ActivityPanel,
  DocumentTotals,
  EditorColumns,
  EditorHeader,
  LineItemsEditor,
  PROPERTY_CONTROL,
  PropertyRow,
  RailPanel,
  TotalRow,
  useDraft,
} from "./line-items-editor";
import { DocumentAttachments } from "./document-attachments";
import { ConfirmDialog, DialogFooter, SendDocumentDialog } from "./document-dialogs";
import { ProjectModal } from "./project-profile-panel";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "./ui";

function PaymentDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState((invoice.balanceCents / 100).toFixed(2));
  const [paidOn, setPaidOn] = useState(new Date().toLocaleDateString("en-CA"));
  const [method, setMethod] = useState<PaymentMethod>("e-transfer");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <ProjectModal title={`Record payment · Invoice #${invoice.number}`} onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            setError("");
            const result = await recordInvoicePayment({
              invoiceId: invoice.id,
              amountCents: centsFromDollars(amount),
              paidOn,
              method,
              reference,
            });
            if (!result.ok) {
              setError(result.error ?? "Could not record the payment.");
              return;
            }
            router.refresh();
            onClose();
          });
        }}
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Amount">
            <Input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="Date received">
            <Input required type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)} className="w-full">
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_METHOD_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference">
            <Input maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} />
          </Field>
          {error ? (
            <p role="alert" className="text-[13px] text-[var(--color-bad)] sm:col-span-2">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="subtle" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </form>
    </ProjectModal>
  );
}

/** Whether the customer can pay this invoice by card from their link, and the link to share. */
function OnlinePaymentPanel({
  invoice,
  online,
  token,
}: {
  invoice: Invoice;
  online: NonNullable<Invoice["online"]>;
  token: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const payable = !online.locked && invoice.status !== "void" && invoice.status !== "draft" && invoice.balanceCents > 0;
  const state = online.locked
    ? "Off · job locked by the June 1, 2026 cutoff"
    : invoice.status === "void"
      ? "Off · void"
      : invoice.balanceCents <= 0
        ? "Paid"
        : invoice.status === "draft"
          ? "Once sent"
          : `On${online.feePercent ? ` · ${online.feePercent}% card fee` : ""}`;
  return (
    <RailPanel title="Online payments">
      <dl>
        <PropertyRow label="Card payments">
          <span className="text-[var(--color-text)]">{state}</span>
        </PropertyRow>
      </dl>
      {payable && token ? (
        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="mt-2 w-full"
          onClick={() =>
            void navigator.clipboard
              .writeText(`${window.location.origin}/i/${token}`)
              .then(() => setCopied(true), () => setCopied(false))
          }
        >
          {copied ? "Pay link copied" : "Copy pay link"}
        </Button>
      ) : null}
    </RailPanel>
  );
}

export function BillingEditor({
  kind,
  id,
  jobId,
  isNew,
  initial,
  changeOrder,
  invoice,
  catalog = [],
  extras = null,
  backHref,
  backLabel,
}: {
  kind: "change_order" | "invoice";
  id: string;
  jobId: string;
  isNew: boolean;
  initial: BillingBody;
  changeOrder?: ChangeOrder | null;
  invoice?: Invoice | null;
  catalog?: CatalogItem[];
  /** A saved document's attachments and latest delivery. */
  extras?: DocumentExtras | null;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const { body, patch, dirty, markSaved } = useDraft(initial, isNew);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"send" | "close" | "payment" | null>(null);
  const [saving, startSave] = useTransition();
  const [pending, startTransition] = useTransition();
  const busy = saving || pending;
  const isInvoice = kind === "invoice";
  const noun = isInvoice ? "invoice" : "change order";
  const record = isInvoice ? invoice : changeOrder;
  const status = record?.status;
  const readOnly = isInvoice ? status === "void" : status === "accepted" || status === "cancelled";
  const publicPath = isInvoice ? "/i" : "/co";
  const token = record?.publicToken ?? null;
  // A sent change order or any sent invoice already has a link to share.
  const linkReady = !!token && (isInvoice ? status !== "draft" : status === "sent");
  // Unsent documents are deleted; sent ones are voided or cancelled.
  const closeAction = status === "draft" ? "delete" : isInvoice ? "void" : "cancel";
  const close = {
    delete: { title: `Delete ${noun}`, message: `Delete “${body.name}”? This can’t be undone.`, label: "Delete" },
    void: {
      title: "Void invoice",
      message: "Void this invoice? The customer link will show it as void and it won’t count toward totals.",
      label: "Void",
    },
    cancel: {
      title: "Cancel change order",
      message: "Cancel this change order? The customer can no longer accept it.",
      label: "Cancel order",
    },
  }[closeAction];

  async function save(): Promise<boolean> {
    setError("");
    const saved = body;
    const result = isInvoice
      ? await saveInvoice({ id, jobId, body: saved })
      : await saveChangeOrder({ id, jobId, body: saved });
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return false;
    }
    markSaved(saved);
    if (isNew) router.replace(`/jobs/${encodeURIComponent(jobId)}/${isInvoice ? "invoices" : "change-orders"}/${id}`);
    router.refresh();
    return true;
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, fallback: string, onDone?: () => void) {
    startTransition(async () => {
      setError("");
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? fallback);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <EditorHeader
        backHref={backHref}
        backLabel={backLabel}
        number={invoice ? `#${invoice.number}` : changeOrder ? `CO #${changeOrder.number}` : null}
        name={body.name}
        placeholder={isInvoice ? "Invoice name" : "Change order name"}
        onNameChange={(name) => patch({ name })}
        readOnly={readOnly}
        status={invoice ? INVOICE_STATUS[invoice.status] : changeOrder ? CHANGE_ORDER_STATUS[changeOrder.status] : null}
        delivery={extras?.delivery}
        customerHref={token && status !== "draft" ? `${publicPath}/${token}` : null}
        actions={
          <>
            {!isNew && !readOnly && !invoice?.payments.length ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDialog("close")}>
                {close.label}
              </Button>
            ) : null}
            {invoice && !readOnly && invoice.balanceCents > 0 ? (
              <Button type="button" variant="subtle" disabled={busy || dirty} onClick={() => setDialog("payment")}>
                Record payment
              </Button>
            ) : null}
          </>
        }
        primaryAction={
          !isNew && !readOnly ? (
            <Button type="button" disabled={busy} onClick={() => setDialog("send")}>
              {status === "draft" || status === "declined" ? "Send" : "Resend"}
            </Button>
          ) : null
        }
        save={{ dirty, saving, disabled: busy, onSave: () => startSave(async () => void (await save())) }}
        error={error}
      />

      <EditorColumns
        main={
          <LineItemsEditor
            items={body.items}
            onChange={(items) => patch({ items })}
            readOnly={readOnly}
            allowOptional={!isInvoice}
            catalog={catalog}
          />
        }
        rail={
          <>
            {isInvoice ? (
              <RailPanel title="Details">
                <dl>
                  <PropertyRow label="Type">
                    <select
                      aria-label="Invoice type"
                      disabled={readOnly}
                      value={body.invoiceKind}
                      onChange={(event) => patch({ invoiceKind: event.target.value as InvoiceKind })}
                      className={PROPERTY_CONTROL}
                    >
                      {(Object.keys(INVOICE_KIND_LABELS) as InvoiceKind[]).map((value) => (
                        <option key={value} value={value}>
                          {INVOICE_KIND_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </PropertyRow>
                  <PropertyRow label="Issued">
                    <input
                      type="date"
                      aria-label="Issued"
                      disabled={readOnly}
                      value={body.issuedOn}
                      onChange={(event) => patch({ issuedOn: event.target.value })}
                      className={PROPERTY_CONTROL}
                    />
                  </PropertyRow>
                  <PropertyRow label="Due">
                    <input
                      type="date"
                      aria-label="Due"
                      disabled={readOnly}
                      value={body.dueOn}
                      onChange={(event) => patch({ dueOn: event.target.value })}
                      className={PROPERTY_CONTROL}
                    />
                  </PropertyRow>
                </dl>
              </RailPanel>
            ) : null}
            <RailPanel>
              <DocumentTotals
                items={body.items}
                taxRatePercent={body.taxRatePercent}
                onTaxRateChange={(taxRatePercent) => patch({ taxRatePercent })}
                readOnly={readOnly}
              >
                {invoice ? (
                  <>
                    <TotalRow label="Paid" cents={invoice.paidCents} />
                    <TotalRow label="Balance due" cents={invoice.balanceCents} variant="total" />
                  </>
                ) : null}
              </DocumentTotals>
            </RailPanel>
            {invoice?.payments.length ? (
              <RailPanel title="Payments">
                <ul className="divide-y divide-[var(--color-border)]">
                  {invoice.payments.map((payment) => (
                    <li key={payment.id} className="group flex min-h-11 items-center justify-between gap-2 py-1.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[13px] font-medium tabular-nums text-[var(--color-heading)]">
                          {fmtCents(payment.amountCents)}
                          {payment.source === "stripe" ? <Badge tone="green">Online</Badge> : null}
                        </div>
                        <div className="text-xs leading-4 text-[var(--color-muted)] [overflow-wrap:anywhere]">
                          {[
                            fmtDate(payment.paidOn),
                            PAYMENT_METHOD_LABELS[payment.method] ?? payment.method,
                            payment.feeCents ? `+${fmtCents(payment.feeCents)} card fee` : null,
                            payment.reference,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => run(() => deleteInvoicePayment(payment.id), "Could not remove the payment.")}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </RailPanel>
            ) : null}
            {invoice?.online ? <OnlinePaymentPanel invoice={invoice} online={invoice.online} token={token} /> : null}
            {changeOrder && changeOrder.status !== "draft" ? <ActivityPanel record={changeOrder} /> : null}
          </>
        }
        below={
          <>
            <Card className="p-4">
              <Field label={isInvoice ? "Notes to customer" : "Message to customer"}>
                <Textarea
                  rows={3}
                  maxLength={10000}
                  disabled={readOnly}
                  value={body.message}
                  onChange={(event) => patch({ message: event.target.value })}
                />
              </Field>
            </Card>
            {record && extras ? (
              <DocumentAttachments
                kind={kind}
                documentId={record.id}
                orgId={extras.orgId}
                projectId={jobId}
                assets={extras.assets}
                readOnly={readOnly}
              />
            ) : null}
          </>
        }
      />

      {dialog === "send" ? (
        <SendDocumentDialog
          kind={kind}
          id={id}
          title={isInvoice ? "Send invoice" : "Send change order"}
          noun={noun}
          description={
            isInvoice
              ? "Marks the invoice sent and copies the link where your customer sees what's owing."
              : "Marks the change order sent and copies the link where your customer accepts and signs it."
          }
          path={publicPath}
          token={linkReady ? token : null}
          dirty={dirty}
          save={save}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "payment" && invoice ? <PaymentDialog invoice={invoice} onClose={() => setDialog(null)} /> : null}
      {dialog === "close" ? (
        <ConfirmDialog
          title={close.title}
          message={close.message}
          confirmLabel={close.label}
          cancelLabel="Back"
          pending={pending}
          error={error}
          onConfirm={() =>
            run(
              () =>
                isInvoice
                  ? closeInvoice(id, closeAction as "void" | "delete")
                  : closeChangeOrder(id, closeAction as "cancel" | "delete"),
              "Could not update.",
              () => {
                setDialog(null);
                if (closeAction === "delete") router.push(backHref);
              },
            )
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
