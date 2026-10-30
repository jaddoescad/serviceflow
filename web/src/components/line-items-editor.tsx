"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDateTime } from "@/lib/format";
import {
  documentTotals,
  fmtCents,
  isAddOn,
  isIncluded,
  lineTotalCents,
  newLineItem,
  type CatalogItem,
  type Discount,
  type LineItem,
  type ProposalPackage,
} from "@/lib/line-items";
import type { DocumentDelivery } from "@/lib/proposal-types";
import { Badge, Button, Card, Select, buttonClassName, cn } from "./ui";

// Shared by the proposal, change order and invoice editors: a spreadsheet of
// lines, a hairline totals rail and the page's top bar. ui.tsx's cn() doesn't
// merge Tailwind classes, so the inline controls here carry their own classes
// instead of overriding a primitive's padding or font size.

const FOCUS = "focus:border-[var(--color-brand)] focus:bg-[var(--color-surface)] focus:shadow-[var(--focus-ring)]";
/** A bordered 13px control, like ui.tsx's Input. */
const FIELD = `w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-[13px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)] disabled:cursor-not-allowed ${FOCUS}`;
/** Spreadsheet cell: reads as plain text on desktop until hovered or focused; bordered on phones. */
const CELL = `${FIELD} lg:border-transparent lg:bg-transparent lg:hover:border-[var(--color-border-strong)] lg:focus:border-[var(--color-brand)] lg:disabled:hover:border-transparent`;
/** Read-only text that lines up with a control's text. */
const STATIC = "flex h-8 items-center border border-transparent px-2 text-[13px]";
const MOBILE_LABEL = "mb-1 block text-xs font-medium text-[var(--color-muted)] lg:sr-only";
const EDIT_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_5rem_7.5rem_7.5rem_2rem]";
/** A "pick one to add" select that sits with the ghost buttons under the lines. */
export const ADD_SELECT =
  "w-auto max-w-48 cursor-pointer border-transparent bg-transparent font-medium text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]";
const READ_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_5rem_7.5rem_7.5rem]";

/** Numeric field that keeps what's typed ("1.", "") while focused and reports each valid value. */
export function NumberInput({
  value,
  onChange,
  scale = 1,
  decimals,
  min,
  max,
  look = "field",
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max"> & {
  value: number;
  onChange: (value: number) => void;
  /** Stored units per shown unit, e.g. 100 for cents shown as dollars. */
  scale?: number;
  decimals?: number;
  min?: number;
  max?: number;
  look?: "field" | "cell";
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = value / scale;
  return (
    <input
      inputMode="decimal"
      {...props}
      value={text ?? (decimals == null ? String(shown) : shown.toFixed(decimals))}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = Number(event.target.value.replace(/[$,%\s]/g, ""));
        if (!Number.isFinite(parsed) || (min != null && parsed < min) || (max != null && parsed > max)) return;
        onChange(scale === 1 ? parsed : Math.round(parsed * scale));
      }}
      onBlur={() => setText(null)}
      className={cn(look === "cell" ? CELL : FIELD, "h-8 text-right tabular-nums", className)}
    />
  );
}

export function LineItemsEditor({
  items,
  onChange,
  readOnly = false,
  allowOptional = true,
  catalog = [],
  packages = [],
  footer,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  readOnly?: boolean;
  allowOptional?: boolean;
  /** Products and services offered as "Add from catalog". */
  catalog?: CatalogItem[];
  /** Proposals: the packages a line can belong to. The caller keeps package lines selected. */
  packages?: ProposalPackage[];
  /** Extra actions beside "Add item". */
  footer?: React.ReactNode;
}) {
  const columns = readOnly ? READ_COLUMNS : EDIT_COLUMNS;
  function update(id: string, patch: Partial<LineItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  return (
    <Card className="overflow-hidden">
      {items.length ? (
        <>
          <div
            className={cn(
              "hidden h-9 items-center gap-x-2 border-b border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-muted)] lg:grid",
              columns,
            )}
          >
            <span className="px-2">Item</span>
            <span className="px-2 text-right">Qty</span>
            <span className="px-2 text-right">Price</span>
            <span className="px-2 text-right">Amount</span>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "group grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-end gap-x-2 gap-y-2 px-3 py-2 lg:items-start lg:py-1",
                  columns,
                  !isIncluded(item) && "bg-[var(--color-surface-2)]",
                )}
              >
                <div className="col-span-full min-w-0 lg:col-span-1">
                  {readOnly ? (
                    <>
                      <div className={cn(STATIC, "font-medium text-[var(--color-heading)]")}>
                        <span className="truncate">{item.name}</span>
                      </div>
                      {item.description ? (
                        <p className="whitespace-pre-line px-[9px] pb-1.5 text-xs leading-5 text-[var(--color-muted)]">
                          {item.description}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <input
                        aria-label="Item name"
                        placeholder="Item name"
                        maxLength={200}
                        value={item.name}
                        onChange={(event) => update(item.id, { name: event.target.value })}
                        className={cn(CELL, "h-8 font-medium text-[var(--color-heading)]")}
                      />
                      <textarea
                        aria-label="Description"
                        placeholder="Add a description"
                        maxLength={4000}
                        rows={Math.min(6, Math.max(1, item.description.split("\n").length))}
                        value={item.description}
                        onChange={(event) => update(item.id, { description: event.target.value })}
                        // Grows with its text where supported; `rows` is the fallback.
                        className={cn(CELL, "mt-1 block resize-none py-1 text-xs leading-5 text-[var(--color-muted)] [field-sizing:content] lg:mt-0")}
                      />
                    </>
                  )}
                  <div className="flex flex-wrap items-center gap-x-1">
                  {packages.length ? (
                    readOnly ? (
                      item.packageId ? (
                        <span className="mt-1 inline-flex h-6 items-center px-2 text-xs text-[var(--color-muted)]">
                          {packages.find((pack) => pack.id === item.packageId)?.name ?? "Package"}
                          {item.selected ? " · chosen" : ""}
                        </span>
                      ) : null
                    ) : (
                      <select
                        aria-label="Package"
                        value={item.packageId ?? ""}
                        onChange={(event) =>
                          update(
                            item.id,
                            event.target.value
                              ? { packageId: event.target.value, optional: true }
                              : { packageId: null, optional: false, selected: true },
                          )
                        }
                        className="mt-1 h-6 rounded-[var(--radius-control)] border border-transparent bg-transparent px-1.5 text-xs text-[var(--color-muted)] outline-none hover:border-[var(--color-border-strong)] focus:border-[var(--color-brand)]"
                      >
                        <option value="">Every package</option>
                        {packages.map((pack) => (
                          <option key={pack.id} value={pack.id}>
                            {pack.name || "Untitled package"}
                          </option>
                        ))}
                      </select>
                    )
                  ) : null}
                  {allowOptional && !item.packageId && (item.optional || !readOnly) ? (
                    <label className="mt-1 inline-flex h-6 items-center gap-1.5 px-2 text-xs text-[var(--color-muted)]">
                      <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={item.optional}
                        onChange={(event) =>
                          update(item.id, { optional: event.target.checked, selected: !event.target.checked })
                        }
                      />
                      Optional{item.optional && readOnly ? (item.selected ? " · chosen" : " · not chosen") : ""}
                    </label>
                  ) : null}
                  </div>
                </div>
                <div className="min-w-0">
                  <span className={MOBILE_LABEL}>Qty</span>
                  {readOnly ? (
                    <div className={cn(STATIC, "justify-end tabular-nums")}>{item.quantity}</div>
                  ) : (
                    <NumberInput
                      look="cell"
                      aria-label="Quantity"
                      value={item.quantity}
                      onChange={(quantity) => update(item.id, { quantity })}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <span className={MOBILE_LABEL}>Price</span>
                  {readOnly ? (
                    <div className={cn(STATIC, "justify-end tabular-nums")}>{fmtCents(item.unitPriceCents)}</div>
                  ) : (
                    <NumberInput
                      look="cell"
                      aria-label="Price"
                      scale={100}
                      decimals={2}
                      value={item.unitPriceCents}
                      onChange={(unitPriceCents) => update(item.id, { unitPriceCents })}
                    />
                  )}
                </div>
                <div>
                  <span className={cn(MOBILE_LABEL, "text-right")}>Amount</span>
                  <div className={cn(STATIC, "justify-end font-medium tabular-nums text-[var(--color-heading)]")}>
                    {fmtCents(lineTotalCents(item))}
                  </div>
                </div>
                {readOnly ? null : (
                  <button
                    type="button"
                    aria-label={`Remove ${item.name || "item"}`}
                    title="Remove"
                    onClick={() => onChange(items.filter((other) => other.id !== item.id))}
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-base text-[var(--color-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-bad)] focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="px-4 py-8 text-center text-[13px] text-[var(--color-muted)]">No line items yet.</p>
      )}
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-1 border-t border-[var(--color-border)] px-3 py-2">
          <Button type="button" variant="ghost" onClick={() => onChange([...items, newLineItem()])}>
            + Add item
          </Button>
          {catalog.length ? (
            <Select
              aria-label="Add from catalog"
              className={ADD_SELECT}
              value=""
              onChange={(event) => {
                const product = catalog.find((item) => item.id === event.target.value);
                if (!product) return;
                const { name, description, unitPriceCents } = product;
                onChange([...items, newLineItem({ name, description, unitPriceCents })]);
              }}
            >
              <option value="">Add from catalog…</option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {fmtCents(item.unitPriceCents)}
                </option>
              ))}
            </Select>
          ) : null}
          {footer}
        </div>
      )}
    </Card>
  );
}

/** One label/amount line of a totals list (inside a <dl>). */
export function TotalRow({
  label,
  cents,
  variant = "default",
}: {
  label: React.ReactNode;
  cents: number;
  /** "total" gets a hairline above it; "note" is small print. */
  variant?: "default" | "strong" | "total" | "note";
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 items-center justify-between gap-3",
        variant === "note" ? "text-xs text-[var(--color-faint)]" : "text-[13px]",
        (variant === "strong" || variant === "total") && "font-semibold text-[var(--color-heading)]",
        variant === "total" && "mt-1 border-t border-[var(--color-border)] pt-1",
      )}
    >
      <dt className={variant === "default" ? "text-[var(--color-muted)]" : undefined}>{label}</dt>
      <dd className="tabular-nums">{fmtCents(cents)}</dd>
    </div>
  );
}

type DiscountKind = "none" | "percent" | "amount";

/** A proposal's discount: none, a percent or a fixed amount, shown as its own line before tax. */
function DiscountRow({
  discount,
  discountCents,
  onChange,
  readOnly,
}: {
  discount: Discount;
  discountCents: number;
  onChange: (discount: Discount) => void;
  readOnly: boolean;
}) {
  const kind: DiscountKind = discount.cents != null ? "amount" : discount.percent != null ? "percent" : "none";
  if (readOnly) {
    return kind === "none" ? null : (
      <TotalRow label={`Discount${kind === "percent" ? ` (${discount.percent}%)` : ""}`} cents={-discountCents} />
    );
  }
  return (
    <TotalRow
      label={
        <span className="flex items-center gap-1.5">
          Discount
          {kind === "none" ? null : (
            <span className={kind === "percent" ? "w-14" : "w-20"}>
              {kind === "percent" ? (
                <NumberInput
                  aria-label="Discount percent"
                  min={0}
                  max={100}
                  value={discount.percent ?? 0}
                  onChange={(percent) => onChange({ percent, cents: null })}
                />
              ) : (
                <NumberInput
                  aria-label="Discount amount"
                  scale={100}
                  decimals={2}
                  min={0}
                  value={discount.cents ?? 0}
                  onChange={(cents) => onChange({ percent: null, cents })}
                />
              )}
            </span>
          )}
          <Select
            aria-label="Discount type"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as DiscountKind;
              onChange(
                next === "none"
                  ? { percent: null, cents: null }
                  : next === "percent"
                    ? { percent: discount.percent ?? 10, cents: null }
                    : { percent: null, cents: discount.cents ?? discountCents },
              );
            }}
          >
            <option value="none">None</option>
            <option value="percent">%</option>
            <option value="amount">$</option>
          </Select>
        </span>
      }
      cents={-discountCents}
    />
  );
}

export function DocumentTotals({
  items,
  taxRatePercent,
  onTaxRateChange,
  readOnly = false,
  discount,
  children,
}: {
  items: LineItem[];
  taxRatePercent: number;
  onTaxRateChange: (rate: number) => void;
  readOnly?: boolean;
  /** Proposals: a discount line between the subtotal and tax. */
  discount?: { value: Discount; onChange: (value: Discount) => void };
  children?: React.ReactNode;
}) {
  const totals = documentTotals(items, taxRatePercent, discount?.value);
  // Lines of packages the customer may not pick aren't "optional items".
  const optionalCents = items
    .filter((item) => isAddOn(item) && !isIncluded(item))
    .reduce((sum, item) => sum + lineTotalCents(item), 0);
  return (
    <dl>
      <TotalRow label="Subtotal" cents={totals.subtotalCents} />
      {discount ? (
        <DiscountRow
          discount={discount.value}
          discountCents={totals.discountCents}
          onChange={discount.onChange}
          readOnly={readOnly}
        />
      ) : null}
      <TotalRow
        label={
          readOnly ? (
            `Tax (${taxRatePercent}%)`
          ) : (
            <span className="flex items-center gap-1.5">
              Tax
              <span className="w-14">
                <NumberInput
                  aria-label="Tax rate percent"
                  min={0}
                  max={100}
                  value={taxRatePercent}
                  onChange={onTaxRateChange}
                />
              </span>
              %
            </span>
          )
        }
        cents={totals.taxCents}
      />
      <TotalRow label="Total" cents={totals.totalCents} variant="total" />
      {optionalCents ? <TotalRow label="Optional items not included" cents={optionalCents} variant="note" /> : null}
      {children}
    </dl>
  );
}

/** The editable body of a document, and whether it differs from what was last saved. */
export function useDraft<T extends object>(initial: T, isNew: boolean) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(isNew ? null : JSON.stringify(initial));
  return {
    body,
    setBody,
    patch: (next: Partial<T>) => setBody((current) => ({ ...current, ...next })),
    /** Always true for a document that was never saved. */
    dirty: JSON.stringify(body) !== saved,
    markSaved: (value: T) => setSaved(JSON.stringify(value)),
  };
}

/** The page's top bar: breadcrumb, editable name, status tag and the document's actions. */
export function EditorHeader({
  backHref,
  backLabel,
  number,
  name,
  placeholder,
  onNameChange,
  readOnly,
  status,
  delivery,
  customerHref,
  actions,
  primaryAction,
  save,
  error,
  notice,
}: {
  backHref: string;
  backLabel: string;
  /** Shown before the name, e.g. "#12". */
  number?: string | null;
  name: string;
  placeholder: string;
  onNameChange: (name: string) => void;
  readOnly: boolean;
  status?: { label: string; tone: React.ComponentProps<typeof Badge>["tone"] } | null;
  /** The latest email or text that carried the document. */
  delivery?: DocumentDelivery | null;
  /** The customer's link, once sent. */
  customerHref?: string | null;
  /** Secondary actions, before Save. */
  actions?: React.ReactNode;
  /** The main action, after Save. */
  primaryAction?: React.ReactNode;
  save: { dirty: boolean; saving: boolean; disabled: boolean; onSave: () => void };
  error: string;
  /** A line of context under the bar. */
  notice?: React.ReactNode;
}) {
  return (
    <>
      {/* The page's 56px top bar (.page-bar), like PageHeader. */}
      <header className="page-bar flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-border)] py-2.5">
        <div className="flex min-w-0 flex-[1_1_20rem] items-center gap-1.5">
          <Link
            href={backHref}
            className="max-w-[40%] shrink-0 truncate text-[13px] text-[var(--color-muted)] hover:text-[var(--color-heading)]"
          >
            {backLabel}
          </Link>
          <span aria-hidden="true" className="text-[13px] text-[var(--color-faint)]">
            /
          </span>
          {number ? (
            <span className="shrink-0 text-base font-semibold tabular-nums text-[var(--color-muted)]">{number}</span>
          ) : null}
          <input
            aria-label={placeholder}
            placeholder={placeholder}
            maxLength={120}
            disabled={readOnly}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className={cn(
              "h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-transparent bg-transparent px-1.5 text-base font-semibold text-[var(--color-heading)] outline-none placeholder:text-[var(--color-faint)] hover:bg-[var(--color-hover)] disabled:hover:bg-transparent",
              FOCUS,
            )}
          />
          {status ? (
            <span className="shrink-0">
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          ) : null}
          {delivery ? <DeliveryNote delivery={delivery} /> : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {customerHref ? (
            <a
              href={customerHref}
              target="_blank"
              rel="noreferrer"
              className={buttonClassName({ variant: "ghost" })}
            >
              Customer view <span aria-hidden="true">↗</span>
            </a>
          ) : null}
          {actions}
          {readOnly ? null : (
            <Button
              type="button"
              variant={primaryAction || !save.dirty ? "subtle" : "primary"}
              disabled={save.disabled || !save.dirty}
              onClick={save.onSave}
            >
              {save.saving ? "Saving…" : save.dirty ? "Save" : "Saved"}
            </Button>
          )}
          {primaryAction}
        </div>
      </header>
      {notice ? <p className="-mt-2 mb-4 text-[13px] text-[var(--color-muted)]">{notice}</p> : null}
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius)] bg-[var(--color-bad-soft)] px-3 py-2 text-[13px] text-[var(--color-bad)]"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

function deliveryText(delivery: DocumentDelivery): { text: string; failed: boolean } {
  const noun = delivery.channel === "email" ? "Email" : "Text";
  const reason = delivery.error ? ` — ${delivery.error}` : "";
  switch (delivery.status) {
    case "queued":
    case "sending":
      return { text: `${noun} queued`, failed: false };
    case "sent":
      return {
        text: `${delivery.channel === "email" ? "Emailed" : "Texted"} ${fmtDateTime(delivery.sentAt ?? delivery.createdAt)}`,
        failed: false,
      };
    case "failed":
      return { text: `${noun} failed${reason}`, failed: true };
    default:
      return { text: `Not delivered${reason}`, failed: true };
  }
}

/** One quiet line beside the status: how the last email or text went. Refreshes while it is queued. */
function DeliveryNote({ delivery }: { delivery: DocumentDelivery }) {
  const router = useRouter();
  const waiting = delivery.status === "queued" || delivery.status === "sending";
  useEffect(() => {
    // Messages go out within a minute; stop checking if the sender isn't running.
    if (!waiting || Date.now() - new Date(delivery.createdAt).getTime() > 10 * 60_000) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [waiting, delivery.createdAt, router]);
  const { text, failed } = deliveryText(delivery);
  return (
    <span
      title={text}
      className={cn(
        "min-w-0 max-w-[60%] truncate text-xs",
        failed ? "text-[var(--color-bad)]" : "text-[var(--color-muted)]",
      )}
    >
      {text}
    </span>
  );
}

/**
 * The document with its rail. Wide screens put the rail beside it; narrower
 * ones put it under the line items, before any notes.
 */
export function EditorColumns({
  main,
  rail,
  below,
}: {
  main: React.ReactNode;
  rail: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:grid-rows-[auto_1fr]">
      <div className="min-w-0 space-y-4">{main}</div>
      <div className="w-full space-y-4 justify-self-end sm:max-w-sm xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:max-w-none">
        {rail}
      </div>
      {below ? <div className="min-w-0 space-y-4 xl:col-start-1">{below}</div> : null}
    </div>
  );
}

/** A hairline panel in the editor rail. */
export function RailPanel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Card className="px-4 py-3">
      {title ? <h2 className="mb-1 text-[13px] font-semibold text-[var(--color-heading)]">{title}</h2> : null}
      {children}
    </Card>
  );
}

/** A label/value row in a rail panel: muted label on the left, value or inline control on the right. */
export function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 border-b border-[var(--color-border)] last:border-0">
      <dt className="shrink-0 text-xs text-[var(--color-muted)]">{label}</dt>
      <dd className="min-w-0 text-right text-[13px]">{children}</dd>
    </div>
  );
}

/** Inline control classes for PropertyRow values (dates, selects). */
export const PROPERTY_CONTROL = `${CELL} h-8 text-right`;

/** When a signed document was sent, viewed, signed or declined. */
export function ActivityPanel({
  record,
}: {
  record: {
    sentAt: string | null;
    viewedAt: string | null;
    signedName: string | null;
    signedAt: string | null;
    declinedAt: string | null;
    declineReason: string | null;
  };
}) {
  const rows = [
    ["Sent", record.sentAt && fmtDateTime(record.sentAt)],
    ["Viewed", record.viewedAt && fmtDateTime(record.viewedAt)],
    ["Signed", record.signedAt && [record.signedName, fmtDateTime(record.signedAt)].filter(Boolean).join(" · ")],
    ["Declined", record.declinedAt && fmtDateTime(record.declinedAt)],
  ].filter((row): row is [string, string] => !!row[1]);
  if (!rows.length) return null;
  return (
    <RailPanel title="Activity">
      <dl>
        {rows.map(([label, value]) => (
          <PropertyRow key={label} label={label}>
            {value}
          </PropertyRow>
        ))}
      </dl>
      {record.declineReason ? (
        <p className="border-t border-[var(--color-border)] py-2 text-[13px] text-[var(--color-muted)]">
          “{record.declineReason}”
        </p>
      ) : null}
    </RailPanel>
  );
}
